/**
 * x402 HTTP handlers — publish + unlock/read.
 * Payment gating lives in x402.mjs; this file maps paid requests onto
 * existing publishArticleForAgent / gated body loaders.
 */
import { publishArticleForAgent, validatePublishInput } from "./publish.mjs";
import { resolveAllowALaCarte } from "./access.mjs";
import {
  getWriterPlan,
  loadArticleBodyAfterPayment,
  quoteArticleUnlock,
  resolveArticleAccess,
} from "./subscriptions.mjs";
import {
  publicOriginFromReq,
  usdcAtomicForListing,
  withX402Charge,
  x402PublishAmountUsd,
  usdToUsdcAtomic,
} from "./x402.mjs";
import { ARTICLE_BODY_LIMIT, DEFAULT_JSON_BODY_LIMIT } from "./body-limit.mjs";

function decodePathSlug(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  try {
    return decodeURIComponent(s).trim();
  } catch {
    return s;
  }
}

function slugFromUnlockInput(url, parsed) {
  const fromPath = String(url.pathname || "");
  const articleMatch = fromPath.match(/^\/api\/x402\/articles\/([^/]+)\/?$/);
  const agentMatch = fromPath.match(/^\/api\/agents\/x402\/articles\/([^/]+)\/?$/);
  const pathSlug = decodePathSlug(articleMatch?.[1] || agentMatch?.[1] || "");
  return (
    pathSlug ||
    String(parsed?.articleId || parsed?.slug || url.searchParams.get("article_id") || url.searchParams.get("articleId") || url.searchParams.get("slug") || "").trim()
  );
}

function normalizeReader(value) {
  if (typeof value !== "string") return "";
  const a = value.trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(a) ? a : "";
}

/**
 * POST /api/x402/publish (and /api/agents/x402/publish)
 * Same JSON as MPP publish. Unpaid probes still 402.
 */
export async function handleX402Publish(req, res, { readBody, sendJson }) {
  let parsed = {};
  let parseError = null;
  try {
    const raw = await readBody(req, ARTICLE_BODY_LIMIT);
    parsed = raw ? JSON.parse(raw) : {};
  } catch (e) {
    if (e?.message === "body_too_large") {
      return sendJson(res, 413, { error: "body_too_large" });
    }
    parseError = "invalid_json";
  }

  const validated = parseError ? { ok: false, errors: [parseError] } : validatePublishInput(parsed);
  const paymentPresent = Boolean(
    req.headers["x-payment"] || req.headers["payment-signature"]
  );

  if (!validated.ok && paymentPresent) {
    return sendJson(res, 400, { ok: false, errors: validated.errors });
  }

  const origin = publicOriginFromReq(req);
  const amountAtomic = usdToUsdcAtomic(x402PublishAmountUsd());
  return withX402Charge(req, res, {
    amountAtomic,
    resource: `${origin}/api/x402/publish`,
    description: `Create one embeddable paywall — $${x402PublishAmountUsd()} USDC on Base`,
    onPaid: async () => {
      if (!validated.ok) {
        const err = new Error("invalid_input");
        err.status = 400;
        err.payload = { ok: false, errors: validated.errors };
        throw err;
      }
      const published = await publishArticleForAgent(validated.input);
      return {
        ...published,
        payment: {
          protocol: "x402",
          network: "base",
          asset: "USDC",
          amountUsd: x402PublishAmountUsd(),
        },
        nextSteps: [
          ...(published.nextSteps || []),
          "On-chain register is still a publisher wallet step (finishRegistrationUrl). x402 only paid the agent publish fee.",
        ],
      };
    },
  });
}

/**
 * GET/POST /api/x402/unlock and /api/x402/articles/:slug
 *
 * - Existing entitlement (reader wallet / fiat_session) → 200 body, no charge
 * - Else unpaid → 402 with USDC-on-Base requirements (never includes body)
 * - Paid + verified → 200 with body
 */
export async function handleX402Unlock(req, res, { url, readBody, sendJson }) {
  let parsed = {};
  if (req.method === "POST") {
    try {
      const raw = await readBody(req, DEFAULT_JSON_BODY_LIMIT);
      parsed = raw ? JSON.parse(raw) : {};
    } catch (e) {
      if (e?.message === "body_too_large") {
        return sendJson(res, 413, { error: "body_too_large" });
      }
      return sendJson(res, 400, { error: "invalid_json" });
    }
  }

  const articleId = slugFromUnlockInput(url, parsed);
  if (!articleId) {
    return sendJson(res, 400, {
      error: "invalid_article_id",
      message: "Pass articleId/slug as /api/x402/articles/{slug} or JSON/query articleId.",
    });
  }

  const reader = normalizeReader(
    parsed.reader || url.searchParams.get("reader")
  );
  const fiatSession = String(
    parsed.fiatSession ||
      parsed.fiat_session ||
      url.searchParams.get("fiat_session") ||
      url.searchParams.get("fiatSession") ||
      ""
  ).trim();

  if (reader || fiatSession) {
    try {
      const access = await resolveArticleAccess({
        articleId,
        reader,
        fiatSession,
        includeBody: true,
      });
      if (access.allowed) {
        return sendJson(res, 200, {
          ok: true,
          paid: false,
          reason: access.reason,
          articleId: access.articleId,
          body: access.body || "",
        });
      }
    } catch (e) {
      if (e?.message === "article_not_found") {
        return sendJson(res, 404, { error: "article_not_found" });
      }
      if (e?.message === "not_unlocked") {
        /* fall through to x402 charge */
      } else if (e?.status === 404) {
        return sendJson(res, 404, { error: "article_not_found" });
      } else if (e?.message === "supabase_not_configured") {
        return sendJson(res, 503, { error: "supabase_not_configured" });
      } else if (e?.message !== "not_unlocked" && e?.status && e.status !== 403) {
        return sendJson(res, e.status || 500, { error: e.message || "unlock_failed" });
      }
    }
  }

  let meta;
  try {
    meta = await quoteArticleUnlock(articleId);
  } catch (e) {
    if (e?.message === "supabase_not_configured") {
      return sendJson(res, 503, { error: "supabase_not_configured" });
    }
    return sendJson(res, e?.status || 500, { error: e?.message || "quote_failed" });
  }

  if (!meta?.publisher) {
    return sendJson(res, 404, { error: "article_not_found" });
  }

  let allowALaCarte = meta.allow_a_la_carte !== false;
  try {
    const plan = await getWriterPlan(meta.publisher);
    allowALaCarte = resolveAllowALaCarte({
      articleAllow: meta.allow_a_la_carte,
      writerAllow: plan.allowALaCarte,
    });
  } catch {
    /* missing plan = allow buy */
  }
  if (!allowALaCarte && !reader && !fiatSession) {
    return sendJson(res, 403, {
      error: "subscribe_only",
      message: "This article does not offer a-la-carte unlock.",
    });
  }

  const amountAtomic = usdcAtomicForListing(meta.price_wei, meta.payment_asset);
  const origin = publicOriginFromReq(req);
  const listingNote =
    String(meta.payment_asset || "usdc").toLowerCase() === "usdc"
      ? "Matches the listing's USDC price. Settlement is USDC on Base (Bankr rail), not Monad."
      : "Listing is priced in MON on Monad. Agent x402 charges the default USDC amount on Base instead.";

  return withX402Charge(req, res, {
    amountAtomic,
    resource: `${origin}/api/x402/articles/${encodeURIComponent(articleId)}`,
    description: `Unlock "${meta.title || articleId}" — USDC on Base`,
    onPaid: async ({ settlement }) => {
      const paid = await loadArticleBodyAfterPayment(articleId);
      if (!paid) {
        const err = new Error("article_not_found");
        err.status = 404;
        err.payload = { error: "article_not_found" };
        throw err;
      }
      return {
        ok: true,
        paid: true,
        reason: "x402",
        articleId: paid.articleId,
        publisher: paid.publisher,
        paymentAsset: paid.paymentAsset,
        body: paid.body || "",
        payment: {
          protocol: "x402",
          network: "base",
          asset: "USDC",
          amountAtomic,
          transaction: settlement?.transaction || null,
          note: listingNote,
        },
      };
    },
  });
}
