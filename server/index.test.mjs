/**
 * Smoke tests for the Coinbase session-token server (no CDP credentials required).
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import { test, after } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = 18765;
const OG_CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "og-http-cache-"));
const OG_LISTING_FIXTURES = path.join(os.tmpdir(), `og-listings-${PORT}.json`);
fs.writeFileSync(
  OG_LISTING_FIXTURES,
  JSON.stringify({
    "the-quote-was-a-trap": {
      title: "The Quote Was a Trap",
      teaser: "A short free preview everyone can read.",
      priceWei: "500000",
      paymentAsset: "usdc",
    },
  })
);

const child = spawn(process.execPath, ["server/index.mjs"], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT: String(PORT),
    OG_CACHE_DIR,
    OG_LISTING_FIXTURES,
    // Explicitly unset so health reports not configured.
    CDP_API_KEY_ID: "",
    CDP_API_KEY_SECRET: "",
    CDP_API_KEY: "",
    CDP_API_SECRET: "",
    STRIPE_SECRET_KEY: "",
    STRIPE_WEBHOOK_SECRET: "",
    SUPABASE_URL: "",
    SUPABASE_SERVICE_ROLE_KEY: "",
    MEDIA_DIR: path.join(os.tmpdir(), "op-media-index-test"),
    MPP_SECRET_KEY: "",
    MPP_TEMPO_RECIPIENT: "",
    MPP_DEV_BYPASS: "",
    RELAYER_PRIVATE_KEY: "",
    BASE_BUILDER_CODE: "",
    MIROSHARK_X402_PRIVATE_KEY: "",
    VOICE_DRAFT_API_KEY: "",
    OPENAI_API_KEY: "",
    ANTHROPIC_API_KEY: "",
    VOICE_DRAFTS_VISIBLE: "",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

await once(child.stdout, "data");

after(() => {
  child.kill("SIGTERM");
});

test("GET /api/coinbase/health reports coinbaseConfigured=false without secrets", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/coinbase/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.coinbaseConfigured, false);
});

test("POST /api/coinbase/session-token returns 503 without CDP secrets", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/coinbase/session-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      address: "0x1111111111111111111111111111111111111111",
      asset: "USDC",
      amount: "5",
    }),
  });
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.error, "coinbase_not_configured");
});

test("POST /api/coinbase/session-token rejects invalid address", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/coinbase/session-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: "not-an-address", asset: "USDC" }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, "invalid_address");
});

test("GET /api/stripe/health reports stripeConfigured=false without secrets", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/stripe/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.stripeConfigured, false);
});

test("POST /api/stripe/create-intent returns 503 without Stripe secrets", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/stripe/create-intent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      articleId: "demo",
      amountUsdCents: 199,
      title: "Demo",
    }),
  });
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.error, "stripe_not_configured");
});

test("POST /api/stripe/payouts/process returns 503 without cron secret", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/stripe/payouts/process`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ limit: 1 }),
  });
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.error, "payout_cron_not_configured");
});

test("GET /api/access without reader returns 400", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/access?article_id=demo`);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, "reader_or_fiat_session_required");
});

test("GET /api/article-body without reader or fiat session returns 400", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/article-body?article_id=demo`);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, "reader_or_fiat_session_required");
});

test("GET /api/articles/{slug}/download without reader is 400 JSON, not a file", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/articles/demo-slug/download`);
  assert.equal(res.status, 400);
  assert.match(res.headers.get("content-type") || "", /application\/json/);
  const body = await res.json();
  assert.equal(body.error, "reader_or_fiat_session_required");
  assert.equal(body.body, undefined);
});

test("GET /api/articles/{slug}/download with a wallet and no Supabase is 503", async () => {
  const res = await fetch(
    `http://127.0.0.1:${PORT}/api/articles/demo-slug/download?reader=0x1111111111111111111111111111111111111111`
  );
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.error, "supabase_not_configured");
});

test("POST /api/subscriptions/stripe/checkout returns 503 without secrets", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/subscriptions/stripe/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      reader: "0x1111111111111111111111111111111111111111",
      writer: "0x2222222222222222222222222222222222222222",
    }),
  });
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.ok(
    body.error === "stripe_not_configured" || body.error === "supabase_not_configured"
  );
});

test("GET /api/relay/health reports relayerConfigured=false without key", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/relay/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.relayerConfigured, false);
  assert.equal(body.relayerAddress, null);
});

test("POST /api/relay/register returns 503 without relayer key", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/relay/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug: "demo" }),
  });
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.error, "relayer_not_configured");
  assert.equal(body.fallback, true);
});

test("POST /api/relay/gas returns 503 without relayer key", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/relay/gas`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: "0x1111111111111111111111111111111111111111" }),
  });
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.error, "relayer_not_configured");
});

test("GET /api/article-nfts/config is unconfigured without ARTICLE_NFT_CONTRACT", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/article-nfts/config`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.configured, false);
  assert.equal(body.chainId, 143);
  assert.equal(body.mintAuth, "user-wallet");
});

test("POST /api/article-nfts/record is 503 without ARTICLE_NFT_CONTRACT", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/article-nfts/record`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      slug: "demo",
      role: "edition",
      minter: "0x1111111111111111111111111111111111111111",
      tokenId: "1",
    }),
  });
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.error, "nft_not_configured");
});

test("GET /api/listings/health reports supabaseConfigured=false without secrets", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/listings/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.supabaseConfigured, false);
  assert.equal(body.adminConfigured, false);
});

test("GET /api/articles returns 503 without Supabase", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/articles`);
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.error, "supabase_not_configured");
});

test("GET /articles serves articles.html", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/articles`);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text, /Articles/i);
  assert.match(text, /Directory/i);
});

test("GET / serves the articles feed", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/`);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text, /Directory/i);
  assert.match(text, /id="feed"/);
  assert.match(text, /apple-touch-icon\.png/);
  assert.match(text, /apple-mobile-web-app-title" content="Open Paywall"/);
  assert.doesNotMatch(text, /unlock-demo\.mp4/);
});

test("GET /demo serves the former homepage demo", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/demo`);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text, /Demo — Open Paywall/);
  assert.match(text, /unlock-demo\.mp4/);
  assert.match(text, /See it in action/);
});

test("GET /write serves the write page", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/write`);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text, /Write — Open Paywall/);
});

test("pretty URL aliases for /account, /dashboard, and /publisher-auth exist in index.mjs", () => {
  const src = fs.readFileSync(path.join(ROOT, "server/index.mjs"), "utf8");
  // Strip comments so a comment-only mention cannot pass.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  for (const page of ["write", "account", "dashboard", "publisher-auth"]) {
    const pathCheck = new RegExp(
      String.raw`url\.pathname === "/${page}" \|\| url\.pathname === "/${page}\.html"`
    );
    assert.match(code, pathCheck, `missing pretty URL path check for /${page}`);
    const serve = new RegExp(String.raw`serveStatic\(req, res, "/${page}\.html"\)`);
    assert.match(code, serve, `missing serveStatic target for /${page}.html`);
  }
});

test("GET /account serves the account page", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/account`);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text, /Account — Open Paywall/);
});

test("GET /dashboard serves the dashboard page", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/dashboard`);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text, /Writer Dashboard — Open Paywall/);
});

test("GET /publisher-auth serves the publisher auth mount page", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/publisher-auth`);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text, /Publisher auth mount/);
});

test("GET /articles/demo-slug serves article.html", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/articles/demo-slug`);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text, /open-paywall|Loading article/i);
});

test("GET / includes Open Graph and Twitter Card tags for X", async () => {
  const origin = `http://127.0.0.1:${PORT}`;
  const res = await fetch(`${origin}/`);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text, /property="og:title" content="Open Paywall"/);
  assert.match(text, /property="og:url" content="http:\/\/127\.0\.0\.1:\d+\/"/);
  assert.match(
    text,
    /property="og:image" content="http:\/\/127\.0\.0\.1:\d+\/og\.jpg"/
  );
  assert.match(text, /name="twitter:card" content="summary_large_image"/);
  assert.match(text, /name="twitter:image" content="http:\/\/127\.0\.0\.1:\d+\/og\.jpg"/);
  assert.match(text, /name="twitter:site" content="@openpaywall"/);
  assert.doesNotMatch(text, /property="og:image" content="\/assets\//);
});

test("GET /articles/demo-slug includes Open Graph and Twitter Card tags", async () => {
  const origin = `http://127.0.0.1:${PORT}`;
  const res = await fetch(`${origin}/articles/demo-slug`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") || "", /text\/html/);
  const text = await res.text();
  assert.match(text, /property="og:title"/);
  assert.match(text, /property="og:description"/);
  assert.match(text, /property="og:url" content="http:\/\/127\.0\.0\.1:\d+\/articles\/demo-slug"/);
  assert.match(
    text,
    /property="og:image" content="http:\/\/127\.0\.0\.1:\d+\/og\.jpg"/
  );
  assert.match(text, /name="twitter:card" content="summary_large_image"/);
  assert.match(text, /name="twitter:image" content="http:\/\/127\.0\.0\.1:\d+\/og\.jpg"/);
  assert.match(text, /name="twitter:site" content="@openpaywall"/);
  assert.doesNotMatch(text, /property="og:image" content="\/assets\//);
});

test("GET /og.jpg and /assets/og-default.jpg are cacheable JPEGs for X", async () => {
  for (const imagePath of ["/og.jpg", "/assets/og-default.jpg"]) {
    const res = await fetch(`http://127.0.0.1:${PORT}${imagePath}`);
    assert.equal(res.status, 200, imagePath);
    assert.equal(res.headers.get("content-type"), "image/jpeg", imagePath);
    assert.match(res.headers.get("cache-control") || "", /public/, imagePath);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.equal(buf[0], 0xff, imagePath);
    assert.equal(buf[1], 0xd8, imagePath);
    assert.ok(buf.length > 10_000, imagePath);
  }
});

test("GET /apple-touch-icon.png is a 180×180 PNG", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/apple-touch-icon.png`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/png");
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf[0], 0x89);
  assert.equal(buf[1], 0x50);
  assert.equal(buf.readUInt32BE(16), 180);
  assert.equal(buf.readUInt32BE(20), 180);
});

test("GET /manifest.webmanifest names the home-screen app Open Paywall", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/manifest.webmanifest`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") || "", /application\/manifest\+json/);
  const body = await res.json();
  assert.equal(body.name, "Open Paywall");
  assert.equal(body.short_name, "Open Paywall");
  assert.equal(body.start_url, "/");
});

test("GET /og/missing-slug.jpg falls back to the default 1200x630 JPEG", async () => {
  const { jpegDimensions, defaultOgJpegBuffer } = await import("./og-card.mjs");
  const res = await fetch(`http://127.0.0.1:${PORT}/og/missing-slug.jpg`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/jpeg");
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf[0], 0xff);
  assert.equal(buf[1], 0xd8);
  assert.deepEqual(jpegDimensions(buf), { width: 1200, height: 630 });
  assert.equal(buf.equals(defaultOgJpegBuffer()), true);
});

test("HEAD /og/missing-slug.jpg is a JPEG without a body", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/og/missing-slug.jpg`, { method: "HEAD" });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/jpeg");
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.length, 0);
});

test("GET /og/foo%20bar.jpg still returns a JPEG (does not 404)", async () => {
  const { jpegDimensions } = await import("./og-card.mjs");
  const res = await fetch(`http://127.0.0.1:${PORT}/og/foo%20bar.jpg`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/jpeg");
  const buf = Buffer.from(await res.arrayBuffer());
  assert.deepEqual(jpegDimensions(buf), { width: 1200, height: 630 });
});

test("GET /articles/{listed-slug} points og:image at the generated card with a cache-bust query", async () => {
  const origin = `http://127.0.0.1:${PORT}`;
  const res = await fetch(`${origin}/articles/the-quote-was-a-trap`);
  assert.equal(res.status, 200);
  const text = await res.text();
  const m = text.match(/property="og:image" content="([^"]+)"/);
  assert.ok(m, "missing og:image");
  assert.match(m[1], new RegExp(`^${origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/og/the-quote-was-a-trap\\.jpg\\?v=[a-f0-9]{16}$`));
  assert.match(
    text,
    new RegExp(`name="twitter:image" content="${origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/og/the-quote-was-a-trap\\.jpg"`)
  );
  assert.doesNotMatch(text, /name="twitter:image" content="[^"]+\?v=/);
  assert.match(text, /property="og:title" content="The Quote Was a Trap"/);

  const img = await fetch(m[1]);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get("content-type"), "image/jpeg");
  const { jpegDimensions, defaultOgJpegBuffer } = await import("./og-card.mjs");
  const buf = Buffer.from(await img.arrayBuffer());
  assert.deepEqual(jpegDimensions(buf), { width: 1200, height: 630 });
  assert.equal(buf.equals(defaultOgJpegBuffer()), false);
});

test("POST /api/listings/hide returns 503 without admin secret", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/listings/hide`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug: "x", status: "hidden" }),
  });
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.error, "listing_admin_not_configured");
});

test("GET /assets/unlock-demo.mp4 serves video/mp4 with range support", async () => {
  const head = await fetch(`http://127.0.0.1:${PORT}/assets/unlock-demo.mp4`, {
    method: "HEAD",
  });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-type"), "video/mp4");
  assert.equal(head.headers.get("accept-ranges"), "bytes");
  const size = Number(head.headers.get("content-length"));
  assert.ok(Number.isFinite(size) && size > 0);

  const ranged = await fetch(`http://127.0.0.1:${PORT}/assets/unlock-demo.mp4`, {
    headers: { Range: "bytes=0-1023" },
  });
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers.get("content-type"), "video/mp4");
  assert.match(ranged.headers.get("content-range") || "", /^bytes 0-1023\//);
  const chunk = await ranged.arrayBuffer();
  assert.equal(chunk.byteLength, 1024);
});

test("GET /llms.txt is crawlable", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/llms.txt`);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text, /Open Paywall/i);
  assert.match(text, /embeddable paywall/i);
});

test("GET /agents.md and /skill.md are served", async () => {
  for (const path of ["/agents.md", "/skill.md", "/openapi.json", "/robots.txt"]) {
    const res = await fetch(`http://127.0.0.1:${PORT}${path}`);
    assert.equal(res.status, 200, path);
  }
  const robots = await fetch(`http://127.0.0.1:${PORT}/robots.txt`).then((r) => r.text());
  assert.match(robots, /User-agent: Twitterbot/);
  assert.match(robots, /Allow: \//);
});

test("GET /.well-known/skills/mon-unlock/SKILL.md is served", async () => {
  const res = await fetch(
    `http://127.0.0.1:${PORT}/.well-known/skills/mon-unlock/SKILL.md`
  );
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text, /name: mon-unlock/);
});

test("GET /api/agents/health reports mpp status", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/agents/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.mpp.configured, false);
  assert.equal(body.x402.configured, false);
  assert.equal(body.miroshark.enabled, false);
  assert.equal(body.voiceDrafts.enabled, false);
  assert.equal(body.voiceDrafts.autopost, false);
  assert.equal(body.docs.llms, "/llms.txt");
  assert.equal(body.docs.x402Skill, "/.well-known/skills/open-paywall-x402/SKILL.md");
});

test("GET /api/miroshark/status is disabled without BASE_BUILDER_CODE", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/miroshark/status`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.enabled, false);
  assert.match(body.message, /BASE_BUILDER_CODE/);
  assert.equal(body.builderCode, null);
});

test("GET /api/voice-drafts/status is disabled without an LLM key", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/voice-drafts/status`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.enabled, false);
  assert.equal(body.visible, false);
  assert.equal(body.reason, "hidden");
  assert.equal(body.draftsOnly, true);
  assert.equal(body.autopost, false);
  assert.doesNotMatch(JSON.stringify(body), /sk-/);
});

test("GET /.well-known/skills/open-paywall-x402/SKILL.md is served", async () => {
  const res = await fetch(
    `http://127.0.0.1:${PORT}/.well-known/skills/open-paywall-x402/SKILL.md`
  );
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text, /name: open-paywall-x402/);
  assert.match(text, /bankr x402 call/);
});

test("POST /api/x402/publish returns 503 when x402 is not configured", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/x402/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "Agent demo",
      articleId: "agent-demo-x402",
      teaser: "Preview",
      body: "Full body",
      publisher: "0x1111111111111111111111111111111111111111",
    }),
  });
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.error, "x402_not_configured");
});

test("POST /api/agents/publish/validate rejects bad payload", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/agents/publish/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Only title" }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.ok(Array.isArray(body.errors));
});

test("POST /api/agents/publish/validate accepts valid payload", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/agents/publish/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "Agent demo",
      articleId: "agent-demo-1",
      teaser: "Preview",
      body: "Full body",
      publisher: "0x1111111111111111111111111111111111111111",
      price: "1",
    }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.valid, true);
  assert.ok(body.quote.amount);
});

test("POST /api/agents/publish returns 503 when MPP is not configured", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/agents/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "Agent demo",
      articleId: "agent-demo-2",
      teaser: "Preview",
      body: "Full body",
      publisher: "0x1111111111111111111111111111111111111111",
      price: "1",
    }),
  });
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.error, "mpp_not_configured");
});

test("POST /api/agents/publish empty probe still hits MPP gate (not 400)", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/agents/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  // Without MPP secrets the gate reports not configured (503), not invalid input (400).
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.error, "mpp_not_configured");
});

test("GET /api/media/status hosts files on disk when Supabase is unset", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/media/status`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.hosting, true);
  assert.equal(body.persistent, false);
  assert.equal(body.limits.image, 8 * 1024 * 1024);
});

test("GET /server/data is not served as a static file", async () => {
  const dir = path.join(ROOT, "server/data");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "not-public.txt");
  fs.writeFileSync(file, "secret-token");
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/server/data/not-public.txt`);
    assert.equal(res.status, 404);
    const text = await res.text();
    assert.doesNotMatch(text, /secret-token/);
  } finally {
    fs.unlinkSync(file);
  }
});
