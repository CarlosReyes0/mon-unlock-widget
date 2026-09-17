/**
 * Free article download after unlock.
 *
 * Same entitlement as /api/article-body (wallet unlock, fiat session, or live
 * subscription). Locked / anonymous requests never receive body bytes.
 */
import { escapeHtml } from "./article-og.mjs";
import { resolveArticleAccess } from "./subscriptions.mjs";

const DOWNLOAD_PATH =
  /^\/api\/articles\/([^/]+)\/download\/?$/i;

/** True when content uses HTML tags (vs plain text with newlines). */
export function looksLikeHtml(body) {
  return /<\s*(p|br|div|span|h[1-6]|ul|ol|li|a|strong|em|blockquote|pre|code|table|section|article|img|video|audio|picture|figure|source|iframe)\b/i.test(
    String(body || "")
  );
}

/**
 * @param {unknown} pathname
 * @returns {string | null} article slug, or null if this is not a download path
 */
export function parseDownloadPath(pathname) {
  const m = String(pathname || "").match(DOWNLOAD_PATH);
  if (!m) return null;
  const raw = m[1] || "";
  try {
    return decodeURIComponent(raw).trim() || null;
  } catch {
    return raw.trim() || null;
  }
}

/**
 * @param {unknown} slug
 * @returns {string} ASCII filename ending in .html
 */
export function safeDownloadFilename(slug) {
  const base = String(slug || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 80);
  return `${base || "article"}.html`;
}

/**
 * @param {string} filename
 * @returns {string}
 */
export function contentDisposition(filename) {
  const ascii = safeDownloadFilename(filename.replace(/\.html$/i, ""));
  return `attachment; filename="${ascii}"`;
}

function stripUnsafeHtml(html) {
  return String(html || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<link\b[^>]*>/gi, "")
    .replace(/<meta\b[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "")
    .replace(/data:text\/html/gi, "");
}

function textToHtml(text) {
  const escaped = escapeHtml(text);
  if (!escaped.trim()) return "";
  return escaped
    .split(/\n{2,}/)
    .map((para) => `<p>${para.replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

function bodyToHtml(body) {
  const raw = String(body || "");
  if (!raw.trim()) return "";
  return looksLikeHtml(raw) ? stripUnsafeHtml(raw) : textToHtml(raw);
}

/**
 * Well-formed HTML file of the title + body the reader is entitled to.
 * @param {{
 *   title?: string,
 *   author?: string,
 *   teaser?: string,
 *   body?: string,
 *   articleId?: string,
 *   canonicalUrl?: string,
 * }} input
 */
export function buildDownloadHtml(input = {}) {
  const title = String(input.title || input.articleId || "Article").trim() || "Article";
  const author = String(input.author || "Author").trim() || "Author";
  const teaser = String(input.teaser || "").trim();
  const body = String(input.body || "");
  const canonical = String(input.canonicalUrl || "").trim();
  const teaserHtml = teaser ? bodyToHtml(teaser) : "";
  const bodyHtml = bodyToHtml(body);
  const skipTeaser = Boolean(teaser) && body.startsWith(teaser);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <title>${escapeHtml(title)}</title>
  ${canonical ? `<link rel="canonical" href="${escapeHtml(canonical)}" />` : ""}
  <style>
    :root { color-scheme: light; }
    body {
      margin: 0;
      color: #111827;
      background: #fff;
      font-family: Georgia, "Times New Roman", serif;
      line-height: 1.7;
    }
    article { width: min(42rem, 100%); margin: 0 auto; padding: 2rem 1.25rem 3rem; }
    h1 { font-size: 2rem; line-height: 1.25; margin: 0 0 0.5rem; }
    .byline { margin: 0 0 1.5rem; color: #57534e; font-family: system-ui, sans-serif; font-size: 0.9rem; }
    .teaser { color: #44403c; margin: 0 0 1.5rem; }
    .body p { margin: 0 0 1em; }
    .body img, .body video { max-width: 100%; height: auto; }
    footer { margin-top: 2.5rem; padding-top: 1rem; border-top: 1px solid #e7e5e4; font-family: system-ui, sans-serif; font-size: 0.75rem; color: #78716c; }
  </style>
</head>
<body>
  <article>
    <h1>${escapeHtml(title)}</h1>
    <p class="byline">By ${escapeHtml(author)}</p>
    ${skipTeaser || !teaserHtml ? "" : `<div class="teaser">${teaserHtml}</div>`}
    <div class="body">${bodyHtml}</div>
    <footer>Downloaded from Open Paywall. Included with your unlock — no extra charge.</footer>
  </article>
</body>
</html>
`;
}

/**
 * Build the download file only after access is allowed.
 * Fail closed: missing/denied entitlement never returns body bytes.
 *
 * @param {{
 *   articleId: string,
 *   reader?: string,
 *   fiatSession?: string,
 *   origin?: string,
 * }} input
 * @param {{ resolveArticleAccess?: typeof resolveArticleAccess }} [deps]
 */
export async function createArticleDownload(input, deps = {}) {
  const resolveAccess = deps.resolveArticleAccess || resolveArticleAccess;
  const access = await resolveAccess({
    articleId: input.articleId,
    reader: input.reader,
    fiatSession: input.fiatSession,
    includeBody: true,
  });

  if (!access?.allowed) {
    const err = new Error("not_unlocked");
    err.status = 403;
    throw err;
  }

  const articleId = String(access.articleId || input.articleId || "").trim();
  const origin = String(input.origin || "").replace(/\/$/, "");
  const html = buildDownloadHtml({
    title: access.title,
    author: access.author,
    teaser: access.teaser,
    body: access.body || "",
    articleId,
    canonicalUrl: origin && articleId ? `${origin}/articles/${encodeURIComponent(articleId)}` : "",
  });
  const filename = safeDownloadFilename(articleId);
  return {
    html,
    filename,
    contentType: "text/html; charset=utf-8",
    contentDisposition: contentDisposition(filename),
  };
}
