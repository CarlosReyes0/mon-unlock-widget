/**
 * The unauthenticated Stripe Connect sample is gone. Pages and API routes
 * 404. The writer Account onboarding route and the static nav stay up.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test, after } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = 18767;

const SAMPLE_ROUTES = [
  ["GET", "/api/connect-sample/health"],
  ["GET", "/api/connect-sample/sellers"],
  ["POST", "/api/connect-sample/accounts"],
  ["POST", "/api/connect-sample/account-link"],
  ["GET", "/api/connect-sample/account-status?accountId=acct_test"],
  ["POST", "/api/connect-sample/products"],
  ["GET", "/api/connect-sample/products"],
  ["POST", "/api/connect-sample/checkout"],
  ["GET", "/api/connect-sample/checkout-session?session_id=cs_test"],
  ["POST", "/api/connect-sample/webhook"],
];

const SAMPLE_PAGES = ["/connect-demo.html", "/connect-store.html", "/connect-success.html"];

const child = spawn(process.execPath, ["server/index.mjs"], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT: String(PORT),
    STRIPE_SECRET_KEY: "",
    STRIPE_WEBHOOK_SECRET: "",
    STRIPE_CONNECT_WEBHOOK_SECRET: "",
    STRIPE_MOCK_BASE_URL: "",
    CDP_API_KEY_ID: "",
    CDP_API_KEY_SECRET: "",
    SUPABASE_URL: "",
    SUPABASE_SERVICE_ROLE_KEY: "",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

await once(child.stdout, "data");

after(() => {
  child.kill("SIGTERM");
});

async function hit(method, path) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method,
    headers: method === "GET" ? undefined : { "Content-Type": "application/json" },
    body:
      method === "GET"
        ? undefined
        : JSON.stringify({
            userId: "u1",
            displayName: "Demo",
            contactEmail: "demo@example.com",
            accountId: "acct_test",
            productId: "prod_test",
          }),
  });
  const text = await res.text();
  return { status: res.status, text };
}

test("Connect sample API routes return 404", async () => {
  for (const [method, path] of SAMPLE_ROUTES) {
    const res = await hit(method, path);
    assert.equal(res.status, 404, `${method} ${path} -> ${res.status} ${res.text}`);
    assert.match(res.text, /Not found/);
    assert.doesNotMatch(res.text, /acct_|sk_live|sk_test/);
  }
});

test("Connect sample HTML pages return 404", async () => {
  for (const path of SAMPLE_PAGES) {
    const res = await hit("GET", path);
    assert.equal(res.status, 404, `${path} -> ${res.status} ${res.text}`);
    assert.match(res.text, /Not found/);
  }
});

test("GET /site-nav.js no longer links to the Connect sample", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/site-nav.js`);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text, /Create embed/);
  assert.match(text, /href: "\/"/);
  assert.match(text, /label: "Articles"/);
  assert.doesNotMatch(text, /connect-demo\.html/);
  assert.doesNotMatch(text, /connect-store\.html/);
  assert.doesNotMatch(text, /Connect marketplace/);
});

test("reader checkout route is still mounted", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/stripe/create-intent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const text = await res.text();
  assert.notEqual(res.status, 404, text);
});
