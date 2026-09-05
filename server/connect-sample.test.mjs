/**
 * Smoke tests for the Connect sample (no Stripe secret required).
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test, after } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = 18766;

const child = spawn(process.execPath, ["server/index.mjs"], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT: String(PORT),
    STRIPE_SECRET_KEY: "",
    STRIPE_WEBHOOK_SECRET: "",
    STRIPE_CONNECT_WEBHOOK_SECRET: "",
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

test("GET /api/connect-sample/health reports stripeConfigured=false without secret", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/connect-sample/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.stripeConfigured, false);
});

test("POST /api/connect-sample/accounts returns helpful error without STRIPE_SECRET_KEY", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/connect-sample/accounts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId: "u1",
      displayName: "Demo",
      contactEmail: "demo@example.com",
    }),
  });
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.error, "stripe_not_configured");
  assert.match(body.message, /STRIPE_SECRET_KEY/);
});

test("GET /connect-demo.html is served", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/connect-demo.html`);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text, /Onboard to collect payments/i);
  assert.match(text, /site-nav\.js/);
});

test("GET /site-nav.js is served", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/site-nav.js`);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text, /Create embed/);
  assert.match(text, /Connect marketplace/);
});
