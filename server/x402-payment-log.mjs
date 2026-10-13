/**
 * Fire-and-forget x402 payment log.
 * Never throw to the paid handler and never return a promise callers could await
 * to delay the response. Failures are console.error only.
 *
 * Payer: EVM authorization.from on the decoded X-PAYMENT / PAYMENT-SIGNATURE
 * payload, else an explicit Solana payer field when the payload has one,
 * else the facilitator settle response `payer` field.
 */
import { BASE_USDC } from "./x402.mjs";

const inflight = new Set();

function supabaseEnv(env = process.env) {
  const url = String(env.SUPABASE_URL || "").trim().replace(/\/$/, "");
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  return { url, key };
}

function asObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value;
}

function textOrNull(value, max) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

function firstText(values, max) {
  for (const value of values) {
    const text = textOrNull(value, max);
    if (text) return text;
  }
  return null;
}

/**
 * @param {unknown} payload decoded X-PAYMENT / PAYMENT-SIGNATURE JSON
 * @param {unknown} settlement verifyAndSettle result or raw settle JSON
 * @returns {string | null}
 */
export function extractX402Payer(payload, settlement) {
  try {
    const fromPayload = payerFromPayload(payload);
    if (fromPayload) return fromPayload;
    return payerFromSettlement(settlement);
  } catch {
    return null;
  }
}

function payerFromPayload(payload) {
  const root = asObject(payload);
  if (!root) return null;
  const inner = asObject(root.payload) || root;
  const auth = asObject(inner.authorization) || asObject(root.authorization);
  const evmFrom = textOrNull(auth?.from, 128);
  if (evmFrom) return evmFrom;
  return firstText(
    [inner.payer, inner.feePayer, inner.account, root.payer, root.feePayer, root.account],
    128
  );
}

function payerFromSettlement(settlement) {
  const root = asObject(settlement);
  if (!root) return null;
  const nested = asObject(root.settlement);
  return firstText(
    [
      root.payer,
      root.payerAddress,
      nested?.payer,
      nested?.payerAddress,
      asObject(nested?.payer)?.address,
      asObject(root.payer)?.address,
    ],
    128
  );
}

/**
 * Tx hash from the facilitator settle response.
 * @param {unknown} settlement
 * @returns {string | null}
 */
export function extractX402Tx(settlement) {
  try {
    const root = asObject(settlement);
    if (!root) return null;
    const nested = asObject(root.settlement);
    return firstText(
      [root.transaction, root.tx, root.txHash, nested?.transaction, nested?.tx, nested?.txHash],
      128
    );
  } catch {
    return null;
  }
}

async function lookupArticlePk(slug, env) {
  const { url, key } = supabaseEnv(env);
  const cleaned = textOrNull(slug, 200);
  if (!url || !key || !cleaned) return null;
  const endpoint =
    `${url}/rest/v1/articles?select=id&article_id=eq.${encodeURIComponent(cleaned)}&limit=1`;
  const res = await fetch(endpoint, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    console.error("[x402-payment-log] article lookup failed", res.status);
    return null;
  }
  const rows = await res.json().catch(() => null);
  const id = Array.isArray(rows) ? rows[0]?.id : null;
  if (typeof id === "number" && Number.isSafeInteger(id)) return id;
  if (typeof id === "string" && /^\d+$/.test(id)) return Number(id);
  return null;
}

async function persistX402Payment(input) {
  try {
    const env = input?.env || process.env;
    const { url, key } = supabaseEnv(env);
    if (!url || !key) {
      console.error("[x402-payment-log] supabase_not_configured");
      return;
    }
    const kind = input?.kind === "publish" || input?.kind === "unlock" ? input.kind : null;
    if (!kind) {
      console.error("[x402-payment-log] invalid kind");
      return;
    }
    let articleId = null;
    try {
      articleId = await lookupArticlePk(input?.articleSlug, env);
    } catch (err) {
      console.error("[x402-payment-log] article lookup", err?.message || err);
    }
    const amount = textOrNull(input?.amountAtomic, 78);
    const row = {
      kind,
      article_id: articleId,
      payer: extractX402Payer(input?.payload, input?.settlement),
      amount_atomic: amount && /^\d+$/.test(amount) ? amount : null,
      network: textOrNull(input?.network, 80) || textOrNull(input?.payload?.network, 80) || "base",
      asset: textOrNull(input?.asset, 80) || BASE_USDC,
      tx: extractX402Tx(input?.settlement),
    };
    const res = await fetch(`${url}/rest/v1/x402_payments`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(row),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("[x402-payment-log] insert failed", res.status, detail.slice(0, 200));
    }
  } catch (err) {
    console.error("[x402-payment-log]", err?.stack || err?.message || err);
  }
}

/**
 * Schedule a payment insert. Returns undefined. Does not reject.
 * @param {object} input
 */
export function recordX402Payment(input) {
  try {
    const job = persistX402Payment(input);
    inflight.add(job);
    void job.finally(() => inflight.delete(job));
  } catch (err) {
    console.error("[x402-payment-log]", err?.stack || err?.message || err);
  }
}

/** Test helper. Production handlers must not await payment logging. */
export function pendingX402PaymentLogs() {
  return Promise.all([...inflight]);
}
