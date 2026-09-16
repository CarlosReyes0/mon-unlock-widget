import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  OG_DESCRIPTION_MAX,
  OG_IMAGE_PATH,
  absoluteHttpUrl,
  articleOgImagePath,
  buildShareMetaTags,
  defaultShareMeta,
  injectShareMeta,
  plainText,
  publicOrigin,
  renderArticlePage,
  resolveShareImageUrl,
  shareMetaFromArticle,
} from "./article-og.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARTICLE_HTML = fs.readFileSync(path.join(ROOT, "article.html"), "utf8");

test("plainText strips tags and truncates on a word boundary", () => {
  assert.equal(plainText("<p>Hello <em>world</em></p>"), "Hello world");
  const long = `${"word ".repeat(60)}end`;
  const out = plainText(long, 80);
  assert.ok(out.endsWith("…"));
  assert.ok(out.length <= 80);
  assert.doesNotMatch(out, /</);
});

test("absoluteHttpUrl accepts only http(s)", () => {
  assert.equal(absoluteHttpUrl("https://cdn.example/cover.jpg"), "https://cdn.example/cover.jpg");
  assert.equal(absoluteHttpUrl("javascript:alert(1)"), null);
  assert.equal(absoluteHttpUrl("/relative.jpg"), null);
  assert.equal(absoluteHttpUrl(""), null);
});

test("resolveShareImageUrl uses listing image when present (extension point)", () => {
  const fallback = "https://host/assets/og-default.jpg";
  assert.equal(resolveShareImageUrl({}, fallback), fallback);
  assert.equal(
    resolveShareImageUrl({ imageUrl: "https://cdn.example/my-cover.png" }, fallback),
    "https://cdn.example/my-cover.png"
  );
  assert.equal(
    resolveShareImageUrl({ coverImage: "https://cdn.example/shot.jpg" }, fallback),
    "https://cdn.example/shot.jpg"
  );
  assert.equal(resolveShareImageUrl({ imageUrl: "ftp://x/a.png" }, fallback), fallback);
});

test("shareMetaFromArticle maps title, teaser, and default photo", () => {
  const share = shareMetaFromArticle(
    {
      title: "Cassandra in Flames?",
      teaser: "<p>She who has fallen shall rise again.</p>",
      author: "Carlos",
    },
    {
      canonical: "https://host/articles/cassandra-in-flames",
      fallbackImage: "https://host/assets/og-default.jpg",
    }
  );
  assert.equal(share.title, "Cassandra in Flames?");
  assert.equal(share.documentTitle, "Cassandra in Flames? — Open Paywall");
  assert.equal(share.description, "She who has fallen shall rise again.");
  assert.equal(share.imageUrl, "https://host/assets/og-default.jpg");
  assert.equal(share.type, "article");
  assert.equal(share.author, "Carlos");
});

test("shareMetaFromArticle prefers generated /og/{slug}.jpg over the default card", () => {
  const share = shareMetaFromArticle(
    { title: "The Quote Was a Trap", teaser: "A short preview." },
    {
      canonical: "https://host/articles/the-quote-was-a-trap",
      fallbackImage: "https://host/assets/og-default.jpg",
      generatedImage: "https://host/og/the-quote-was-a-trap.jpg",
    }
  );
  assert.equal(share.imageUrl, "https://host/og/the-quote-was-a-trap.jpg");
});

test("listing https cover still wins over the generated card", () => {
  const share = shareMetaFromArticle(
    {
      title: "Covered",
      teaser: "Has a real cover.",
      imageUrl: "https://cdn.example/cover.png",
    },
    {
      canonical: "https://host/articles/covered",
      fallbackImage: "https://host/assets/og-default.jpg",
      generatedImage: "https://host/og/covered.jpg",
    }
  );
  assert.equal(share.imageUrl, "https://cdn.example/cover.png");
});

test("share descriptions stay within the mobile OG cap", () => {
  assert.ok(OG_DESCRIPTION_MAX >= 120 && OG_DESCRIPTION_MAX <= 125);
  const long = `${"word ".repeat(80)}end`;
  const share = shareMetaFromArticle(
    { title: "Long teaser", teaser: long },
    {
      canonical: "https://host/articles/long-teaser",
      fallbackImage: "https://host/assets/og-default.jpg",
    }
  );
  assert.ok(share.description.length <= OG_DESCRIPTION_MAX);
  assert.ok(share.description.endsWith("…"));
});

test("articleOgImagePath is a stable public /og/{slug}.jpg URL", () => {
  assert.equal(articleOgImagePath("the-quote-was-a-trap"), "/og/the-quote-was-a-trap.jpg");
});

test("buildShareMetaTags emits OG + Twitter Card tags with absolute image URL", () => {
  const html = buildShareMetaTags(
    defaultShareMeta({
      canonical: "https://host/articles/demo-slug",
      fallbackImage: "https://host/assets/og-default.jpg",
    })
  );
  assert.match(html, /property="og:title"/);
  assert.match(html, /property="og:description"/);
  assert.match(html, /property="og:url"/);
  assert.match(html, /property="og:image" content="https:\/\/host\/assets\/og-default\.jpg"/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  assert.match(html, /name="twitter:image" content="https:\/\/host\/assets\/og-default\.jpg"/);
  assert.match(html, /name="twitter:site" content="@openpaywall"/);
  assert.match(html, /rel="canonical" href="https:\/\/host\/articles\/demo-slug"/);
});

test("renderArticlePage injects crawler-visible tags into article.html", async () => {
  const html = await renderArticlePage({
    html: ARTICLE_HTML,
    slug: "the-quote-was-a-trap",
    origin: "https://mon-unlock-widget-production.up.railway.app",
    loadArticle: async () => ({
      title: "The Quote Was a Trap",
      teaser: "A short free preview everyone can read.",
      author: "Solrac",
    }),
  });
  assert.match(html, /<title>The Quote Was a Trap — Open Paywall<\/title>/);
  assert.match(html, /property="og:title" content="The Quote Was a Trap"/);
  assert.match(html, /property="og:description" content="A short free preview everyone can read\."/);
  assert.match(
    html,
    /property="og:image" content="https:\/\/mon-unlock-widget-production\.up\.railway\.app\/og\/the-quote-was-a-trap\.jpg"/
  );
  assert.match(
    html,
    /name="twitter:image" content="https:\/\/mon-unlock-widget-production\.up\.railway\.app\/og\/the-quote-was-a-trap\.jpg"/
  );
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  assert.match(
    html,
    /property="og:url" content="https:\/\/mon-unlock-widget-production\.up\.railway\.app\/articles\/the-quote-was-a-trap"/
  );
  assert.match(html, /Loading article/);
  assert.equal((html.match(/property="og:title"/g) || []).length, 1);
  assert.equal((html.match(/name="description"/g) || []).length, 1);
});

test("renderArticlePage falls back to default card when the listing is missing", async () => {
  const html = await renderArticlePage({
    html: ARTICLE_HTML,
    slug: "missing-slug",
    origin: "http://127.0.0.1:8080",
    loadArticle: async () => {
      const err = new Error("not_found");
      err.status = 404;
      throw err;
    },
  });
  assert.match(html, /property="og:title" content="Open Paywall"/);
  assert.match(html, /content="http:\/\/127\.0\.0\.1:8080\/assets\/og-default\.jpg"/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
});

test("renderArticlePage caps og:description around 125 characters", async () => {
  const html = await renderArticlePage({
    html: ARTICLE_HTML,
    slug: "long-teaser",
    origin: "https://host",
    loadArticle: async () => ({
      title: "Long",
      teaser: `${"preview ".repeat(40)}end`,
    }),
  });
  const m = html.match(/property="og:description" content="([^"]*)"/);
  assert.ok(m);
  assert.ok(m[1].length <= OG_DESCRIPTION_MAX);
  const t = html.match(/name="twitter:description" content="([^"]*)"/);
  assert.ok(t);
  assert.ok(t[1].length <= OG_DESCRIPTION_MAX);
  const d = html.match(/name="description" content="([^"]*)"/);
  assert.ok(d);
  assert.ok(d[1].length <= OG_DESCRIPTION_MAX);
});

test("injectShareMeta is idempotent", () => {
  const share = defaultShareMeta({
    canonical: "https://host/articles/x",
    fallbackImage: "https://host/assets/og-default.jpg",
  });
  const once = injectShareMeta(ARTICLE_HTML, buildShareMetaTags(share), share.documentTitle);
  const twice = injectShareMeta(once, buildShareMetaTags(share), share.documentTitle);
  assert.equal((twice.match(/property="og:title"/g) || []).length, 1);
});

test("publicOrigin prefers forwarded proto", () => {
  assert.equal(
    publicOrigin({
      headers: { "x-forwarded-proto": "https", host: "example.com" },
    }),
    "https://example.com"
  );
});

test("publicOrigin infers https on Railway when proto is omitted", () => {
  assert.equal(
    publicOrigin({
      headers: { host: "mon-unlock-widget-production.up.railway.app" },
    }),
    "https://mon-unlock-widget-production.up.railway.app"
  );
  assert.equal(
    publicOrigin({ headers: { host: "127.0.0.1:8080" } }),
    "http://127.0.0.1:8080"
  );
  assert.equal(
    publicOrigin({
      headers: { "x-forwarded-proto": "http", host: "preview.up.railway.app" },
    }),
    "http://preview.up.railway.app"
  );
});

test("publicOrigin uses PUBLIC_ORIGIN protocol when proto is omitted", () => {
  const prev = process.env.PUBLIC_ORIGIN;
  process.env.PUBLIC_ORIGIN = "https://pay.example";
  try {
    assert.equal(
      publicOrigin({ headers: { host: "pay.example" } }),
      "https://pay.example"
    );
    // Do not apply a production PUBLIC_ORIGIN protocol to a different host
    // (local Vite would otherwise emit https://127.0.0.1/... cards).
    assert.equal(
      publicOrigin({ headers: { host: "127.0.0.1:5173" } }),
      "http://127.0.0.1:5173"
    );
  } finally {
    if (prev === undefined) delete process.env.PUBLIC_ORIGIN;
    else process.env.PUBLIC_ORIGIN = prev;
  }
});

test("publicOrigin infers https from a TLS socket when proto is omitted", () => {
  assert.equal(
    publicOrigin({
      headers: { host: "pay.example" },
      socket: { encrypted: true },
    }),
    "https://pay.example"
  );
});

test("publicOrigin prefers x-forwarded-host over Host", () => {
  assert.equal(
    publicOrigin({
      headers: {
        "x-forwarded-proto": "https",
        "x-forwarded-host": "openpaywall.example",
        host: "localhost:8080",
      },
    }),
    "https://openpaywall.example"
  );
});

test("default OG asset is a 1200x630 JPEG in assets/", () => {
  const file = path.join(ROOT, OG_IMAGE_PATH.replace(/^\//, ""));
  assert.equal(fs.existsSync(file), true, `missing ${OG_IMAGE_PATH}`);
  const buf = fs.readFileSync(file);
  assert.equal(buf[0], 0xff);
  assert.equal(buf[1], 0xd8);
  assert.ok(buf.length > 10_000);
  assert.ok(buf.length < 5_000_000);
});
