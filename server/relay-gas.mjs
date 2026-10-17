/**
 * Reader gas drip — the other half of RELAYER_PRIVATE_KEY.
 *
 * Writers already skip gas via registerArticleFor. Readers paying USDC still
 * need a tiny bit of native MON for approve/unlock; this sends it so checkout
 * does not open Coinbase on a dust MON buy.
 *
 * A drip is paid only to an address that just signed this request
 * ("Open Paywall gas v1" + issuedAt, checked with assertRecentWalletSignature)
 * or that just opened a reader session (the same issuedAt window). Each
 * address is funded at most once. A global daily cap is stored in Supabase
 * so a restart cannot reset it.
 *
 *   RELAYER_GAS_GLOBAL_DAILY_CAP — positive integer, default 8 (~0.4 MON/day)
 */
import { createPublicClient, createWalletClient, http, parseEther } from "viem";
import { issuedAtFresh } from "./follow-core.mjs";
import { monadRpcUrl, relayerAccount, relayerConfigured } from "./relay-register.mjs";
import {
  assertRecentWalletSignature,
  buildGasAuthMessage,
} from "./writer-mutation-auth.mjs";

const DEFAULT_GLOBAL_DAILY_CAP = 8;
const GAS_DROP = parseEther("0.05");
const GAS_NEED = parseEther("0.05");

function httpError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
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

function supabaseGasConfig(env = process.env) {
  const url = String(env.SUPABASE_URL || "").trim().replace(/\/$/, "");
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) throw httpError("gas_limit_unavailable", 503);
  return { url, key };
}

/**
 * Pay only the address that just signed, or a reader session issued inside
 * the same 10-minute window. Anything else is 401, before a balance read.
 * @param {string} address
 * @param {Record<string, unknown>} body
 * @param {{ now?: number, readerSession?: { address?: string, issuedAt?: number } | null }} [ctx]
 */
export async function authorizeGasRecipient(address, body, ctx = {}) {
  const signature = String(body?.signature || body?.sig || "").trim();
  const issuedAt = String(body?.issuedAt || "").trim();
  if (signature || issuedAt) {
    const message = buildGasAuthMessage({ address, issuedAt });
    await assertRecentWalletSignature(
      { address, issuedAt, signature, message },
      ctx.now ?? Date.now()
    );
    return;
  }
  const session = ctx.readerSession;
  const sessionAddress = String(session?.address || "").trim().toLowerCase();
  const sessionIssued = Number(session?.issuedAt);
  if (
    sessionAddress &&
    sessionAddress === address.toLowerCase() &&
    Number.isFinite(sessionIssued) &&
    issuedAtFresh(new Date(sessionIssued * 1000).toISOString(), ctx.now ?? Date.now())
  ) {
    return;
  }
  throw httpError("unauthorized", 401);
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
  if (!res.ok) throw httpError("gas_limit_unavailable", 503);
  let data = text;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (data === "ok" || data === "already_claimed" || data === "rate_limited") return data;
  throw httpError("gas_limit_unavailable", 503);
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
 * @param {{ ip?: string, now?: number, readerSession?: { address?: string, issuedAt?: number } | null }} [ctx]
 * @param {object} [deps]
 */
export async function relayGasDrip(body, ctx = {}, deps = {}) {
  const parsed = body && typeof body === "object" ? body : {};
  const address = String(parsed.address || "").trim();
  if (!isAddress(address)) throw httpError("invalid_address");
  await authorizeGasRecipient(address, parsed, ctx);

  if (!(deps.configured ?? relayerConfigured)()) {
    const err = httpError("relayer_not_configured", 503);
    err.fallback = true;
    throw err;
  }

  const account = (deps.account ?? relayerAccount)();
  if (!account) {
    const err = httpError("relayer_not_configured", 503);
    err.fallback = true;
    throw err;
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
  if (slot === "rate_limited") throw httpError("rate_limited", 429);
  if (slot !== "ok") throw httpError("gas_limit_unavailable", 503);

  const release = deps.releaseGas ?? ((addr) => releasePersistentGas(addr, deps));

  try {
    const relayerBal = deps.getRelayerBalance
      ? await deps.getRelayerBalance(account.address)
      : await publicClient.getBalance({ address: account.address });
    if (relayerBal < GAS_DROP + parseEther("0.01")) {
      throw httpError("relayer_underfunded", 503);
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
