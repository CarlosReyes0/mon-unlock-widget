/**
 * Reader gas drip — the other half of RELAYER_PRIVATE_KEY.
 *
 * Writers already skip gas via registerArticleFor. Readers paying USDC still
 * need a tiny bit of native MON for approve/unlock; this sends it so checkout
 * does not open Coinbase on a dust MON buy.
 */
import { createPublicClient, createWalletClient, http, parseEther } from "viem";
import {
  monadRpcUrl,
  relayerAccount,
  relayerConfigured,
  takeRateLimitToken,
} from "./relay-register.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_ADDR_LIMIT = 2;
const DEFAULT_IP_LIMIT = 30;
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

function addrDailyLimit() {
  const n = Number(process.env.RELAYER_GAS_DAILY_LIMIT);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_ADDR_LIMIT;
}

function ipDailyLimit() {
  const n = Number(process.env.RELAYER_GAS_IP_DAILY_LIMIT);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_IP_LIMIT;
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
 * @param {{ ip?: string }} [ctx]
 * @param {object} [deps]
 */
export async function relayGasDrip(body, ctx = {}, deps = {}) {
  if (!(deps.configured ?? relayerConfigured)()) {
    const err = httpError("relayer_not_configured", 503);
    err.fallback = true;
    throw err;
  }

  const parsed = body && typeof body === "object" ? body : {};
  const address = String(parsed.address || "").trim();
  if (!isAddress(address)) throw httpError("invalid_address");

  const account = (deps.account ?? relayerAccount)();
  if (!account) {
    const err = httpError("relayer_not_configured", 503);
    err.fallback = true;
    throw err;
  }

  const ip = String(ctx.ip || "unknown");
  const takeToken = deps.takeRateLimit ?? takeRateLimitToken;
  if (!takeToken(`gas:${address.toLowerCase()}`, addrDailyLimit())) {
    throw httpError("rate_limited", 429);
  }
  if (!takeToken(`gas-ip:${ip}`, ipDailyLimit())) {
    throw httpError("rate_limited", 429);
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
}
