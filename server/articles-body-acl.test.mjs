/**
 * Regression: paid articles.body must not leak through the public anon Data API.
 *
 * Source assertions always run. Live REST smoke uses the anon key embedded in
 * article.html (the same key as production) and is skipped only if the network
 * is unreachable.
 *
 * Documented smoke (same checks as the live tests below):
 *   GET /rest/v1/articles?select=body&article_id=eq.the-quote-was-a-trap-939i9e
 *     → must not return paid text
 *   GET /rest/v1/articles?select=article_id,title,teaser,... (listing cols)
 *     → 200 with public fields
 *   GET /api/article-body?article_id=… (no reader) → reader_or_fiat_session_required
 *   GET /api/article-body?article_id=…&reader=0x000…0001 → 403 not_unlocked
 *     (proves service-role body lookup still works; a missing body grant 500s)
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SLUG = "the-quote-was-a-trap-939i9e";
const LISTING_SELECT =
  "article_id,title,author,teaser,price_wei,payment_asset,publisher,external_url,embed_sig,listing_status,allow_a_la_carte";

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function embeddedAnonConfig() {
  const html = read("article.html");
  const url = html.match(/const SUPABASE_URL = "([^"]+)"/)?.[1];
  const key = html.match(/const SUPABASE_ANON_KEY =\s*"([^"]+)"/)?.[1];
  assert.ok(url && key, "article.html must embed SUPABASE_URL and SUPABASE_ANON_KEY");
  return { url, key };
}

test("migration revokes articles.body from anon/authenticated and re-grants listing columns", () => {
  const sql = read("supabase/migrations/20260916094014_restrict_articles_body.sql");
  assert.match(sql, /revoke select on table public\.articles from anon, authenticated/i);
  assert.match(sql, /grant select \(/i);
  assert.match(sql, /\bteaser\b/);
  assert.match(sql, /\barticle_id\b/);
  assert.match(sql, /\ballow_a_la_carte\b/);
  assert.match(sql, /\bembed_sig\b/);
  assert.doesNotMatch(
    sql.replace(/--[^\n]*/g, ""),
    /grant select \([^)]*\bbody\b/i
  );
});

test("article NFT metadata never selects articles.body", () => {
  const nft = read("server/article-nft.mjs");
  const sql = read("supabase/migrations/0011_article_nfts.sql");
  assert.match(nft, /ARTICLE_META_COLS/);
  assert.doesNotMatch(nft.split("ARTICLE_META_COLS")[1].split(";")[0], /\bbody\b/);
  assert.match(nft, /delete metadata.body/);
  assert.match(sql, /article_nfts/);
  assert.match(sql, /role in \('edition', 'receipt'\)/);
});

test("dashboard does not select articles.body or wildcard columns", () => {
  const html = read("dashboard.html");
  assert.match(html, /\.from\('articles'\)/);
  assert.doesNotMatch(html, /\.select\(\s*['"]\*['"]\s*\)/);
  assert.match(html, /article_id,article_id_hash,publisher,price_wei/);
  assert.doesNotMatch(html, /body: a\.body/);
});

test("public listing surfaces never request or return body", () => {
  const listings = read("server/listings-api.mjs");
  const articlePage = read("article.html");
  const feed = read("articles.html");
  assert.match(listings, /const PUBLIC_COLS =/);
  assert.doesNotMatch(listings.split("PUBLIC_COLS")[1].split(";")[0], /\bbody\b/);
  assert.match(articlePage, /select=article_id,title,author,teaser/);
  assert.doesNotMatch(
    articlePage.match(/select=([^\n"]+)/)?.[1] || "",
    /\bbody\b/
  );
  assert.doesNotMatch(
    feed.match(/select=([^\n"]+)/)?.[1] || "",
    /\bbody\b/
  );
});

test("hosted article page assigns teaser as text, never innerHTML of listing teaser", () => {
  const articlePage = read("article.html");
  assert.match(articlePage, /teaser\.textContent\s*=\s*article\.teaser/);
  assert.doesNotMatch(articlePage, /teaser\.innerHTML\s*=\s*article\.teaser/);
  assert.match(articlePage, /Body intentionally omitted/);
});

test("article-body unlock paths read body with the service role key", () => {
  const edge = read("supabase/functions/article-body/index.ts");
  const railway = read("server/subscriptions.mjs");
  assert.match(edge, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(edge, /\.select\('article_id_hash, body'\)/);
  assert.match(railway, /includeBody/);
  assert.match(
    railway,
    /article_id,article_id_hash,publisher,price_wei,listing_status,payment_asset,allow_a_la_carte,title,author,teaser,body/
  );
});

test("download is gated on the same entitlement as article-body", () => {
  const index = read("server/index.mjs");
  const download = read("server/article-download.mjs");
  const widget = read("src/widget/mon-unlock.ts");
  const listings = read("server/listings-api.mjs");
  const og = read("server/article-og.mjs");
  assert.match(index, /parseDownloadPath/);
  assert.match(download, /includeBody: true/);
  assert.match(download, /not_unlocked/);
  assert.match(widget, /downloadArticle/);
  assert.match(widget, /Free with your unlock/);
  assert.doesNotMatch(listings.split("PUBLIC_COLS")[1].split(";")[0], /\bbody\b/);
  assert.doesNotMatch(og, /\/api\/articles\/.*\/download/);
});

async function rest(url, key, select) {
  const qs = `select=${select}&article_id=eq.${encodeURIComponent(SLUG)}&limit=1`;
  const res = await fetch(`${url}/rest/v1/articles?${qs}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { res, text, json };
}

function paidTextLeaked(payload) {
  const dump = typeof payload === "string" ? payload : JSON.stringify(payload || "");
  if (!dump) return false;
  if (/Could not find the 'body' column/i.test(dump)) return false;
  if (/permission denied/i.test(dump)) return false;
  const rows = Array.isArray(payload) ? payload : [];
  return rows.some((row) => typeof row?.body === "string" && row.body.trim().length > 0);
}

test("anon REST select=body does not return paid text (live)", async (t) => {
  const { url, key } = embeddedAnonConfig();
  let got;
  try {
    got = await rest(url, key, "body");
  } catch (e) {
    t.skip(`supabase rest unreachable: ${e?.message || e}`);
    return;
  }
  assert.equal(
    paidTextLeaked(got.json),
    false,
    `anon select=body leaked paid text (HTTP ${got.res.status}): ${got.text.slice(0, 200)}`
  );
  assert.notEqual(got.res.status, 200, `expected non-200 for select=body, got ${got.res.status} ${got.text.slice(0, 200)}`);
});

test("anon REST can still read public listing columns (live)", async (t) => {
  const { url, key } = embeddedAnonConfig();
  let got;
  try {
    got = await rest(url, key, LISTING_SELECT);
  } catch (e) {
    t.skip(`supabase rest unreachable: ${e?.message || e}`);
    return;
  }
  assert.equal(got.res.status, 200, got.text.slice(0, 300));
  assert.ok(Array.isArray(got.json) && got.json[0], "expected a listed article row");
  const row = got.json[0];
  assert.equal(row.article_id, SLUG);
  assert.ok(row.title);
  assert.equal("body" in row, false);
  assert.ok(typeof row.teaser === "string");
});

const RAILWAY = "https://openpaywall.app";

async function railwayArticleBody(params) {
  const res = await fetch(`${RAILWAY}/api/article-body?${params}`);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { res, text, json };
}

test("production /api/article-body without proof still requires a session (live)", async (t) => {
  let got;
  try {
    got = await railwayArticleBody(`article_id=${encodeURIComponent(SLUG)}`);
  } catch (e) {
    t.skip(`railway unreachable: ${e?.message || e}`);
    return;
  }
  assert.equal(got.res.status, 400, got.text.slice(0, 300));
  assert.equal(got.json?.error, "reader_or_fiat_session_required");
});

test("production /api/article-body with a fake wallet is not_unlocked (live)", async (t) => {
  let got;
  try {
    got = await railwayArticleBody(
      `article_id=${encodeURIComponent(SLUG)}&reader=0x0000000000000000000000000000000000000001`
    );
  } catch (e) {
    t.skip(`railway unreachable: ${e?.message || e}`);
    return;
  }
  // 403 means service-role SELECT of body succeeded and the unlock gate ran.
  // 500 would mean the body column grant/lookup broke.
  assert.equal(got.res.status, 403, got.text.slice(0, 300));
  assert.equal(got.json?.error, "not_unlocked");
});

async function railwayDownload(slug, params) {
  const qs = params ? `?${params}` : "";
  const res = await fetch(`${RAILWAY}/api/articles/${encodeURIComponent(slug)}/download${qs}`);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { res, text, json };
}

test("production article download without proof is not a public file (live)", async (t) => {
  let got;
  try {
    got = await railwayDownload(SLUG);
  } catch (e) {
    t.skip(`railway unreachable: ${e?.message || e}`);
    return;
  }
  if (got.res.status === 404) {
    t.skip("production has not deployed article download yet");
    return;
  }
  assert.equal(got.res.status, 400, got.text.slice(0, 300));
  assert.equal(got.json?.error, "reader_or_fiat_session_required");
  assert.match(got.res.headers.get("content-type") || "", /application\/json/);
  assert.equal(typeof got.json?.body, "undefined");
});

test("production article download with a fake wallet is not_unlocked (live)", async (t) => {
  let got;
  try {
    got = await railwayDownload(
      SLUG,
      "reader=0x0000000000000000000000000000000000000001"
    );
  } catch (e) {
    t.skip(`railway unreachable: ${e?.message || e}`);
    return;
  }
  if (got.res.status === 404) {
    t.skip("production has not deployed article download yet");
    return;
  }
  assert.equal(got.res.status, 403, got.text.slice(0, 300));
  assert.equal(got.json?.error, "not_unlocked");
  assert.match(got.res.headers.get("content-type") || "", /application\/json/);
  assert.equal(typeof got.json?.body, "undefined");
});
