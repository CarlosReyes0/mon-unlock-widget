/**
 * HTTP smoke for the Open Paywall verify checklist.
 *
 * Hits a running origin (BASE_URL) or starts `npm start` locally. Fails the
 * process on route / OG regressions. No browser, no card charges, no Stripe
 * Dashboard secrets.
 *
 *   npm run smoke
 *   BASE_URL=https://mon-unlock-widget-production.up.railway.app npm run smoke
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { OG_DESCRIPTION_MAX } from "../server/article-og.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_SLUG = "the-quote-was-a-trap";
const FIXTURES = path.join(ROOT, "scripts/fixtures/og-listings.json");
const DOCKER_NOT_FOUND = /^\s*Not found\s*$/i;

const externalOrigin = String(process.env.BASE_URL || "")
  .trim()
  .replace(/\/$/, "");

const local = externalOrigin ? null : await startLocalServer();
const origin = externalOrigin || local.origin;

after(() => {
  local?.stop();
});

test("GET / is the articles feed, not a Docker 404", async () => {
  const { status, contentType, text } = await getHtml("/");
  assert.equal(status, 200);
  assert.equal(isDockerNotFound(status, contentType, text), false);
  assert.match(contentType, /text\/html/);
  assert.match(text, /Articles — Open Paywall/);
  assert.match(text, /id="feed"/);
  assert.match(text, /apple-touch-icon\.png/);
  assert.match(text, /apple-mobile-web-app-title" content="Open Paywall"/);
  assert.doesNotMatch(text, /unlock-demo\.mp4/);
  assert.match(text, /name="twitter:card" content="summary_large_image"/);
  assert.match(text, /property="og:image"/);
  assert.match(text, /\/assets\/og-default\.jpg/);
});

test("GET /apple-touch-icon.png and /manifest.webmanifest are public", async () => {
  const icon = await fetch(`${origin}/apple-touch-icon.png`);
  assert.equal(icon.status, 200);
  assert.equal(icon.headers.get("content-type"), "image/png");
  const iconBuf = Buffer.from(await icon.arrayBuffer());
  assert.equal(iconBuf[0], 0x89);
  assert.equal(iconBuf.readUInt32BE(16), 180);
  assert.equal(iconBuf.readUInt32BE(20), 180);

  const manifestRes = await fetch(`${origin}/manifest.webmanifest`);
  assert.equal(manifestRes.status, 200);
  const manifest = await manifestRes.json();
  assert.equal(manifest.short_name, "Open Paywall");
});

test("GET /write, /demo, /generator.html are 200 HTML", async () => {
  const pages = [
    ["/write", /Write — Open Paywall/],
    ["/demo", /Demo — Open Paywall/],
    ["/generator.html", /Embed Generator — Open Paywall/],
  ];
  for (const [pathName, title] of pages) {
    const { status, contentType, text } = await getHtml(pathName);
    assert.equal(status, 200, pathName);
    assert.equal(isDockerNotFound(status, contentType, text), false, pathName);
    assert.match(contentType, /text\/html/, pathName);
    assert.match(text, title, pathName);
  }
});

test("GET /account, /dashboard, /publisher-auth pretty aliases are 200", async () => {
  const pages = [
    ["/account", /Account — Open Paywall/],
    ["/dashboard", /Writer Dashboard — Open Paywall/],
    ["/publisher-auth", /Publisher auth mount/],
  ];
  for (const [pathName, title] of pages) {
    const { status, contentType, text } = await getHtml(pathName);
    assert.equal(status, 200, pathName);
    assert.equal(isDockerNotFound(status, contentType, text), false, pathName);
    assert.match(contentType, /text\/html/, pathName);
    assert.match(text, title, pathName);
  }
});

test("GET /api/agents/health is ok", async () => {
  const res = await fetch(`${origin}/api/agents/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.product, "Open Paywall");
  assert.equal(body.docs?.llms, "/llms.txt");
  assert.equal(body.docs?.agents, "/agents.md");
  assert.equal(body.docs?.openapi, "/openapi.json");
  assert.ok(body.x402);
  assert.equal(typeof body.x402.configured, "boolean");
  assert.equal(body.x402.network, "base");
  assert.ok(body.miroshark);
  assert.equal(typeof body.miroshark.enabled, "boolean");
  assert.ok(body.voiceDrafts);
  assert.equal(typeof body.voiceDrafts.enabled, "boolean");
  assert.equal(body.voiceDrafts.draftsOnly, true);
  assert.equal(body.voiceDrafts.autopost, false);
});

test("GET /api/miroshark/status is fail-soft JSON", async () => {
  const res = await fetch(`${origin}/api/miroshark/status`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(typeof body.enabled, "boolean");
  if (!body.enabled) {
    assert.match(String(body.message || ""), /BASE_BUILDER_CODE|Builder Code/i);
  }
});

test("GET /api/article-nfts/config is JSON and does not mint", async () => {
  const res = await fetch(`${origin}/api/article-nfts/config`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(typeof body.configured, "boolean");
  assert.equal(body.chainId, 143);
  assert.equal(body.mintAuth, "user-wallet");
});

test("GET /api/voice-drafts/status is drafts-only JSON", async () => {
  const res = await fetch(`${origin}/api/voice-drafts/status`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(typeof body.enabled, "boolean");
  assert.equal(body.draftsOnly, true);
  assert.equal(body.autopost, false);
});

test("GET /agents.md, /llms.txt, /openapi.json are crawlable", async () => {
  for (const pathName of ["/agents.md", "/llms.txt", "/openapi.json"]) {
    const res = await fetch(`${origin}${pathName}`);
    assert.equal(res.status, 200, pathName);
    const text = await res.text();
    assert.equal(DOCKER_NOT_FOUND.test(text), false, pathName);
    assert.ok(text.length > 20, pathName);
  }
  const llms = await (await fetch(`${origin}/llms.txt`)).text();
  assert.match(llms, /Open Paywall/i);
  assert.match(llms, /embeddable paywall/i);
  assert.match(llms, /x402/i);
});

test("x402 skill and unpaid publish gate exist (no spend)", async () => {
  const skill = await fetch(`${origin}/.well-known/skills/open-paywall-x402/SKILL.md`);
  assert.equal(skill.status, 200);
  const skillText = await skill.text();
  assert.match(skillText, /bankr x402 call/i);

  const unpaid = await fetch(`${origin}/api/x402/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.ok(
    unpaid.status === 402 || unpaid.status === 503,
    `expected 402 or 503, got ${unpaid.status}`
  );
  const body = await unpaid.json();
  if (unpaid.status === 402) {
    assert.equal(body.x402Version, 1);
    assert.ok(Array.isArray(body.accepts));
    assert.equal(body.accepts[0]?.network, "base");
  } else {
    assert.equal(body.error, "x402_not_configured");
  }

  const missing = await fetch(`${origin}/api/x402/unlock`);
  assert.equal(missing.status, 400);
});

test("listed article HTML injects og:image at /og/{slug}.jpg with a sane description", async () => {
  const slug = await listedSlug();
  const { status, contentType, text } = await getHtml(
    `/articles/${encodeURIComponent(slug)}`
  );
  assert.equal(status, 200);
  assert.match(contentType, /text\/html/);
  assert.equal(isDockerNotFound(status, contentType, text), false);

  const image = metaContent(text, 'property="og:image"');
  assert.ok(image, "missing og:image");
  const imageUrl = new URL(image, origin);
  const escaped = slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.match(
    imageUrl.pathname,
    new RegExp(`^/og/${escaped}\\.jpg$`),
    `og:image should point at /og/${slug}.jpg (got ${image})`
  );

  const description =
    metaContent(text, 'property="og:description"') ||
    metaContent(text, 'name="description"');
  assert.ok(description, "missing og:description");
  assert.ok(description.length > 0);
  assert.ok(
    description.length <= OG_DESCRIPTION_MAX,
    `og:description length ${description.length} exceeds ${OG_DESCRIPTION_MAX}`
  );

  const img = await fetch(imageUrl);
  assert.equal(img.status, 200, `GET ${imageUrl.pathname}`);
  assert.match(img.headers.get("content-type") || "", /image\/jpeg/);
  const buf = Buffer.from(await img.arrayBuffer());
  assert.equal(buf[0], 0xff);
  assert.equal(buf[1], 0xd8);
  assert.ok(buf.length > 1000);
});

test("GET /og/{listed-slug}.jpg is image/jpeg", async () => {
  const slug = await listedSlug();
  const res = await fetch(`${origin}/og/${encodeURIComponent(slug)}.jpg`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/jpeg");
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf[0], 0xff);
  assert.equal(buf[1], 0xd8);
  assert.ok(buf.length > 1000);
});

test("GET /api/articles/{slug}/download without a session is 400, not a public file", async () => {
  const slug = await listedSlug();
  const res = await fetch(`${origin}/api/articles/${encodeURIComponent(slug)}/download`);
  assert.equal(res.status, 400);
  assert.match(res.headers.get("content-type") || "", /application\/json/);
  const text = await res.text();
  const body = JSON.parse(text);
  assert.equal(body.error, "reader_or_fiat_session_required");
  assert.equal(body.body, undefined);
});

async function listedSlug() {
  const forced = String(process.env.SMOKE_ARTICLE_SLUG || "").trim();
  if (forced) return forced;

  const feed = await fetch(`${origin}/api/articles?limit=5`);
  if (feed.ok) {
    try {
      const body = await feed.json();
      const slug = body?.articles?.[0]?.slug;
      if (typeof slug === "string" && slug.trim()) return slug.trim();
    } catch {
      // Local smoke uses OG fixtures; /api/articles is 503 without Supabase.
    }
  }

  const fixture = await fetch(
    `${origin}/articles/${encodeURIComponent(FIXTURE_SLUG)}`
  );
  if (fixture.ok) {
    const html = await fixture.text();
    if (html.includes(`/og/${FIXTURE_SLUG}.jpg`)) return FIXTURE_SLUG;
  }

  throw new Error(
    "No listed article for OG smoke. Set SMOKE_ARTICLE_SLUG or OG_LISTING_FIXTURES (local), or list a post (production)."
  );
}

async function getHtml(pathName) {
  const res = await fetch(`${origin}${pathName}`);
  const contentType = res.headers.get("content-type") || "";
  const text = await res.text();
  return { status: res.status, contentType, text };
}

function isDockerNotFound(status, contentType, text) {
  if (status === 404) return true;
  if (DOCKER_NOT_FOUND.test(text)) return true;
  if (/text\/plain/i.test(contentType) && /not found/i.test(text)) return true;
  return false;
}

function metaContent(html, attr) {
  const re = new RegExp(
    `<meta[^>]*${attr}[^>]*content="([^"]*)"|<meta[^>]*content="([^"]*)"[^>]*${attr}`,
    "i"
  );
  const m = html.match(re);
  return m ? m[1] || m[2] : "";
}

async function startLocalServer() {
  const port = Number(process.env.PORT || 18791);
  const originUrl = `http://127.0.0.1:${port}`;
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "og-smoke-cache-"));
  const stderr = [];
  const child = spawn(process.execPath, ["server/index.mjs"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      OG_CACHE_DIR: cacheDir,
      OG_LISTING_FIXTURES: process.env.OG_LISTING_FIXTURES || FIXTURES,
      CDP_API_KEY_ID: "",
      CDP_API_KEY_SECRET: "",
      CDP_API_KEY: "",
      CDP_API_SECRET: "",
      STRIPE_SECRET_KEY: "",
      STRIPE_WEBHOOK_SECRET: "",
      SUPABASE_URL: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
      MPP_SECRET_KEY: "",
      MPP_TEMPO_RECIPIENT: "",
      MPP_DEV_BYPASS: "",
      RELAYER_PRIVATE_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr.on("data", (chunk) => {
    stderr.push(chunk);
  });

  let timeout;
  try {
    await Promise.race([
      once(child.stdout, "data"),
      once(child, "exit").then(([code]) => {
        throw new Error(
          `server exited ${code} before listen:\n${Buffer.concat(stderr).toString()}`
        );
      }),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error("server start timeout (15s)")), 15_000);
      }),
    ]);
  } catch (err) {
    child.kill("SIGTERM");
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  return {
    origin: originUrl,
    stop() {
      child.kill("SIGTERM");
    },
  };
}
