/**
 * Server-side listing API (feed + admin hide) using Supabase REST.
 */
import {
  formatPriceLabel,
  normalizeExternalUrl,
  toPublicListing,
} from "./listings.mjs";
import { getWriterPlan } from "./subscriptions.mjs";

const SUPABASE_URL = (process.env.SUPABASE_URL || "").trim().replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const LISTING_ADMIN_SECRET = (process.env.LISTING_ADMIN_SECRET || "").trim();

const PUBLIC_COLS =
  "article_id,title,author,teaser,price_wei,payment_asset,publisher,external_url,listed_at,listing_status,embed_sig,allow_a_la_carte";

export function listingsSupabaseConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

export function listingAdminConfigured() {
  return Boolean(LISTING_ADMIN_SECRET);
}

/**
 * @param {string} path
 * @param {object} [opts]
 */
async function supabase(path, opts = {}) {
  if (!listingsSupabaseConfigured()) {
    const err = new Error("supabase_not_configured");
    err.status = 503;
    throw err;
  }
  const method = opts.method || "GET";
  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    Prefer: opts.prefer || "return=representation",
    ...(opts.headers || {}),
  };
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers,
    body: opts.body != null ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const err = new Error(
      (data && data.message) || (data && data.error) || `supabase_${res.status}`
    );
    err.status = res.status >= 400 && res.status < 600 ? res.status : 502;
    err.data = data;
    throw err;
  }
  return data;
}

export async function listPublicArticles({ limit = 50 } = {}) {
  const capped = Math.min(100, Math.max(1, Number(limit) || 50));
  const path =
    `articles?select=${PUBLIC_COLS}` +
    `&listing_status=eq.listed` +
    `&article_id=not.is.null` +
    `&order=listed_at.desc.nullslast` +
    `&limit=${capped}`;
  const rows = await supabase(path);
  const articles = (Array.isArray(rows) ? rows : [])
    .map((row) => toPublicListing(row))
    .filter(Boolean)
    .map((a) => ({
      ...a,
      priceLabel: formatPriceLabel(a.priceWei, a.paymentAsset),
      href: `/articles/${encodeURIComponent(a.slug)}`,
    }));
  return { articles };
}

export async function getPublicArticle(slug) {
  const slugNorm = String(slug || "").trim();
  if (!slugNorm) {
    const err = new Error("missing_slug");
    err.status = 400;
    throw err;
  }
  const path =
    `articles?select=${PUBLIC_COLS}` +
    `&article_id=eq.${encodeURIComponent(slugNorm)}` +
    `&listing_status=eq.listed` +
    `&limit=1`;
  const rows = await supabase(path);
  const row = Array.isArray(rows) ? rows[0] : null;
  const article = toPublicListing(row || {});
  if (!article) {
    const err = new Error("not_found");
    err.status = 404;
    throw err;
  }
  let plan = null;
  try {
    if (article.publisher) plan = await getWriterPlan(article.publisher);
  } catch {
    plan = null;
  }
  return {
    article: {
      ...article,
      priceLabel: formatPriceLabel(article.priceWei, article.paymentAsset),
      href: `/articles/${encodeURIComponent(article.slug)}`,
      plan,
    },
  };
}

/**
 * Moderator hide (or restore to unlisted). Requires LISTING_ADMIN_SECRET bearer.
 */
export async function adminSetListingStatus({ slug, status, authorization }) {
  if (!listingAdminConfigured()) {
    const err = new Error("listing_admin_not_configured");
    err.status = 503;
    throw err;
  }
  const expected = `Bearer ${LISTING_ADMIN_SECRET}`;
  if (String(authorization || "").trim() !== expected) {
    const err = new Error("unauthorized");
    err.status = 401;
    throw err;
  }
  const slugNorm = String(slug || "").trim();
  if (!slugNorm) {
    const err = new Error("missing_slug");
    err.status = 400;
    throw err;
  }
  if (status !== "hidden" && status !== "unlisted" && status !== "listed") {
    const err = new Error("invalid_status");
    err.status = 400;
    throw err;
  }
  const patch = {
    listing_status: status,
    updated_at: new Date().toISOString(),
  };
  if (status === "listed") {
    patch.listed_at = new Date().toISOString();
  }
  const path = `articles?article_id=eq.${encodeURIComponent(slugNorm)}`;
  const rows = await supabase(path, {
    method: "PATCH",
    body: patch,
  });
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row) {
    const err = new Error("not_found");
    err.status = 404;
    throw err;
  }
  return {
    success: true,
    article_id: row.article_id,
    listing_status: row.listing_status,
  };
}

export { normalizeExternalUrl };
