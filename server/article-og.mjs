/**
 * Open Graph / Twitter Card tags for hosted article URLs.
 *
 * Crawlers (Twitterbot, Slackbot, iMessage) do not run the article page JS, so
 * /articles/{slug} injects these tags into the HTML response.
 *
 * Cover images: articles have no image column. Listed posts get a generated
 * layout-B card at /og/{slug}.jpg (title + teaser + price). Missing listings
 * or generator failure fall back to assets/og-default.jpg. A listing object's
 * own https imageUrl / ogImage / coverImage still wins (extension point —
 * do not select a missing Supabase column).
 */

export const OG_IMAGE_PATH = "/assets/og-default.jpg";
export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;
export const OG_DESCRIPTION_MAX = 125;
export const TWITTER_SITE = "@openpaywall";
export const SITE_NAME = "Open Paywall";
export const DEFAULT_DESCRIPTION =
  "Read this article on Open Paywall. One unlock works here and on the publisher’s site.";

/** Stable public path for a per-article share card. */
export function articleOgImagePath(slug) {
  return `/og/${encodeURIComponent(String(slug || "").trim())}.jpg`;
}

export function publicOrigin(req) {
  const proto =
    String(req?.headers?.["x-forwarded-proto"] || "http")
      .split(",")[0]
      .trim() || "http";
  const host =
    String(req?.headers?.host || "localhost")
      .split(",")[0]
      .trim() || "localhost";
  return `${proto}://${host}`;
}

export function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function plainText(htmlOrText, maxLen = 200) {
  const text = String(htmlOrText || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  if (!maxLen || text.length <= maxLen) return text;
  const cut = text.slice(0, maxLen - 1);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > 80 ? cut.slice(0, sp) : cut).trim()}…`;
}

export function absoluteHttpUrl(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Prefer a listing's own https image when present; otherwise the default card. */
export function resolveShareImageUrl(article, fallbackImage) {
  const custom = absoluteHttpUrl(
    article?.imageUrl || article?.ogImage || article?.coverImage || article?.og_image
  );
  return custom || fallbackImage;
}

export function defaultShareMeta({ canonical, fallbackImage }) {
  return {
    title: SITE_NAME,
    documentTitle: "Article — Open Paywall",
    description: DEFAULT_DESCRIPTION,
    url: canonical,
    imageUrl: fallbackImage,
    imageAlt: SITE_NAME,
    siteName: SITE_NAME,
    twitterSite: TWITTER_SITE,
    type: "website",
  };
}

export function shareMetaFromArticle(article, { canonical, fallbackImage, generatedImage }) {
  const title = plainText(article?.title, 70) || SITE_NAME;
  const description =
    plainText(article?.teaser, OG_DESCRIPTION_MAX) ||
    plainText(DEFAULT_DESCRIPTION, OG_DESCRIPTION_MAX);
  const author = plainText(article?.author, 80);
  return {
    title,
    documentTitle: `${title} — Open Paywall`,
    description,
    url: canonical,
    imageUrl: resolveShareImageUrl(article, generatedImage || fallbackImage),
    imageAlt: title,
    siteName: SITE_NAME,
    twitterSite: TWITTER_SITE,
    type: "article",
    author: author && author !== "Author" ? author : "",
  };
}

export function buildShareMetaTags(share) {
  const imageType = /\.png(\?|$)/i.test(share.imageUrl || "")
    ? "image/png"
    : /\.webp(\?|$)/i.test(share.imageUrl || "")
      ? "image/webp"
      : "image/jpeg";
  const tags = [
    ["name", "description", share.description],
    ["property", "og:type", share.type || "article"],
    ["property", "og:site_name", share.siteName],
    ["property", "og:title", share.title],
    ["property", "og:description", share.description],
    ["property", "og:url", share.url],
    ["property", "og:image", share.imageUrl],
    [
      "property",
      "og:image:secure_url",
      String(share.imageUrl || "").startsWith("https:") ? share.imageUrl : "",
    ],
    ["property", "og:image:alt", share.imageAlt || share.title],
    ["property", "og:image:width", String(OG_IMAGE_WIDTH)],
    ["property", "og:image:height", String(OG_IMAGE_HEIGHT)],
    ["property", "og:image:type", imageType],
    ["name", "twitter:card", "summary_large_image"],
    ["name", "twitter:site", share.twitterSite],
    ["name", "twitter:title", share.title],
    ["name", "twitter:description", share.description],
    ["name", "twitter:image", share.imageUrl],
    ["name", "twitter:image:alt", share.imageAlt || share.title],
  ];
  if (share.author) {
    tags.push(["property", "article:author", share.author]);
  }
  const lines = ["  <!-- open-paywall-share-meta -->"];
  for (const [attr, key, value] of tags) {
    if (!value) continue;
    lines.push(`  <meta ${attr}="${escapeHtml(key)}" content="${escapeHtml(value)}" />`);
  }
  if (share.url) {
    lines.push(`  <link rel="canonical" href="${escapeHtml(share.url)}" />`);
  }
  lines.push("  <!-- /open-paywall-share-meta -->");
  return lines.join("\n");
}

export function injectShareMeta(html, metaBlock, documentTitle) {
  let out = String(html || "");
  out = out.replace(
    /\n?\s*<!-- open-paywall-share-meta -->[\s\S]*?<!-- \/open-paywall-share-meta -->\s*/g,
    "\n"
  );
  if (documentTitle) {
    out = out.replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtml(documentTitle)}</title>`);
  }
  if (metaBlock.includes('name="description"')) {
    out = out.replace(/\s*<meta\s+name="description"\s+content="[^"]*"\s*\/?>/i, "");
  }
  if (!/<\/head>/i.test(out)) {
    return `${metaBlock}\n${out}`;
  }
  return out.replace(/<\/head>/i, `${metaBlock}\n</head>`);
}

export async function renderArticlePage({ html, slug, origin, loadArticle, article }) {
  const slugNorm = String(slug || "").trim();
  const canonical = `${origin}/articles/${encodeURIComponent(slugNorm)}`;
  const fallbackImage = `${origin}${OG_IMAGE_PATH}`;
  let listing = article;
  if (listing === undefined && typeof loadArticle === "function" && slugNorm) {
    try {
      listing = await loadArticle(slugNorm);
    } catch {
      listing = null;
    }
  }
  const generatedImage = listing ? `${origin}${articleOgImagePath(slugNorm)}` : null;
  const share = listing
    ? shareMetaFromArticle(listing, { canonical, fallbackImage, generatedImage })
    : defaultShareMeta({ canonical, fallbackImage });
  return injectShareMeta(html, buildShareMetaTags(share), share.documentTitle);
}
