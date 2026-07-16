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

test("GET / serves index.html", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/`);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text, /<!DOCTYPE html>/i);
});
