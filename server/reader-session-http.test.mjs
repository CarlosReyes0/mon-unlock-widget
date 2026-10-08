/**
 * Paid reads require a reader session. A bare buyer wallet must not return
 * the article, and a Stripe fiat_session still does.
 */
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test, after } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { privateKeyToAccount } from "viem/accounts";
import { buildReaderSessionMessage } from "./reader-session.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const APP_PORT = 18940;
const SB_PORT = 18941;
const SLUG = "session-gated-article";
const PAID_BODY = "SECRET_PAID_ARTICLE_TEXT_DO_NOT_LEAK";
const ARTICLE_HASH = "0x" + "ab".repeat(32);
const FIAT = "sess_card_ok";
const READER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const reader = privateKeyToAccount(READER_KEY);
const READER = reader.address.toLowerCase();

function eq(url, key) {
  return String(url.searchParams.get(key) || "").replace(/^eq\./, "");
}

const supabase = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${SB_PORT}`);
  res.setHeader("Content-Type", "application/json");
  if (url.pathname === "/rest/v1/articles") {
    const articleEq = eq(url, "article_id");
    if (articleEq !== SLUG) {
      res.writeHead(200);
      res.end("[]");
      return;
    }
    const row = {
      article_id: SLUG,
      article_id_hash: ARTICLE_HASH,
      publisher: "0x1111111111111111111111111111111111111111",
      price_wei: "500000",
      price_cents: 50,
      listing_status: "listed",
      payment_asset: "usdc",
      allow_a_la_carte: true,
      title: "Gated",
      author: "Ada",
      teaser: "Preview",
    };
    if (/\bbody\b/.test(url.searchParams.get("select") || "")) row.body = PAID_BODY;
    res.writeHead(200);
    res.end(JSON.stringify([row]));
    return;
  }
  if (url.pathname === "/rest/v1/unlocks") {
    const hit = eq(url, "reader").toLowerCase() === READER && eq(url, "article_id_hash") === ARTICLE_HASH;
    res.writeHead(200);
    res.end(hit ? JSON.stringify([{ id: 1 }]) : "[]");
    return;
  }
  if (url.pathname === "/rest/v1/fiat_unlocks") {
    const hit = eq(url, "session_token") === FIAT && eq(url, "article_id_hash") === ARTICLE_HASH;
    res.writeHead(200);
    res.end(hit ? JSON.stringify([{ id: 2 }]) : "[]");
    return;
  }
  res.writeHead(200);
  res.end("[]");
});

await new Promise((resolve) => supabase.listen(SB_PORT, "127.0.0.1", resolve));

const child = spawn(process.execPath, ["server/index.mjs"], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT: String(APP_PORT),
    CDP_API_KEY_ID: "",
    CDP_API_KEY_SECRET: "",
    STRIPE_SECRET_KEY: "",
    MPP_SECRET_KEY: "",
    MPP_TEMPO_RECIPIENT: "",
    MPP_DEV_BYPASS: "",
    X402_DEV_BYPASS: "",
    X402_PAY_TO: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0",
    SUPABASE_URL: `http://127.0.0.1:${SB_PORT}`,
    SUPABASE_SERVICE_ROLE_KEY: "test-role-key",
    READER_SESSION_SECRET: "",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

await once(child.stdout, "data");

after(() => {
  child.kill("SIGTERM");
  supabase.close();
});

const origin = `http://127.0.0.1:${APP_PORT}`;

async function sessionToken() {
  const domain = `127.0.0.1:${APP_PORT}`;
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + 3600;
  const message = buildReaderSessionMessage({ domain, address: READER, issuedAt, expiresAt });
  const signature = await reader.signMessage({ message });
  const res = await fetch(`${origin}/api/reader/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: READER, issuedAt, expiresAt, signature }),
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  return body.token;
}

test("bare reader cannot read a paid article body", async () => {
  const res = await fetch(`${origin}/api/article-body?article_id=${SLUG}&reader=${READER}`);
  const text = await res.text();
  assert.equal(res.status, 401);
  assert.equal(text.includes(PAID_BODY), false);
  assert.equal(JSON.parse(text).error, "reader_session_required");
});

test("reader session returns the paid body for the signed wallet", async () => {
  const token = await sessionToken();
  const res = await fetch(`${origin}/api/article-body?article_id=${SLUG}`, {
    headers: { "X-Reader-Session": token },
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.body, PAID_BODY);

  const access = await fetch(`${origin}/api/access?article_id=${SLUG}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const accessBody = await access.json();
  assert.equal(access.status, 200, JSON.stringify(accessBody));
  assert.equal(accessBody.allowed, true);
  assert.equal(accessBody.reader, READER);
});

test("fiat session still unlocks without a wallet signature", async () => {
  const res = await fetch(
    `${origin}/api/article-body?article_id=${SLUG}&fiat_session=${encodeURIComponent(FIAT)}&reader=${READER}`
  );
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.body, PAID_BODY);
});

test("x402 does not give the body to a bare buyer wallet", async () => {
  const res = await fetch(`${origin}/api/x402/articles/${SLUG}?reader=${READER}`);
  const text = await res.text();
  assert.equal(res.status, 402);
  assert.equal(text.includes(PAID_BODY), false);
  const body = JSON.parse(text);
  assert.equal(body.body, undefined);
  assert.equal(body.x402Version, 1);
});

test("x402 still returns an entitled fiat session without charging", async () => {
  const res = await fetch(
    `${origin}/api/x402/articles/${SLUG}?fiat_session=${encodeURIComponent(FIAT)}`
  );
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.body, PAID_BODY);
  assert.equal(body.paid, false);
});

test("widget and feed do not treat a bare wallet as read access", async () => {
  const { readFileSync } = await import("node:fs");
  const widget = readFileSync(path.join(ROOT, "src/widget/mon-unlock.ts"), "utf8");
  const feed = readFileSync(path.join(ROOT, "articles.html"), "utf8");
  assert.match(widget, /establishReaderSession/);
  assert.match(widget, /READER_SESSION_HEADER/);
  assert.doesNotMatch(widget, /params\.set\("reader"/);
  assert.doesNotMatch(feed, /\/api\/article-body/);
  assert.doesNotMatch(feed, /reader=/);
});
