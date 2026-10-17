/**
 * Reader gas drip — the other half of RELAYER_PRIVATE_KEY.
 *
 * Writers already skip gas via registerArticleFor. Readers paying USDC still
 * need a tiny bit of native MON for approve/unlock; this sends it so checkout
 * does not open Coinbase on a dust MON buy.
 *
 * A drip is paid only to an address that just signed an unlock attempt for
 * one article ("Open Paywall gas v1" + article + address + issuedAt, checked
 * with assertRecentWalletSignature). The article must exist and have a price.
 * A registration signature or a reader session alone is not enough. Each
 * address is funded at most once. A global daily cap is stored in Supabase
 * so a restart cannot reset it.
 *
 *   RELAYER_GAS_GLOBAL_DAILY_CAP — positive integer, default 50 (~2.5 MON/day)
 *   RELAYER_LOW_BALANCE_WEI      — log relayer_low_balance below this, default 1 MON
 */
import { createPublicClient, createWalletClient, http, keccak256, parseEther, toBytes } from "viem";
import { storedPriceCents } from "./article-price.mjs";
import { monadRpcUrl, relayerAccount, relayerConfigured } from "./relay-register.mjs";
import {
  assertRecentWalletSignature,
  buildGasAuthMessage,
} from "./writer-mutation-auth.mjs";

const DEFAULT_GLOBAL_DAILY_CAP = 50;
const DEFAULT_LOW_BALANCE_WEI = parseEther("1");
const LOW_BALANCE_LOG_MS = 10 * 60 * 1000;
const GAS_DROP = parseEther("0.05");
const GAS_NEED = parseEther("0.05");
const ARTICLE_COLS = "article_id,article_id_hash,price_wei,price_cents";
const lowBalanceState = { at: 0 };

function httpError(message, status = 400, fallback = false) {
  const err = new Error(message);
  err.status = status;
  if (fallback) err.fallback = true;
  return err;
}

function isAddress(value) {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

export function gasGlobalDailyCap(env = process.env) {
  const n = Number(env.RELAYER_GAS_GLOBAL_DAILY_CAP);
  if (Number.isFinite(n) && n >= 1) return Math.floor(n);
  return DEFAULT_GLOBAL_DAILY_CAP;
}

export function gasDripDayStart(now = Date.now()) {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
}

export function relayerLowBalanceWei(env = process.env) {
  const raw = String(env.RELAYER_LOW_BALANCE_WEI ?? "").trim();
  if (/^[0-9]+$/.test(raw)) {
    try {
      const value = BigInt(raw);
      if (value > 0n) return value;
    } catch {
      /* use the default */
    }
  }
  return DEFAULT_LOW_BALANCE_WEI;
}

export function resetRelayerLowBalanceLogForTests() {
  lowBalanceState.at = 0;
}

/**
 * Log one JSON warning when the relayer is under the threshold.
 * Repeated calls inside 10 minutes stay quiet.
 * @param {bigint | string | number} balance
 * @param {{ env?: NodeJS.ProcessEnv, now?: number, log?: (line: string) => void, state?: { at: number }, threshold?: bigint }} [opts]
 */
export function noteRelayerLowBalance(balance, opts = {}) {
  const threshold = opts.threshold ?? relayerLowBalanceWei(opts.env);
  let bal;
  try {
    bal = typeof balance === "bigint" ? balance : BigInt(balance);
  } catch {
    return false;
  }
  if (bal >= threshold) return false;
  const state = opts.state || lowBalanceState;
  const now = opts.now ?? Date.now();
  if (state.at && now >= state.at && now - state.at < LOW_BALANCE_LOG_MS) return false;
  state.at = now;
  const log = opts.log || console.warn;
  log(
    JSON.stringify({
      event: "relayer_low_balance",
      balance: bal.toString(),
      threshold: threshold.toString(),
    })
  );
  return true;
}

function supabaseGasConfig(env = process.env) {
  const url = String(env.SUPABASE_URL || "").trim().replace(/\/$/, "");
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) throw httpError("gas_limit_unavailable", 503, true);
  return { url, key };
}

/** Slug or id the reader signed. Rejects blank, overlong, and control characters. */
export function articleIdForGas(value) {
  const id = String(value ?? "").trim();
  if (!id || id.length > 200) return "";
  if (/[\u0000-\u001f]/.test(id)) return "";
  return id;
}

/** A priced unlock is price_cents of at least $0.50, or any positive price_wei. */
export function articleHasUnlockPrice(row) {
  if (!row || typeof row !== "object") return false;
  if (storedPriceCents(row.price_cents) != null) return true;
  const wei = String(row.price_wei ?? "").trim();
  if (!/^[0-9]+$/.test(wei)) return false;
  try {
    return BigInt(wei) > 0n;
  } catch {
    return false;
  }
}

async function defaultLookupArticle(articleId, deps = {}) {
  const env = deps.env || process.env;
  const url = String(env.SUPABASE_URL || "").trim().replace(/\/$/, "");
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) throw httpError("article_lookup_unavailable", 503, true);
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const load = async (filter) => {
    let res;
    try {
      res = await fetchImpl(
        `${url}/rest/v1/articles?select=${ARTICLE_COLS}&${filter}&limit=1`,
        { headers }
      );
    } catch {
      throw httpError("article_lookup_unavailable", 503, true);
    }
    if (!res.ok) throw httpError("article_lookup_unavailable", 503, true);
    let rows;
    try {
      rows = await res.json();
    } catch {
      throw httpError("article_lookup_unavailable", 503, true);
    }
    return Array.isArray(rows) ? rows[0] || null : null;
  };
  const byId = await load(`article_id=eq.${encodeURIComponent(articleId)}`);
  if (byId) return byId;
  const hash = keccak256(toBytes(articleId));
  return load(`article_id_hash=eq.${encodeURIComponent(hash)}`);
}

/**
 * Pay only a wallet that just signed an unlock attempt for one article.
 * A reader session or a registration signature is 401, before any lookup.
 * @param {string} address
 * @param {Record<string, unknown>} body
 * @param {{ now?: number }} [ctx]
 * @returns {Promise<string>}
 */
export async function authorizeGasRecipient(address, body, ctx = {}) {
  const signature = String(body?.signature || body?.sig || "").trim();
  const issuedAt = String(body?.issuedAt || "").trim();
  const articleId = articleIdForGas(body?.articleId ?? body?.article ?? body?.slug);
  if (!signature || !issuedAt || !articleId) throw httpError("unauthorized", 401);
  const message = buildGasAuthMessage({ address, articleId, issuedAt });
  await assertRecentWalletSignature(
    { address, issuedAt, signature, message },
    ctx.now ?? Date.now()
  );
  return articleId;
}

/**
 * Atomic once-per-address claim plus the global daily cap.
 * Returns "ok" | "already_claimed" | "rate_limited".
 * @param {string} address
 * @param {{ env?: NodeJS.ProcessEnv, fetchImpl?: typeof fetch, now?: number, cap?: number }} [deps]
 */
export async function claimPersistentGas(address, deps = {}) {
  const env = deps.env || process.env;
  const { url, key } = supabaseGasConfig(env);
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  const now = deps.now ?? Date.now();
  const cap = deps.cap ?? gasGlobalDailyCap(env);
  const res = await fetchImpl(`${url}/rest/v1/rpc/claim_gas_drip`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_address: address.toLowerCase(),
      p_day_start: gasDripDayStart(now),
      p_cap: cap,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw httpError("gas_limit_unavailable", 503, true);
  let data = text;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (data === "ok" || data === "already_claimed" || data === "rate_limited") return data;
  throw httpError("gas_limit_unavailable", 503, true);
}

/**
 * Drop a claim when the send itself failed, so a later retry can succeed.
 * @param {string} address
 * @param {{ env?: NodeJS.ProcessEnv, fetchImpl?: typeof fetch }} [deps]
 */
export async function releasePersistentGas(address, deps = {}) {
  const env = deps.env || process.env;
  let cfg;
  try {
    cfg = supabaseGasConfig(env);
  } catch {
    return;
  }
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  await fetchImpl(
    `${cfg.url}/rest/v1/gas_drip_claims?address=eq.${encodeURIComponent(address.toLowerCase())}`,
    {
      method: "DELETE",
      headers: {
        apikey: cfg.key,
        Authorization: `Bearer ${cfg.key}`,
        Prefer: "return=minimal",
      },
    }
  );
}

function monadChain(rpcUrl) {
  return {
    id: 143,
    name: "Monad",
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  };
}

/**
 * @param {unknown} body
 * @param {{ ip?: string, now?: number }} [ctx]
 * @param {object} [deps]
 */
export async function relayGasDrip(body, ctx = {}, deps = {}) {
  const parsed = body && typeof body === "object" ? body : {};
  const address = String(parsed.address || "").trim();
  if (!isAddress(address)) throw httpError("invalid_address");
  const articleId = await authorizeGasRecipient(address, parsed, ctx);
  const lookup = deps.lookupArticle ?? ((id) => defaultLookupArticle(id, deps));
  let article;
  try {
    article = await lookup(articleId);
  } catch (err) {
    if (err?.status) throw err;
    throw httpError("article_lookup_unavailable", 503, true);
  }
  if (!article) throw httpError("article_not_found", 403);
  if (!articleHasUnlockPrice(article)) throw httpError("article_unpriced", 403);

  if (!(deps.configured ?? relayerConfigured)()) {
    throw httpError("relayer_not_configured", 503, true);
  }

  const account = (deps.account ?? relayerAccount)();
  if (!account) {
    throw httpError("relayer_not_configured", 503, true);
  }

  const rpcUrl = deps.rpcUrl ?? monadRpcUrl();
  const getBalance = deps.getBalance;
  const sendNative = deps.sendNative;
  const waitReceipt = deps.waitReceipt;

  const chain = monadChain(rpcUrl);
  const publicClient =
    getBalance && sendNative
      ? null
      : createPublicClient({ chain, transport: http(rpcUrl) });

  const balance = getBalance
    ? await getBalance(address)
    : await publicClient.getBalance({ address });

  if (balance >= GAS_NEED) {
    return { ok: true, skipped: true, reason: "already_funded", amountWei: "0" };
  }

  const claim = deps.claimGas ?? ((addr) => claimPersistentGas(addr, deps));
  const slot = await claim(address);
  if (slot === "already_claimed") throw httpError("already_claimed", 409);
  if (slot === "rate_limited") throw httpError("rate_limited", 429, true);
  if (slot !== "ok") throw httpError("gas_limit_unavailable", 503, true);

  const release = deps.releaseGas ?? ((addr) => releasePersistentGas(addr, deps));

  try {
    const relayerBal = deps.getRelayerBalance
      ? await deps.getRelayerBalance(account.address)
      : await publicClient.getBalance({ address: account.address });
    noteRelayerLowBalance(relayerBal, {
      env: deps.env,
      now: deps.now ?? Date.now(),
      log: deps.log,
      state: deps.lowBalanceState,
    });
    if (relayerBal < GAS_DROP + parseEther("0.01")) {
      throw httpError("relayer_underfunded", 503, true);
    }

    let hash;
    if (sendNative) {
      hash = await sendNative({ to: address, value: GAS_DROP, account });
    } else {
      const walletClient = createWalletClient({
        account,
        chain,
        transport: http(rpcUrl),
      });
      hash = await walletClient.sendTransaction({
        to: address,
        value: GAS_DROP,
      });
      if (waitReceipt) {
        await waitReceipt(hash);
      } else {
        await publicClient.waitForTransactionReceipt({ hash });
      }
    }

    return {
      ok: true,
      skipped: false,
      txHash: hash,
      amountWei: GAS_DROP.toString(),
    };
  } catch (err) {
    try {
      await release(address);
    } catch {
      /* the claim stays; a retry will not pay twice */
    }
    throw err;
  }
}
