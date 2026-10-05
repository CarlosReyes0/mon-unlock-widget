/**
 * x402 (HTTP 402) gate for Bankr / agent wallets.
 *
 * Bankr and most x402 clients settle **USDC on Base**. Open Paywall's human
 * reader unlock remains **USDC on Monad**. This adapter speaks standard x402
 * (v1 JSON body + X-PAYMENT, plus v2 PAYMENT-* headers) and then reuses the
 * existing publish / gated-body business logic.
 *
 * Env:
 *   X402_PAY_TO              — 0x recipient on Base (falls back to MPP_TEMPO_RECIPIENT)
 *   X402_FACILITATOR_URL     — verify/settle base URL
 *   X402_PUBLISH_AMOUNT      — USD (default MPP_PUBLISH_AMOUNT or 0.05)
 *   X402_UNLOCK_AMOUNT       — USD fallback when a listing is not USDC-priced (default 0.50)
 *   X402_DEV_BYPASS=1        — skip payment (local tests only)
 */
import { generateJwt } from "@coinbase/cdp-sdk/auth";
import { publishAmount } from "./mpp.mjs";
import { storedPriceCents } from "./article-price.mjs";

export const BASE_CHAIN_ID = 8453;
export const BASE_NETWORK_V1 = "base";
export const BASE_NETWORK_V2 = "eip155:8453";
/** Circle USDC on Base. */
export const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
/** Circle USDC on Monad (human unlock; not the Bankr x402 rail). */
export const MONAD_USDC = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";
export const CDP_X402_FACILITATOR = "https://api.cdp.coinbase.com/platform/v2/x402";
export const DEFAULT_PUBLIC_FACILITATOR = "https://facilitator.payai.network";

const CDP_API_KEY_ID = () =>
  (process.env.CDP_API_KEY_ID || process.env.CDP_API_KEY || "").trim();
const CDP_API_KEY_SECRET = () =>
  (process.env.CDP_API_KEY_SECRET || process.env.CDP_API_SECRET || "").trim();

export function x402PayTo() {
  const explicit = (process.env.X402_PAY_TO || "").trim();
  if (explicit) return explicit;
  return (process.env.MPP_TEMPO_RECIPIENT || "").trim();
}

export function x402Configured() {
  return /^0x[a-fA-F0-9]{40}$/.test(x402PayTo());
}

export function x402DevBypass() {
  return process.env.X402_DEV_BYPASS === "1" || process.env.X402_DEV_BYPASS === "true";
}

export function x402PublishAmountUsd() {
  const raw = (process.env.X402_PUBLISH_AMOUNT || publishAmount() || "0.05").trim();
  return raw || "0.05";
}

export function x402UnlockAmountUsd() {
  const raw = (process.env.X402_UNLOCK_AMOUNT || "0.50").trim();
  return raw || "0.50";
}

/** Convert a USD decimal string ("0.50") to USDC atomic units (6 decimals). */
export function usdToUsdcAtomic(human) {
  const raw = String(human ?? "").trim();
  if (!raw) return "0";
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return "0";
  return String(Math.round(n * 1_000_000));
}

/**
 * Listing price_wei is already 6-dec USDC atomic for USDC articles.
 * MON listings have no USD oracle here — fall back to the default USDC unlock.
 */
export function usdcAtomicForListing(priceWei, paymentAsset, priceCents) {
  const asset = String(paymentAsset || "usdc").trim().toLowerCase();
  if (asset === "usdc" || asset === "usd" || asset === "stable") {
    const stored = storedPriceCents(priceCents);
    if (stored != null) return String(stored * 10000);
    try {
      const n = BigInt(String(priceWei ?? "").trim() || "0");
      if (n > 0n) return n.toString();
    } catch {
      /* fall through */
    }
  }
  return usdToUsdcAtomic(x402UnlockAmountUsd());
}

export function facilitatorUrl() {
  const explicit = (process.env.X402_FACILITATOR_URL || "").trim().replace(/\/$/, "");
  if (explicit) return explicit;
  if (CDP_API_KEY_ID() && CDP_API_KEY_SECRET()) return CDP_X402_FACILITATOR;
  return DEFAULT_PUBLIC_FACILITATOR;
}

export function x402Status() {
  return {
    configured: x402Configured(),
    devBypass: x402DevBypass(),
    network: BASE_NETWORK_V1,
    networkCaip2: BASE_NETWORK_V2,
    chainId: BASE_CHAIN_ID,
    asset: BASE_USDC,
    assetSymbol: "USDC",
    payTo: x402Configured() ? x402PayTo() : null,
    publishAmountUsd: x402PublishAmountUsd(),
    unlockDefaultAmountUsd: x402UnlockAmountUsd(),
    facilitator: facilitatorUrl(),
    endpoints: {
      publish: "/api/x402/publish",
      unlock: "/api/x402/unlock",
      article: "/api/x402/articles/{slug}",
    },
    settlement:
      "Agent x402 payments settle USDC on Base to the Open Paywall wallet. Human readers still unlock USDC on Monad (no platform fee). MPP PathUSD publish remains available at POST /api/agents/publish.",
  };
}

export function publicOriginFromReq(req) {
  const proto = String(req?.headers?.["x-forwarded-proto"] || "http")
    .split(",")[0]
    .trim();
  const host = String(req?.headers?.host || "localhost").split(",")[0].trim();
  return `${proto}://${host}`;
}

export function buildPaymentRequirements({
  resource,
  description,
  amountAtomic,
  extra = {},
}) {
  const payTo = x402PayTo();
  return {
    scheme: "exact",
    network: BASE_NETWORK_V1,
    maxAmountRequired: String(amountAtomic),
    resource: String(resource || ""),
    description: String(description || "Open Paywall"),
    mimeType: "application/json",
    payTo,
    maxTimeoutSeconds: 60,
    asset: BASE_USDC,
    extra: {
      name: "USD Coin",
      version: "2",
      ...extra,
    },
  };
}

export function paymentRequiredBody({ accepts, error }) {
  return {
    x402Version: 1,
    error: error || "X-PAYMENT header is required",
    accepts: Array.isArray(accepts) ? accepts : [],
  };
}

/** v2-shaped accepts entry (CAIP-2 network) for PAYMENT-REQUIRED header clients. */
export function toV2Accept(requirements) {
  return {
    scheme: requirements.scheme,
    network: BASE_NETWORK_V2,
    amount: requirements.maxAmountRequired,
    maxAmountRequired: requirements.maxAmountRequired,
    asset: requirements.asset,
    payTo: requirements.payTo,
    maxTimeoutSeconds: requirements.maxTimeoutSeconds,
    extra: requirements.extra,
    resource: requirements.resource,
    description: requirements.description,
    mimeType: requirements.mimeType,
  };
}

export function encodeJsonB64(obj) {
  return Buffer.from(JSON.stringify(obj), "utf8").toString("base64");
}

export function decodeJsonB64OrJson(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      return JSON.parse(text);
    } catch {
      return { invalid: true, reason: "malformed_json" };
    }
  }
  try {
    const json = Buffer.from(text, "base64").toString("utf8");
    return JSON.parse(json);
  } catch {
    return { invalid: true, reason: "malformed_payment" };
  }
}

function header(req, name) {
  const v = req?.headers?.[name] ?? req?.headers?.[name.toLowerCase()];
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Bankr / x402 v1: X-PAYMENT. x402 v2: PAYMENT-SIGNATURE.
 * Some clients send the JSON unencoded.
 */
export function readPaymentHeader(req) {
  const raw =
    header(req, "x-payment") ||
    header(req, "payment-signature") ||
    header(req, "PAYMENT-SIGNATURE") ||
    header(req, "X-PAYMENT");
  if (!raw) return { missing: true };
  const decoded = decodeJsonB64OrJson(raw);
  if (!decoded || decoded.invalid) {
    return { invalid: true, reason: decoded?.reason || "malformed_payment", raw };
  }
  return { payload: decoded, raw };
}

export function paymentPayloadMatchesRequirements(payload, requirements) {
  if (!payload || payload.invalid) {
    return { ok: false, reason: "malformed_payment" };
  }
  const network = String(payload.network || "").trim().toLowerCase();
  if (network) {
    const allowed = new Set([
      BASE_NETWORK_V1,
      BASE_NETWORK_V2,
      `eip155:${BASE_CHAIN_ID}`,
    ]);
    if (!allowed.has(network)) {
      return { ok: false, reason: "unsupported_network" };
    }
  }
  const scheme = String(payload.scheme || "exact").trim().toLowerCase();
  if (scheme && scheme !== "exact") {
    return { ok: false, reason: "unsupported_scheme" };
  }

  const inner = payload.payload && typeof payload.payload === "object" ? payload.payload : payload;
  const auth = inner.authorization && typeof inner.authorization === "object" ? inner.authorization : inner;
  const to = String(auth.to || "").trim().toLowerCase();
  const payTo = String(requirements.payTo || "").trim().toLowerCase();
  if (to && payTo && to !== payTo) {
    return { ok: false, reason: "wrong_recipient" };
  }
  const valueRaw = String(auth.value ?? "").trim();
  if (valueRaw) {
    try {
      const value = BigInt(valueRaw);
      const required = BigInt(String(requirements.maxAmountRequired || "0"));
      if (value < required) return { ok: false, reason: "insufficient_amount" };
      if (requirements.scheme === "exact" && value !== required) {
        return { ok: false, reason: "amount_mismatch" };
      }
    } catch {
      return { ok: false, reason: "malformed_amount" };
    }
  }
  return { ok: true };
}

const seenNonces = new Set();

function paymentNonce(payload) {
  const inner = payload?.payload && typeof payload.payload === "object" ? payload.payload : payload;
  const auth = inner?.authorization && typeof inner.authorization === "object" ? inner.authorization : inner;
  return String(auth?.nonce || "").trim().toLowerCase();
}

function rememberNonce(nonce) {
  if (!nonce) return true;
  if (seenNonces.has(nonce)) return false;
  seenNonces.add(nonce);
  if (seenNonces.size > 20_000) {
    const first = seenNonces.values().next().value;
    seenNonces.delete(first);
  }
  return true;
}

async function cdpAuthHeader(method, url) {
  const id = CDP_API_KEY_ID();
  const secret = CDP_API_KEY_SECRET();
  if (!id || !secret) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!/cdp\.coinbase\.com$/i.test(parsed.hostname) && parsed.hostname !== "api.cdp.coinbase.com") {
    return null;
  }
  const jwt = await generateJwt({
    apiKeyId: id,
    apiKeySecret: secret,
    requestMethod: method,
    requestHost: parsed.hostname,
    requestPath: parsed.pathname,
    expiresIn: 120,
  });
  return `Bearer ${jwt}`;
}

/**
 * POST /verify then /settle on the configured facilitator.
 * `fetchImpl` is injectable for tests (no mainnet funds in CI).
 */
export async function verifyAndSettle({
  paymentRaw,
  paymentPayload,
  paymentRequirements,
  fetchImpl = fetch,
}) {
  const base = facilitatorUrl();
  const body = {
    x402Version: 1,
    paymentHeader: paymentRaw && !String(paymentRaw).trim().startsWith("{")
      ? String(paymentRaw).trim()
      : encodeJsonB64(paymentPayload),
    paymentRequirements,
    paymentPayload,
  };

  const post = async (path) => {
    const url = `${base}${path}`;
    const headers = { "Content-Type": "application/json", Accept: "application/json" };
    const auth = await cdpAuthHeader("POST", url);
    if (auth) headers.Authorization = auth;
    const res = await fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = { raw: text };
      }
    }
    return { res, json };
  };

  let verify;
  try {
    verify = await post("/verify");
  } catch (e) {
    return { ok: false, reason: "facilitator_unreachable", error: e?.message || "verify_failed" };
  }

  const verifyOk =
    verify.res.ok &&
    (verify.json?.isValid === true ||
      verify.json?.valid === true ||
      verify.json?.success === true);
  if (!verifyOk) {
    return {
      ok: false,
      reason: verify.json?.invalidReason || verify.json?.errorReason || "payment_invalid",
      status: verify.res.status,
      details: verify.json,
    };
  }

  let settle;
  try {
    settle = await post("/settle");
  } catch (e) {
    return { ok: false, reason: "facilitator_unreachable", error: e?.message || "settle_failed" };
  }

  const settleOk =
    settle.res.ok &&
    (settle.json?.success === true ||
      settle.json?.ok === true ||
      Boolean(settle.json?.transaction || settle.json?.txHash));
  if (!settleOk) {
    return {
      ok: false,
      reason: settle.json?.errorReason || settle.json?.error || "settlement_failed",
      status: settle.res.status,
      details: settle.json,
    };
  }

  return {
    ok: true,
    transaction: settle.json?.transaction || settle.json?.txHash || null,
    network: settle.json?.network || BASE_NETWORK_V1,
    settlement: settle.json,
  };
}

function x402Cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,POST,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-PAYMENT, PAYMENT-SIGNATURE, Payment-Signature, Accept"
  );
  res.setHeader(
    "Access-Control-Expose-Headers",
    [
      "WWW-Authenticate",
      "Payment-Receipt",
      "PAYMENT-REQUIRED",
      "X-PAYMENT-REQUIRED",
      "PAYMENT-RESPONSE",
      "X-PAYMENT-RESPONSE",
    ].join(", ")
  );
}

function sendX402Json(res, status, body, extraHeaders = {}) {
  x402Cors(res);
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  res.end(payload);
}

export function challengeHeaders(requirements, body) {
  const v1b64 = encodeJsonB64(body);
  const v2b64 = encodeJsonB64({
    x402Version: 2,
    accepts: [toV2Accept(requirements)],
    error: body.error,
  });
  return {
    "PAYMENT-REQUIRED": v2b64,
    "X-PAYMENT-REQUIRED": v1b64,
  };
}

/**
 * Run an x402 charge gate, then invoke `onPaid` and write the final response.
 * Always finishes the Node response. Returns true.
 *
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {{
 *   amountAtomic: string,
 *   resource: string,
 *   description: string,
 *   onPaid: (ctx: object) => Promise<object>,
 *   fetchImpl?: typeof fetch,
 * }} opts
 */
export async function withX402Charge(req, res, opts) {
  const {
    amountAtomic,
    resource,
    description,
    onPaid,
    fetchImpl = fetch,
  } = opts;

  if (x402DevBypass()) {
    try {
      const body = await onPaid({ bypass: true });
      sendX402Json(res, 200, body);
    } catch (e) {
      sendX402Json(res, e?.status || 500, e?.payload || { error: e?.message || "x402_handler_failed" });
    }
    return true;
  }

  if (!x402Configured()) {
    sendX402Json(res, 503, {
      error: "x402_not_configured",
      message:
        "Set X402_PAY_TO (or MPP_TEMPO_RECIPIENT) to a 0x Base address that receives USDC. See /agents.md.",
    });
    return true;
  }

  const requirements = buildPaymentRequirements({
    resource,
    description,
    amountAtomic,
  });
  const challenge = paymentRequiredBody({
    accepts: [requirements],
    error: "X-PAYMENT header is required",
  });

  const payment = readPaymentHeader(req);
  if (payment.missing) {
    sendX402Json(res, 402, challenge, challengeHeaders(requirements, challenge));
    return true;
  }

  if (payment.invalid) {
    const fail = paymentRequiredBody({
      accepts: [requirements],
      error: "Invalid X-PAYMENT header",
    });
    sendX402Json(res, 402, fail, challengeHeaders(requirements, fail));
    return true;
  }

  const local = paymentPayloadMatchesRequirements(payment.payload, requirements);
  if (!local.ok) {
    const fail = paymentRequiredBody({
      accepts: [requirements],
      error: `Payment rejected: ${local.reason}`,
    });
    sendX402Json(res, 402, fail, challengeHeaders(requirements, fail));
    return true;
  }

  const nonce = paymentNonce(payment.payload);
  if (nonce && !rememberNonce(nonce)) {
    const fail = paymentRequiredBody({
      accepts: [requirements],
      error: "Payment rejected: replayed_nonce",
    });
    sendX402Json(res, 402, fail, challengeHeaders(requirements, fail));
    return true;
  }

  const settled = await verifyAndSettle({
    paymentRaw: payment.raw,
    paymentPayload: payment.payload,
    paymentRequirements: requirements,
    fetchImpl,
  });

  if (!settled.ok) {
    if (nonce) seenNonces.delete(nonce);
    const fail = paymentRequiredBody({
      accepts: [requirements],
      error: `Payment rejected: ${settled.reason}`,
    });
    sendX402Json(res, 402, fail, challengeHeaders(requirements, fail));
    return true;
  }

  try {
    const body = await onPaid({
      payload: payment.payload,
      settlement: settled,
    });
    const receipt = encodeJsonB64({
      success: true,
      transaction: settled.transaction,
      network: settled.network,
    });
    sendX402Json(res, 200, body, {
      "PAYMENT-RESPONSE": receipt,
      "X-PAYMENT-RESPONSE": receipt,
    });
  } catch (e) {
    sendX402Json(
      res,
      e?.status || 500,
      e?.payload || { error: e?.message || "x402_handler_failed" }
    );
  }
  return true;
}
