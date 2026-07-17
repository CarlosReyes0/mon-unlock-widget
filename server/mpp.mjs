/**
 * Machine Payments Protocol (MPP) gate for agent publish API.
 *
 * When configured, unpaid POST /api/agents/publish returns HTTP 402 with a
 * WWW-Authenticate: Payment challenge. Paid retries include Authorization: Payment …
 *
 * Env:
 *   MPP_SECRET_KEY          — HMAC secret (≥32 bytes). openssl rand -base64 32
 *   MPP_TEMPO_RECIPIENT     — 0x address that receives Tempo pathUSD charges
 *   MPP_PUBLISH_AMOUNT      — charge amount in pathUSD (default 0.05)
 *   MPP_TEMPO_CURRENCY      — TIP-20 token (default pathUSD)
 *   MPP_REALM               — challenge realm (default mon-unlock)
 *   MPP_DEV_BYPASS=1        — skip payment (local tests only)
 *   STRIPE_SECRET_KEY       — optional: also offer Stripe SPT card charges
 */
import { Mppx, tempo, stripe } from "mppx/server";

const PATH_USD = "0x20c0000000000000000000000000000000000000";

export function mppConfigured() {
  const secret = (process.env.MPP_SECRET_KEY || "").trim();
  const recipient = (process.env.MPP_TEMPO_RECIPIENT || "").trim();
  return Boolean(secret && recipient && /^0x[a-fA-F0-9]{40}$/.test(recipient));
}

export function mppDevBypass() {
  return process.env.MPP_DEV_BYPASS === "1" || process.env.MPP_DEV_BYPASS === "true";
}

export function publishAmount() {
  const raw = (process.env.MPP_PUBLISH_AMOUNT || "0.05").trim();
  return raw || "0.05";
}

export function publishCurrency() {
  return (process.env.MPP_TEMPO_CURRENCY || PATH_USD).trim() || PATH_USD;
}

let cached = null;

function getMppx() {
  if (cached) return cached;
  if (!mppConfigured()) return null;

  const secretKey = process.env.MPP_SECRET_KEY.trim();
  const recipient = process.env.MPP_TEMPO_RECIPIENT.trim();
  const currency = publishCurrency();
  const realm = (process.env.MPP_REALM || "mon-unlock").trim() || "mon-unlock";

  const methods = [
    tempo.charge({
      currency,
      recipient,
    }),
  ];

  const stripeKey = (process.env.STRIPE_SECRET_KEY || "").trim();
  if (stripeKey.startsWith("sk_")) {
    methods.push(
      stripe.charge({
        secretKey: stripeKey,
        networkId: "internal",
        currency: "usd",
        decimals: 2,
        paymentMethodTypes: ["card"],
      })
    );
  }

  cached = Mppx.create({
    methods,
    secretKey,
    realm,
  });
  return cached;
}

function sendJson(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    ...extraHeaders,
  });
  res.end(payload);
}

/**
 * Run an MPP charge gate, then invoke `onPaid` and write the final response.
 * Always finishes the Node response. Returns true.
 */
export async function withMppCharge(req, res, { amount, scope, onPaid }) {
  if (mppDevBypass()) {
    try {
      const body = await onPaid();
      sendJson(res, 200, body);
    } catch (e) {
      sendJson(res, e?.status || 500, e?.payload || { error: e?.message || "publish_failed" });
    }
    return true;
  }

  const mppx = getMppx();
  if (!mppx) {
    sendJson(res, 503, {
      error: "mpp_not_configured",
      message:
        "Set MPP_SECRET_KEY and MPP_TEMPO_RECIPIENT on the server to accept machine payments. See /agents.md.",
    });
    return true;
  }

  const chargeAmount = amount || publishAmount();
  const entries = [["tempo/charge", { amount: chargeAmount, scope }]];
  if (mppx.methods.some((m) => m.name === "stripe" && m.intent === "charge")) {
    // Stripe charge uses decimals:2 → amount "5" means $0.05
    const cents = Math.round(Number(chargeAmount) * 100);
    entries.push([
      "stripe/charge",
      { amount: String(Number.isFinite(cents) ? cents : 5), scope },
    ]);
  }

  const handler = mppx.compose(...entries);
  const result = await Mppx.toNodeListener(handler)(req, res);

  // Challenge already written by toNodeListener.
  if (result.status === 402) return true;

  // Receipt headers were attached to `res` by toNodeListener; write the body.
  try {
    const body = await onPaid({ receipt: result.receipt });
    if (!res.headersSent) {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Access-Control-Allow-Origin", "*");
    }
    res.statusCode = 200;
    res.end(JSON.stringify(body));
  } catch (e) {
    if (!res.headersSent) {
      sendJson(res, e?.status || 500, e?.payload || { error: e?.message || "publish_failed" });
    } else {
      res.statusCode = e?.status || 500;
      res.end(JSON.stringify(e?.payload || { error: e?.message || "publish_failed" }));
    }
  }
  return true;
}

export function mppStatus() {
  return {
    configured: mppConfigured(),
    devBypass: mppDevBypass(),
    amount: publishAmount(),
    currency: publishCurrency(),
    stripeOffered: Boolean(
      (process.env.STRIPE_SECRET_KEY || "").trim().startsWith("sk_")
    ),
    endpoint: "/api/agents/publish",
    validateEndpoint: "/api/agents/publish/validate",
    openapi: "/openapi.json",
  };
}
