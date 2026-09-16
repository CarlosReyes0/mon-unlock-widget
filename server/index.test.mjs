/**
 * Smoke tests for the Coinbase session-token server (no CDP credentials required).
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test, after } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = 18765;

const child = spawn(process.execPath, ["server/index.mjs"], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT: String(PORT),
    // Explicitly unset so health reports not configured.
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

test("GET /articles/demo-slug serves article.html", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/articles/demo-slug`);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text, /open-paywall|Loading article/i);
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
  assert.equal(body.docs.llms, "/llms.txt");
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
