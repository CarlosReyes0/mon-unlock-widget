/**
 * Shared OG/article HTML handlers for the production server and Vite `npm run dev`.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { publicOrigin, renderArticlePage, renderFeedPage } from "./article-og.mjs";
import { getArticleOgJpeg, parseOgImagePath, warmupOgCard } from "./og-card.mjs";
import { getPublicArticle, listingsSupabaseConfigured } from "./listings-api.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function listingFixtures() {
  const p = String(process.env.OG_LISTING_FIXTURES || "").trim();
  if (!p) return null;
  try {
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    return data && typeof data === "object" ? data : null;
  } catch {
    return null;
  }
}

export function listingLoader() {
  const fixtures = listingFixtures();
  if (fixtures) {
    return async (id) => (Object.prototype.hasOwnProperty.call(fixtures, id) ? fixtures[id] : null);
  }
  if (!listingsSupabaseConfigured()) return null;
  return async (id) => {
    const { article } = await getPublicArticle(id);
    return article;
  };
}

export function parseArticleSlug(pathname) {
  const p = String(pathname || "");
  if (!p.startsWith("/articles/")) return null;
  const raw = p.slice("/articles/".length);
  if (!raw || raw.includes("/")) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export async function loadListedArticle(slug) {
  const load = listingLoader();
  if (!load || !slug) return null;
  try {
    return await load(slug);
  } catch {
    return null;
  }
}

export async function articleHtmlForSlug(req, slug) {
  const html = fs.readFileSync(path.join(ROOT, "article.html"), "utf8");
  const origin = publicOrigin(req);
  const article = await loadListedArticle(slug);
  const body = await renderArticlePage({ html, slug, origin, article });
  if (article) warmupOgCard(slug, article);
  return Buffer.from(body, "utf8");
}

export function feedHtmlForReq(req) {
  const html = fs.readFileSync(path.join(ROOT, "articles.html"), "utf8");
  const body = renderFeedPage({ html, origin: publicOrigin(req) });
  return Buffer.from(body, "utf8");
}

export function isFeedPath(pathname) {
  const p = String(pathname || "").split("?")[0];
  return p === "/" || p === "/articles" || p === "/articles/";
}

export async function ogJpegForSlug(slug) {
  return getArticleOgJpeg(slug, { loadArticle: listingLoader() });
}

/**
 * Connect-style handler for Vite. Returns true if the request was fully answered.
 */
export async function tryHandleOgRequest(req, res) {
  const method = req.method || "GET";
  if (method !== "GET" && method !== "HEAD") return false;
  const pathOnly = String(req.url || "").split("?")[0];

  const ogSlug = parseOgImagePath(pathOnly);
  if (ogSlug) {
    const buf = await ogJpegForSlug(ogSlug);
    res.statusCode = 200;
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=60");
    res.setHeader("Content-Length", String(buf.length));
    if (method === "HEAD") res.end();
    else res.end(buf);
    return true;
  }

  const slug = parseArticleSlug(pathOnly);
  if (slug) {
    const buf = await articleHtmlForSlug(req, slug);
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=60");
    res.setHeader("Content-Length", String(buf.length));
    if (method === "HEAD") res.end();
    else res.end(buf);
    return true;
  }

  if (isFeedPath(pathOnly)) {
    const buf = feedHtmlForReq(req);
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=60");
    res.setHeader("Content-Length", String(buf.length));
    if (method === "HEAD") res.end();
    else res.end(buf);
    return true;
  }

  return false;
}
