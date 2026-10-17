/**
 * Paid unlocks per week: aggregation, admin gate, and the example-data flag.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  atomicAmount,
  examplePaidUnlocks,
  formatMethodRevenue,
  usageExampleEnabled,
  utcWeekKey,
  weeklyPaidUnlocks,
} from "./usage-stats.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SECRET = "test-listing-admin-secret";

test("UTC weeks start on Monday and match a known Saturday", () => {
  assert.equal(utcWeekKey("2026-10-17T12:00:00.000Z"), "2026-10-12");
  assert.equal(utcWeekKey("2026-10-12T00:00:00.000Z"), "2026-10-12");
  assert.equal(utcWeekKey("2026-10-18T23:00:00.000Z"), "2026-10-12");
  assert.equal(utcWeekKey("2026-10-19T00:00:00.000Z"), "2026-10-19");
});

test("weekly totals count unlocks and revenue, and skip refunds", () => {
  const report = weeklyPaidUnlocks({
    now: new Date("2026-10-17T15:00:00.000Z"),
    unlocks: [
      { unlocked_at: "2026-10-13T00:00:00.000Z", amount_wei: "1000000000000000000", payment_asset: "mon" },
      { unlocked_at: "2026-10-13T00:00:00.000Z", amount_wei: "2500000", payment_asset: "usdc" },
    ],
    fiatUnlocks: [
      { unlocked_at: "2026-10-14T00:00:00.000Z", amount_cents: 150, currency: "usd", status: "succeeded" },
      { unlocked_at: "2026-10-14T00:00:00.000Z", amount_cents: 999, currency: "usd", status: "refunded" },
    ],
  });

  assert.equal(report.example, false);
  assert.equal(report.thisWeek.week, "2026-10-12");
  assert.equal(report.thisWeek.unlocks, 3);
  const byMethod = Object.fromEntries(report.thisWeek.byMethod.map((row) => [row.method, row]));
  assert.equal(byMethod.crypto_mon.unlocks, 1);
  assert.equal(byMethod.crypto_mon.revenue, "1 MON");
  assert.equal(byMethod.crypto_usdc.revenue, "2.5 USDC");
  assert.equal(byMethod.stripe.unlocks, 1);
  assert.equal(byMethod.stripe.revenue, "$1.50");
  assert.equal(report.allTime.unlocks, 3);
  assert.equal(JSON.stringify(report).includes("0x"), false);
  assert.equal(JSON.stringify(report).includes("buyer_email"), false);
});

test("revenue formatting keeps whole MON and cent precision", () => {
  assert.equal(formatMethodRevenue("crypto_mon", atomicAmount("12000000000000000000")), "12 MON");
  assert.equal(formatMethodRevenue("stripe", 550n), "$5.50");
  assert.equal(formatMethodRevenue("stripe", 0n), "$0.00");
});

test("example mode is labeled and is refused in production", () => {
  const example = examplePaidUnlocks();
  assert.equal(example.example, true);
  assert.match(example.label, /Example \/ test data/);
  assert.equal(example.thisWeek.unlocks, 4);
  assert.equal(example.thisWeek.byMethod.find((row) => row.method === "crypto_mon").revenue, "7 MON");
  assert.equal(example.thisWeek.byMethod.find((row) => row.method === "stripe").revenue, "$3.00");
  assert.equal(usageExampleEnabled({ NODE_ENV: "development", USAGE_STATS_EXAMPLE: "1" }), true);
  assert.equal(usageExampleEnabled({ NODE_ENV: "production", USAGE_STATS_EXAMPLE: "1" }), false);
  assert.equal(usageExampleEnabled({ NODE_ENV: "development", USAGE_STATS_EXAMPLE: "" }), false);
});

test("the documented SQL query is read-only and does not select identities", () => {
  const sql = fs.readFileSync(path.join(ROOT, "supabase/usage/paid_unlocks_per_week.sql"), "utf8");
  assert.match(sql, /public\.unlocks/);
  assert.match(sql, /public\.fiat_unlocks/);
  assert.match(sql, /status = 'succeeded'/);
  assert.match(sql, /amount_wei/);
  assert.match(sql, /amount_cents/);
  assert.match(sql, /Do not apply it/);
  assert.doesNotMatch(sql, /\b(insert|update|delete|create table|alter table)\b/i);
  assert.doesNotMatch(sql, /buyer_email|reader|created_ip/);
});

const fetches = [];
const mock = http.createServer((req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  fetches.push(url.pathname + url.search);
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer mock-service-role")) {
    res.writeHead(401);
    res.end(JSON.stringify({ message: "denied" }));
    return;
  }
  if (url.pathname === "/rest/v1/unlocks") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify([
        {
          unlocked_at: "2026-06-20T07:10:13.074Z",
          amount_wei: "1000000000000000000",
          payment_asset: "mon",
        },
      ])
    );
    return;
  }
  if (url.pathname === "/rest/v1/fiat_unlocks") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify([
        {
          unlocked_at: "2026-07-14T01:29:45.766Z",
          amount_cents: 50,
          currency: "usd",
          status: "succeeded",
        },
      ])
    );
    return;
  }
  res.writeHead(404);
  res.end("{}");
});
await new Promise((resolve) => mock.listen(0, "127.0.0.1", resolve));
const mockPort = mock.address().port;

function startServer(port, env) {
  const child = spawn(process.execPath, ["server/index.mjs"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      LISTING_ADMIN_SECRET: SECRET,
      SUPABASE_URL: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
      STRIPE_SECRET_KEY: "",
      STRIPE_WEBHOOK_SECRET: "",
      CDP_API_KEY_ID: "",
      CDP_API_KEY_SECRET: "",
      MPP_SECRET_KEY: "",
      MPP_TEMPO_RECIPIENT: "",
      RELAYER_PRIVATE_KEY: "",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", () => {});
  child.stderr.on("data", () => {});
  return child;
}

async function waitFor(port) {
  const deadline = Date.now() + 15000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/usage/paid-unlocks`);
      if (res.status) return;
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError || new Error(`server ${port} did not start`);
}

const exampleServer = startServer(18971, {
  NODE_ENV: "development",
  USAGE_STATS_EXAMPLE: "1",
});
const liveServer = startServer(18972, {
  NODE_ENV: "development",
  USAGE_STATS_EXAMPLE: "",
  SUPABASE_URL: `http://127.0.0.1:${mockPort}`,
  SUPABASE_SERVICE_ROLE_KEY: "mock-service-role",
});
const productionServer = startServer(18973, {
  NODE_ENV: "production",
  USAGE_STATS_EXAMPLE: "1",
});

await Promise.all([waitFor(18971), waitFor(18972), waitFor(18973)]);

after(() => {
  exampleServer.kill("SIGTERM");
  liveServer.kill("SIGTERM");
  productionServer.kill("SIGTERM");
  mock.close();
});

async function getJson(port, headers = {}) {
  const res = await fetch(`http://127.0.0.1:${port}/api/usage/paid-unlocks`, { headers });
  const body = await res.json();
  return { status: res.status, body };
}

test("the admin endpoint rejects a missing or wrong secret", async () => {
  const missing = await getJson(18971);
  assert.equal(missing.status, 401);
  assert.equal(missing.body.error, "unauthorized");
  const wrong = await getJson(18971, { Authorization: "Bearer not-the-secret" });
  assert.equal(wrong.status, 401);
});

test("example responses are labeled and are not served in production", async () => {
  const ok = await getJson(18971, { Authorization: `Bearer ${SECRET}` });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.example, true);
  assert.match(ok.body.label, /Example \/ test data/);
  assert.equal(ok.body.thisWeek.unlocks, 4);

  const page = await fetch("http://127.0.0.1:18971/admin-usage.html");
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.match(html, /Paid unlocks per week/);
  assert.match(html, /LISTING_ADMIN_SECRET/);
  assert.match(html, /Example \/ test data — not production/);
  assert.doesNotMatch(html, /<script[^>]+src="https?:/i);

  const prod = await getJson(18973, { Authorization: `Bearer ${SECRET}` });
  assert.equal(prod.status, 503);
  assert.equal(prod.body.error, "supabase_not_configured");
  assert.equal(prod.body.example, undefined);
});

test("GET /api/usage/paid-unlocks reads stored purchase rows and not identities", async () => {
  const { status, body } = await getJson(18972, { Authorization: `Bearer ${SECRET}` });
  assert.equal(status, 200);
  assert.equal(body.example, false);
  assert.equal(body.label, null);
  assert.equal(body.allTime.unlocks, 2);
  assert.equal(body.thisWeek.week, utcWeekKey(new Date()));
  const monWeek = body.weeks.find((week) => week.week === "2026-06-15");
  const stripeWeek = body.weeks.find((week) => week.week === "2026-07-13");
  assert.equal(monWeek.byMethod.find((row) => row.method === "crypto_mon").revenue, "1 MON");
  assert.equal(stripeWeek.byMethod.find((row) => row.method === "stripe").revenue, "$0.50");
  assert.ok(fetches.some((query) => query.includes("select=unlocked_at,amount_wei,payment_asset")));
  assert.ok(fetches.some((query) => query.includes("select=unlocked_at,amount_cents,currency,status")));
  assert.equal(fetches.some((query) => /email|reader|publisher|tx_hash/i.test(query)), false);
});
