/**
 * APP_ENV=staging boots only with a non-production Supabase project and Stripe test keys.
 * The process must exit before listen when a live key or the production URL is set.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 18981;
const TEST_URL = "https://mock-staging.supabase.co";
const TEST_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1vY2tzdGFnaW5nIiwicm9sZSI6ImFub24ifQ.sig";

function spawnServer(env) {
  const child = spawn(process.execPath, ["server/index.mjs"], {
    cwd: ROOT,
    env: {
      ...process.env,
      CDP_API_KEY_ID: "",
      CDP_API_KEY_SECRET: "",
      CDP_API_KEY: "",
      CDP_API_SECRET: "",
      STRIPE_WEBHOOK_SECRET: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
      RELAYER_PRIVATE_KEY: "",
      MPP_SECRET_KEY: "",
      MPP_TEMPO_RECIPIENT: "",
      BASE_BUILDER_CODE: "",
      VOICE_DRAFT_API_KEY: "",
      RESEND_API_KEY: "",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return child;
}

async function expectRefusal(env) {
  const child = spawnServer({ PORT: "0", ...env });
  let stderr = "";
  child.stderr.on("data", (buf) => {
    stderr += buf.toString();
  });
  const [code] = await Promise.race([
    once(child, "exit"),
    new Promise((_, reject) => {
      setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error(`server kept running\n${stderr}`));
      }, 5000);
    }),
  ]);
  assert.notEqual(code, 0);
  assert.match(stderr, /Refusing to start/);
}

const child = spawnServer({
  APP_ENV: "staging",
  PORT: String(PORT),
  SUPABASE_URL: TEST_URL,
  SUPABASE_ANON_KEY: TEST_ANON,
  STRIPE_SECRET_KEY: "sk_test_staging",
  STRIPE_PUBLISHABLE_KEY: "",
  VITE_STRIPE_PUBLISHABLE_KEY: "pk_test_staging",
  PUBLIC_ORIGIN: "https://staging.example.test",
  RELAYER_PRIVATE_KEY: `0x${"ab".repeat(32)}`,
});
let bootLog = "";
child.stderr.on("data", (buf) => {
  bootLog += buf.toString();
});
child.stdout.on("data", (buf) => {
  bootLog += buf.toString();
});
await Promise.race([
  once(child.stdout, "data"),
  new Promise((_, reject) => {
    setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`staging server did not start\n${bootLog}`));
    }, 8000);
  }),
]);

after(() => {
  child.kill("SIGTERM");
});

test("staging pages show the banner, a non-production Supabase URL, and noindex", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/articles`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("x-robots-tag") || "", /noindex/);
  const csp = res.headers.get("content-security-policy") || "";
  const nonce = csp.match(/'nonce-([^']+)'/)?.[1];
  assert.ok(nonce);
  const scriptSrc = csp.split(";").map((part) => part.trim()).find((part) => part.startsWith("script-src"));
  assert.match(scriptSrc || "", /'wasm-unsafe-eval'/);
  assert.doesNotMatch(scriptSrc || "", /'unsafe-eval'/);
  assert.doesNotMatch(scriptSrc || "", /'unsafe-inline'/);
  const html = await res.text();
  assert.match(html, new RegExp(`<script nonce="${nonce}">window.__OPENPAYWALL_CONFIG=`));
  assert.match(html, /Test site — fake payments/);
  assert.match(html, /data-supabase-host="mock-staging\.supabase\.co"/);
  assert.match(html, /name="robots" content="noindex, nofollow"/);
  const config = JSON.parse(html.match(/window\.__OPENPAYWALL_CONFIG=(\{.*?\})/)?.[1] || "{}");
  assert.equal(config.supabaseUrl, TEST_URL);
  assert.equal(config.cryptoPay, false);
  assert.equal(config.stripePublishableKey, "pk_test_staging");
  assert.equal(config.gasRelayer, false);
});

test("staging robots.txt disallows crawlers and crypto routes stay closed", async () => {
  const robots = await fetch(`http://127.0.0.1:${PORT}/robots.txt`);
  assert.equal(robots.status, 200);
  assert.match(await robots.text(), /Disallow: \//);
  const relay = await fetch(`http://127.0.0.1:${PORT}/api/relay/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(relay.status, 403);
  const relayBody = await relay.json();
  assert.equal(relayBody.error, "staging_crypto_disabled");
  const stripe = await fetch(`http://127.0.0.1:${PORT}/api/stripe/health`);
  assert.equal(stripe.status, 200);
  const stripeBody = await stripe.json();
  assert.equal(stripeBody.error, undefined);
  assert.doesNotMatch(bootLog, /Refusing to start/);
});

test("staging refuses a live secret key", async () => {
  await expectRefusal({
    APP_ENV: "staging",
    SUPABASE_URL: TEST_URL,
    SUPABASE_ANON_KEY: TEST_ANON,
    STRIPE_SECRET_KEY: "sk_live_not_real",
    VITE_STRIPE_PUBLISHABLE_KEY: "pk_test_staging",
    STRIPE_PUBLISHABLE_KEY: "",
  });
});

test("staging refuses a live publishable key", async () => {
  await expectRefusal({
    APP_ENV: "staging",
    SUPABASE_URL: TEST_URL,
    SUPABASE_ANON_KEY: TEST_ANON,
    STRIPE_SECRET_KEY: "sk_test_staging",
    VITE_STRIPE_PUBLISHABLE_KEY: "pk_live_not_real",
    STRIPE_PUBLISHABLE_KEY: "",
  });
});

test("staging refuses the production Supabase URL", async () => {
  await expectRefusal({
    APP_ENV: "staging",
    SUPABASE_URL: "https://flczjqljgntmkanipugo.supabase.co",
    SUPABASE_ANON_KEY: TEST_ANON,
    STRIPE_SECRET_KEY: "sk_test_staging",
    VITE_STRIPE_PUBLISHABLE_KEY: "pk_test_staging",
    STRIPE_PUBLISHABLE_KEY: "",
  });
});

test("production still starts with a live Stripe key and no Supabase override", async () => {
  const prod = spawnServer({
    APP_ENV: "",
    PORT: "18983",
    SUPABASE_URL: "",
    SUPABASE_ANON_KEY: "",
    STRIPE_SECRET_KEY: "sk_live_not_real",
    VITE_STRIPE_PUBLISHABLE_KEY: "pk_live_not_real",
    STRIPE_PUBLISHABLE_KEY: "",
  });
  try {
    await once(prod.stdout, "data");
    const res = await fetch("http://127.0.0.1:18983/");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-robots-tag"), null);
    const html = await res.text();
    assert.doesNotMatch(html, /Test site — fake payments/);
    assert.match(html, /flczjqljgntmkanipugo\.supabase\.co/);
  } finally {
    prod.kill("SIGTERM");
  }
});
