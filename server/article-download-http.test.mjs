/**
 * HTTP tests for gated article download. Mock Supabase so entitled vs locked
 * can run in CI without live keys or on-chain calls.
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
const APP_PORT = 18780;
const SB_PORT = 18781;
const SLUG = "download-demo-article";
const PAID_BODY = "SECRET_PAID_ARTICLE_TEXT_DO_NOT_LEAK";
const TITLE = "Download Demo Piece";
const ENTITLED_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const ENTITLED_ACCOUNT = privateKeyToAccount(ENTITLED_KEY);
const ENTITLED_READER = ENTITLED_ACCOUNT.address.toLowerCase();
const LOCKED_KEY = "0xac0974bec39a17e36ba4a6b4d4aad435cce0e4c9335790421507b8a191e28881";
const LOCKED_ACCOUNT = privateKeyToAccount(LOCKED_KEY);
const LOCKED_READER = LOCKED_ACCOUNT.address.toLowerCase();
const ENTITLED_SESSION = "sess_paid_ok";
const ARTICLE_HASH = "0x" + "cd".repeat(32);

const supabase = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${SB_PORT}`);
  res.setHeader("Content-Type", "application/json");
  if (!url.pathname.startsWith("/rest/v1/")) {
    res.writeHead(404);
    res.end("[]");
    return;
  }

  const eq = (key) => String(url.searchParams.get(key) || "").replace(/^eq\./, "");

  if (url.pathname === "/rest/v1/writer_plans") {
    res.writeHead(200);
    res.end("[]");
    return;
  }

  if (url.pathname === "/rest/v1/articles") {
    const select = url.searchParams.get("select") || "";
    const articleEq = eq("article_id");
    const hashEq = eq("article_id_hash");
    const wantsBody = /\bbody\b/.test(select);
    if (hashEq && !articleEq) {
      res.writeHead(200);
      res.end("[]");
      return;
    }
    if (articleEq && articleEq !== SLUG) {
      res.writeHead(200);
      res.end("[]");
      return;
    }
    if (!articleEq) {
      res.writeHead(200);
      res.end("[]");
      return;
    }
    const row = {
      article_id: SLUG,
      article_id_hash: ARTICLE_HASH,
      publisher: "0x1111111111111111111111111111111111111111",
      price_wei: "500000",
      listing_status: "listed",
      payment_asset: "usdc",
      allow_a_la_carte: true,
      title: TITLE,
      author: "Ada",
      teaser: "Free preview only",
    };
    if (wantsBody) row.body = PAID_BODY;
    res.writeHead(200);
    res.end(JSON.stringify([row]));
    return;
  }

  if (url.pathname === "/rest/v1/unlocks") {
    const reader = eq("reader").toLowerCase();
    const hash = eq("article_id_hash");
    if (reader === ENTITLED_READER && hash === ARTICLE_HASH) {
      res.writeHead(200);
      res.end(JSON.stringify([{ id: 1 }]));
      return;
    }
    res.writeHead(200);
    res.end("[]");
    return;
  }

  if (url.pathname === "/rest/v1/fiat_unlocks") {
    const session = eq("session_token");
    const hash = eq("article_id_hash");
    if (session === ENTITLED_SESSION && hash === ARTICLE_HASH) {
      res.writeHead(200);
      res.end(JSON.stringify([{ id: 2 }]));
      return;
    }
    res.writeHead(200);
    res.end("[]");
    return;
  }

  if (url.pathname === "/rest/v1/subscriptions") {
    res.writeHead(200);
    res.end("[]");
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
    X402_PAY_TO: "",
    SUPABASE_URL: `http://127.0.0.1:${SB_PORT}`,
    SUPABASE_SERVICE_ROLE_KEY: "test-role-key",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

await once(child.stdout, "data");

after(() => {
  child.kill("SIGTERM");
  supabase.close();
});

const origin = `http://127.0.0.1:${APP_PORT}`;
const downloadUrl = `${origin}/api/articles/${SLUG}/download`;

async function readerSessionToken(account) {
  const domain = `127.0.0.1:${APP_PORT}`;
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + 3600;
  const message = buildReaderSessionMessage({
    domain,
    address: account.address,
    issuedAt,
    expiresAt,
  });
  const signature = await account.signMessage({ message });
  const res = await fetch(`${origin}/api/reader/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      address: account.address,
      issuedAt,
      expiresAt,
      signature,
    }),
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.match(res.headers.get("set-cookie") || "", /op_reader=/);
  assert.match(res.headers.get("set-cookie") || "", /HttpOnly/);
  return body.token;
}

test("GET download without reader or fiat session is 400 with no paid bytes", async () => {
  const res = await fetch(downloadUrl);
  const text = await res.text();
  assert.equal(res.status, 400);
  assert.match(res.headers.get("content-type") || "", /application\/json/);
  assert.equal(text.includes(PAID_BODY), false);
  const body = JSON.parse(text);
  assert.equal(body.error, "reader_or_fiat_session_required");
});

test("GET download with a bare entitled wallet is 401 and leaks no paid bytes", async () => {
  const res = await fetch(`${downloadUrl}?reader=${ENTITLED_READER}`);
  const text = await res.text();
  assert.equal(res.status, 401);
  assert.equal(text.includes(PAID_BODY), false);
  const body = JSON.parse(text);
  assert.equal(body.error, "reader_session_required");
});

test("GET download with a locked wallet session is 403 with no paid bytes", async () => {
  const token = await readerSessionToken(LOCKED_ACCOUNT);
  const res = await fetch(`${downloadUrl}?reader=${LOCKED_READER}`, {
    headers: { "X-Reader-Session": token },
  });
  const text = await res.text();
  assert.equal(res.status, 403);
  assert.match(res.headers.get("content-type") || "", /application\/json/);
  assert.equal(text.includes(PAID_BODY), false);
  const body = JSON.parse(text);
  assert.equal(body.error, "not_unlocked");
  assert.equal(body.body, undefined);
});

test("GET download with an entitled wallet session is free HTML of title + body", async () => {
  const token = await readerSessionToken(ENTITLED_ACCOUNT);
  const res = await fetch(downloadUrl, {
    headers: { "X-Reader-Session": token },
  });
  const text = await res.text();
  assert.equal(res.status, 200, text.slice(0, 300));
  assert.match(res.headers.get("content-type") || "", /text\/html/);
  assert.match(res.headers.get("content-disposition") || "", /^attachment;/);
  assert.match(res.headers.get("content-disposition") || "", /download-demo-article\.html/);
  assert.match(res.headers.get("cache-control") || "", /no-store/);
  assert.match(res.headers.get("x-robots-tag") || "", /noindex/);
  assert.match(text, new RegExp(PAID_BODY));
  assert.match(text, new RegExp(TITLE));
  assert.match(text, /Included with your unlock/);
});

test("GET download with an entitled fiat session is free (no second charge)", async () => {
  const res = await fetch(`${downloadUrl}?fiat_session=${encodeURIComponent(ENTITLED_SESSION)}`);
  const text = await res.text();
  assert.equal(res.status, 200, text.slice(0, 300));
  assert.match(res.headers.get("content-type") || "", /text\/html/);
  assert.match(text, new RegExp(PAID_BODY));
});

test("public listing GET does not leak paid body or a download file", async () => {
  const res = await fetch(`${origin}/api/articles/${SLUG}`);
  const text = await res.text();
  assert.equal(res.status, 200, text.slice(0, 300));
  assert.equal(text.includes(PAID_BODY), false);
  const body = JSON.parse(text);
  assert.equal(body.article?.slug, SLUG);
  assert.equal(body.article?.body, undefined);
  assert.equal(body.article?.title, TITLE);
  assert.equal(typeof body.article?.teaser, "string");
});
