/**
 * Unpaid freshness probe for the x402 publish, article unlock, and validate routes.
 *
 * Env:
 *   X402_REPORT_PROBE_SECRET  — required. Header x-x402-report-probe-secret.
 *                               Vault name x402_report_probe_secret. Empty never matches.
 *   X402_REPORT_PROBE_SLUG    — article slug for GET /api/x402/articles/{slug}.
 *
 * The probe never sends a payment header and never calls a facilitator.
 * The only write is the report_checks upsert.
 */
import { decodeJsonB64OrJson, publicOriginFromReq } from "./x402.mjs";
import { requestHasHeaderSecret } from "./follow-core.mjs";

export const X402_REPORT_PROBE_HEADER = "x-x402-report-probe-secret";
export const X402_REPORT_PROBE_SECRET_ENV = "X402_REPORT_PROBE_SECRET";
export const X402_REPORT_PROBE_SLUG_ENV = "X402_REPORT_PROBE_SLUG";

export const PROBE_PUBLISH = "POST /api/x402/publish";
export const PROBE_ARTICLE = "GET /api/x402/articles/{slug}";
export const PROBE_VALIDATE = "POST /api/agents/publish/validate";

/** Valid enough for validate to return 200. Does not publish. */
export const HARMLESS_VALIDATE_BODY = Object.freeze({
  title: "Freshness probe",
  articleId: "x402-report-probe",
  teaser: "Unpaid probe. This request does not publish.",
  body: "Unpaid freshness probe body. It must not create an article.",
  publisher: "0x0000000000000000000000000000000000000001",
});

const PAYMENT_HEADER_NAMES = ["x-payment", "payment-signature", "authorization", "x-reader-session", "cookie"];

function challengeObject(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const version = body.x402Version;
  if (version !== 1 && version !== 2 && version !== "1" && version !== "2") return false;
  if (!Array.isArray(body.accepts) || body.accepts.length === 0) return false;
  return body.accepts.some((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const network = String(entry.network || "").trim();
    const scheme = String(entry.scheme || "").trim();
    return Boolean(network || scheme);
  });
}

function decodePaymentRequired(header) {
  if (!header) return null;
  try {
    const decoded = decodeJsonB64OrJson(header);
    if (!decoded || decoded.invalid) return null;
    return decoded;
  } catch {
    return null;
  }
}

export function isValidX402Challenge(body, paymentRequiredHeader) {
  try {
    if (challengeObject(body)) return true;
    return challengeObject(decodePaymentRequired(paymentRequiredHeader));
  } catch {
    return false;
  }
}

export function acceptsNetworksFrom(body, paymentRequiredHeader) {
  const nets = [];
  const collect = (source) => {
    if (!source || !Array.isArray(source.accepts)) return;
    for (const entry of source.accepts) {
      const network = String(entry?.network || "").trim();
      if (network) nets.push(network);
    }
  };
  try {
    collect(body);
    collect(decodePaymentRequired(paymentRequiredHeader));
  } catch {
    /* ignore malformed challenge bodies */
  }
  return [...new Set(nets)];
}

/**
 * 402 + valid challenge → live_402_challenge
 * 200 → live_200_free
 * anything else → failing
 */
export function classifyProbeResponse({ httpStatus, body, paymentRequiredHeader }) {
  const status = Number(httpStatus);
  if (status === 200) return "live_200_free";
  if (status === 402 && isValidX402Challenge(body, paymentRequiredHeader)) return "live_402_challenge";
  return "failing";
}

export function buildProbeCall({ origin, method, path, body }) {
  const url = new URL(path, origin).toString();
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  for (const name of PAYMENT_HEADER_NAMES) {
    if (name in headers) delete headers[name];
  }
  return {
    url,
    init: {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
      cache: "no-store",
    },
  };
}

function probeTargets(origin, slug) {
  const targets = [
    {
      endpoint: PROBE_PUBLISH,
      articleId: null,
      method: "POST",
      path: "/api/x402/publish",
      body: {},
    },
  ];
  if (slug) {
    targets.push({
      endpoint: PROBE_ARTICLE,
      articleId: slug,
      method: "GET",
      path: `/api/x402/articles/${encodeURIComponent(slug)}`,
    });
  } else {
    targets.push({
      endpoint: PROBE_ARTICLE,
      articleId: null,
      missingSlug: true,
    });
  }
  targets.push({
    endpoint: PROBE_VALIDATE,
    articleId: null,
    method: "POST",
    path: "/api/agents/publish/validate",
    body: { ...HARMLESS_VALIDATE_BODY },
  });
  return targets.map((target) => ({ ...target, origin }));
}

async function probeOne(target, fetchImpl) {
  const started = Date.now();
  if (target.missingSlug) {
    return {
      endpoint: target.endpoint,
      article_id: null,
      status: "failing",
      details: {
        httpStatus: null,
        acceptsNetworks: [],
        latencyMs: 0,
        method: "GET",
        url: null,
        error: "X402_REPORT_PROBE_SLUG unset",
      },
    };
  }
  const call = buildProbeCall(target);
  try {
    const res = await fetchImpl(call.url, {
      ...call.init,
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    let body = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
    }
    const paymentRequiredHeader =
      typeof res.headers?.get === "function"
        ? res.headers.get("payment-required") || res.headers.get("PAYMENT-REQUIRED")
        : "";
    const httpStatus = res.status;
    return {
      endpoint: target.endpoint,
      article_id: target.articleId,
      status: classifyProbeResponse({ httpStatus, body, paymentRequiredHeader }),
      details: {
        httpStatus,
        acceptsNetworks: acceptsNetworksFrom(body, paymentRequiredHeader),
        latencyMs: Math.max(0, Date.now() - started),
        method: target.method,
        url: call.url,
      },
    };
  } catch (err) {
    return {
      endpoint: target.endpoint,
      article_id: target.articleId,
      status: "failing",
      details: {
        httpStatus: null,
        acceptsNetworks: [],
        latencyMs: Math.max(0, Date.now() - started),
        method: target.method,
        url: call.url,
        error: String(err?.message || err).slice(0, 300),
      },
    };
  }
}

export async function runUnpaidProbe({ origin, slug, fetchImpl = fetch }) {
  const targets = probeTargets(origin, String(slug || "").trim());
  return Promise.all(targets.map((target) => probeOne(target, fetchImpl)));
}

function dbEnv(env) {
  const url = String(env.SUPABASE_URL || "").trim().replace(/\/$/, "");
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  return { url, key };
}

export async function upsertReportChecks(rows, env = process.env, fetchImpl = fetch) {
  const { url, key } = dbEnv(env);
  if (!url || !key) {
    const err = new Error("supabase_not_configured");
    err.status = 503;
    throw err;
  }
  const stamped = rows.map((row) => ({
    endpoint: row.endpoint,
    article_id: row.article_id ?? null,
    last_tested: new Date().toISOString(),
    status: row.status,
    details: row.details || {},
  }));
  const res = await fetchImpl(`${url}/rest/v1/report_checks?on_conflict=endpoint`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(stamped),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const err = new Error(`report_checks_upsert_${res.status}`);
    err.status = 502;
    err.detail = detail.slice(0, 200);
    throw err;
  }
}

export async function handleX402ReportProbe(req, res, { sendJson, fetchImpl = fetch, env = process.env } = {}) {
  const secret = env[X402_REPORT_PROBE_SECRET_ENV];
  if (!requestHasHeaderSecret(req?.headers, secret, X402_REPORT_PROBE_HEADER)) {
    return sendJson(res, 401, { error: "unauthorized" });
  }
  const { url, key } = dbEnv(env);
  if (!url || !key) {
    return sendJson(res, 503, { error: "supabase_not_configured" });
  }
  try {
    const origin = publicOriginFromReq(req);
    const checks = await runUnpaidProbe({
      origin,
      slug: env[X402_REPORT_PROBE_SLUG_ENV],
      fetchImpl,
    });
    await upsertReportChecks(checks, env, fetchImpl);
    return sendJson(res, 200, { ok: true, checks });
  } catch (err) {
    console.error("[x402-report-probe]", err?.message || err);
    const status = err?.status || 500;
    return sendJson(res, status, { error: err?.message || "probe_failed" });
  }
}
