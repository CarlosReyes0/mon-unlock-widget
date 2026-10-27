/**
 * Writer-card payout safety. Stripe and Supabase are local mocks.
 * Fixtures are synthetic. Logs may contain counts and statuses only.
 */
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const APP_PORT = 18960;
const SB_PORT = 18961;
const STRIPE_PORT = 18962;
const PUBLISHER = "0x0000000000000000000000000000000000000001";
const CHARGE = "ch_test_synthetic";
const LOOKUP_CHARGE = "ch_test_lookup";
const INTENT = "pi_test_synthetic";
const ACCOUNT = "acct_test_synthetic";
const TRANSFER = "tr_test_synthetic";
const FIXTURE_CENTS = 4242;
const FEE_CENTS = 153;
const CRON_SECRET = "test-cron-secret";
const RETRY_SECRET = "test-retry-secret";

const state = {
  unlocks: [],
  jobs: [],
  accounts: [],
};
const transfers = [];
const reversals = [];
const payoutPatches = [];
let failTransfer = false;
let flipOnTransfer = false;
let rejectFeeColumns = false;
const chargeState = {
  fee: FEE_CENTS,
  net: null,
  amount: null,
  currency: "usd",
  refunded: 0,
  fullyRefunded: false,
  disputed: false,
  balanceTransaction: true,
};
let serverLog = "";
let child;

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function readReqBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Request-Id": "req_test_synthetic",
  });
  res.end(JSON.stringify(body));
}

function presentJob(job) {
  const unlock = state.unlocks.find((row) => row.id === job.fiat_unlock_id) || null;
  return {
    ...job,
    fiat_unlocks: unlock
      ? {
          id: unlock.id,
          status: unlock.status,
          stripe_payment_intent_id: unlock.stripe_payment_intent_id,
          stripe_charge_id: unlock.stripe_charge_id ?? null,
        }
      : null,
  };
}

function matches(row, params) {
  for (const [key, value] of params) {
    if (key === "select" || key === "order" || key === "limit") continue;
    if (key === "or") {
      const parts = value.replace(/^\(/, "").replace(/\)$/, "").split(",");
      const ok = parts.some((part) => {
        const match = part.match(/^([a-z_]+)\.eq\.(.+)$/);
        return match ? String(row[match[1]]) === match[2] : false;
      });
      if (!ok) return false;
      continue;
    }
    if (value === "is.null") {
      if (row[key] != null) return false;
      continue;
    }
    const eq = value.match(/^eq\.(.*)$/);
    if (!eq || String(row[key]) !== eq[1]) return false;
  }
  return true;
}

function reset() {
  failTransfer = false;
  flipOnTransfer = false;
  rejectFeeColumns = false;
  chargeState.fee = FEE_CENTS;
  chargeState.net = null;
  chargeState.amount = null;
  chargeState.currency = "usd";
  chargeState.refunded = 0;
  chargeState.fullyRefunded = false;
  chargeState.disputed = false;
  chargeState.balanceTransaction = true;
  api.resetPayoutColumnSupportForTests();
  transfers.length = 0;
  reversals.length = 0;
  payoutPatches.length = 0;
  state.unlocks = [
    {
      id: 501,
      status: "succeeded",
      stripe_payment_intent_id: INTENT,
      stripe_charge_id: CHARGE,
      publisher: PUBLISHER,
    },
  ];
  state.jobs = [
    {
      id: 701,
      fiat_unlock_id: 501,
      publisher: PUBLISHER,
      amount_cents: FIXTURE_CENTS,
      currency: "usd",
      status: "pending",
      stripe_transfer_id: null,
      stripe_charge_id: CHARGE,
      error: null,
      created_at: "2020-01-01T00:00:00.000Z",
    },
  ];
  state.accounts = [
    {
      publisher: PUBLISHER,
      stripe_account_id: ACCOUNT,
      onboarded_at: "2020-01-01T00:00:00.000Z",
    },
  ];
}

function parseStripeBody(raw, contentType) {
  if (!raw) return new URLSearchParams();
  if ((contentType || "").includes("application/json")) {
    const obj = JSON.parse(raw);
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(obj)) {
      if (value && typeof value === "object") {
        for (const [nested, nestedValue] of Object.entries(value)) {
          params.set(`${key}[${nested}]`, String(nestedValue));
        }
      } else if (value != null) {
        params.set(key, String(value));
      }
    }
    return params;
  }
  return new URLSearchParams(raw);
}

const supabase = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${SB_PORT}`);
  const raw = req.method === "GET" || req.method === "HEAD" ? "" : await readReqBody(req);
  if (req.method === "PATCH" && url.pathname === "/rest/v1/payout_jobs") {
    payoutPatches.push(url.search);
    await new Promise((resolve) => setTimeout(resolve, 15));
    const body = raw ? JSON.parse(raw) : {};
    if (
      rejectFeeColumns &&
      (Object.prototype.hasOwnProperty.call(body, "stripe_fee_cents") ||
        Object.prototype.hasOwnProperty.call(body, "net_cents"))
    ) {
      sendJson(res, 400, {
        message: "Could not find the 'stripe_fee_cents' column of 'payout_jobs' in the schema cache",
        code: "PGRST204",
      });
      return;
    }
    const matched = [];
    for (const job of state.jobs) {
      if (!matches(job, url.searchParams)) continue;
      Object.assign(job, body);
      matched.push(presentJob(job));
    }
    sendJson(res, 200, matched);
    return;
  }
  if (req.method === "GET" && url.pathname === "/rest/v1/payout_jobs") {
    let rows = state.jobs.filter((job) => matches(job, url.searchParams));
    if (url.searchParams.get("order") === "created_at.asc") {
      rows = [...rows].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    }
    const limit = Number(url.searchParams.get("limit") || rows.length);
    sendJson(res, 200, rows.slice(0, limit).map(presentJob));
    return;
  }
  if (req.method === "PATCH" && url.pathname === "/rest/v1/fiat_unlocks") {
    const body = raw ? JSON.parse(raw) : {};
    const matched = [];
    for (const unlock of state.unlocks) {
      if (!matches(unlock, url.searchParams)) continue;
      Object.assign(unlock, body);
      matched.push({ ...unlock });
    }
    sendJson(res, 200, matched);
    return;
  }
  if (req.method === "GET" && url.pathname === "/rest/v1/fiat_unlocks") {
    const rows = state.unlocks.filter((unlock) => matches(unlock, url.searchParams));
    sendJson(res, 200, rows.map((unlock) => ({ ...unlock })));
    return;
  }
  if (req.method === "GET" && url.pathname === "/rest/v1/publisher_accounts") {
    const rows = state.accounts.filter((account) => matches(account, url.searchParams));
    sendJson(res, 200, rows.map((account) => ({ ...account })));
    return;
  }
  if (req.method === "PATCH" && url.pathname === "/rest/v1/publisher_accounts") {
    sendJson(res, 200, []);
    return;
  }
  sendJson(res, 404, { message: "unmocked", code: "PGRST000" });
});

const stripe = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${STRIPE_PORT}`);
  const raw = req.method === "GET" || req.method === "HEAD" ? "" : await readReqBody(req);
  if (req.method === "GET" && url.pathname.startsWith("/v1/accounts/")) {
    sendJson(res, 200, {
      id: ACCOUNT,
      object: "account",
      charges_enabled: true,
      payouts_enabled: true,
    });
    return;
  }
  if (req.method === "GET" && url.pathname.startsWith("/v1/payment_intents/")) {
    sendJson(res, 200, {
      id: INTENT,
      object: "payment_intent",
      latest_charge: LOOKUP_CHARGE,
    });
    return;
  }
  if (req.method === "GET" && url.pathname.startsWith("/v1/charges/")) {
    const amount = chargeState.amount ?? FIXTURE_CENTS;
    const fee = chargeState.fee;
    const net = chargeState.net ?? amount - fee;
    const balance =
      chargeState.balanceTransaction === false
        ? null
        : chargeState.balanceTransaction === "id"
          ? "txn_test_synthetic"
          : {
              id: "txn_test_synthetic",
              object: "balance_transaction",
              amount,
              fee,
              net,
              currency: chargeState.currency,
            };
    sendJson(res, 200, {
      id: url.pathname.split("/").pop(),
      object: "charge",
      amount,
      currency: chargeState.currency,
      amount_refunded: chargeState.refunded,
      refunded: chargeState.fullyRefunded,
      disputed: chargeState.disputed,
      balance_transaction: balance,
    });
    return;
  }
  if (req.method === "GET" && url.pathname.startsWith("/v1/balance_transactions/")) {
    const amount = chargeState.amount ?? FIXTURE_CENTS;
    const fee = chargeState.fee;
    const net = chargeState.net ?? amount - fee;
    sendJson(res, 200, {
      id: "txn_test_synthetic",
      object: "balance_transaction",
      amount,
      fee,
      net,
      currency: chargeState.currency,
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/v1/transfers") {
    const params = parseStripeBody(raw, req.headers["content-type"]);
    transfers.push({
      idempotencyKey: req.headers["idempotency-key"] || "",
      source_transaction: params.get("source_transaction") || "",
      destination: params.get("destination") || "",
      amount: params.get("amount") || "",
      raw,
    });
    if (failTransfer) {
      sendJson(res, 400, {
        error: {
          message: "Balance insufficient",
          type: "invalid_request_error",
          code: "balance_insufficient",
        },
      });
      return;
    }
    if (flipOnTransfer) {
      for (const unlock of state.unlocks) unlock.status = "refunded";
      for (const job of state.jobs) {
        if (job.status === "processing") {
          job.status = "skipped";
          job.error = "not_payable";
        }
      }
    }
    sendJson(res, 200, { id: TRANSFER, object: "transfer" });
    return;
  }
  if (req.method === "POST" && /\/v1\/transfers\/[^/]+\/reversals$/.test(url.pathname)) {
    reversals.push({
      path: url.pathname,
      idempotencyKey: req.headers["idempotency-key"] || "",
    });
    sendJson(res, 200, { id: "trr_test_synthetic", object: "transfer_reversal" });
    return;
  }
  sendJson(res, 404, {
    error: { message: "unmocked", type: "invalid_request_error" },
  });
});

await new Promise((resolve) => supabase.listen(SB_PORT, "127.0.0.1", resolve));
await new Promise((resolve) => stripe.listen(STRIPE_PORT, "127.0.0.1", resolve));

process.env.SUPABASE_URL = `http://127.0.0.1:${SB_PORT}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-role-key";
process.env.STRIPE_SECRET_KEY = "sk_test_mock_openpaywall_local_only";
process.env.STRIPE_MOCK_BASE_URL = `http://127.0.0.1:${STRIPE_PORT}`;
process.env.PAYOUTS_CRON_ENABLED = "";
process.env.PAYOUT_RETRY_SECRET = RETRY_SECRET;
process.env.STRIPE_PAYOUT_CRON_SECRET = CRON_SECRET;

const api = await import("./stripe.mjs");

describe("writer card payouts", { concurrency: false }, () => {
  before(async () => {
    child = spawn(process.execPath, ["server/index.mjs"], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(APP_PORT),
        CDP_API_KEY_ID: "",
        CDP_API_KEY_SECRET: "",
        CDP_API_KEY: "",
        CDP_API_SECRET: "",
        STRIPE_SECRET_KEY: "sk_test_mock_openpaywall_local_only",
        STRIPE_WEBHOOK_SECRET: "",
        STRIPE_MOCK_BASE_URL: `http://127.0.0.1:${STRIPE_PORT}`,
        SUPABASE_URL: `http://127.0.0.1:${SB_PORT}`,
        SUPABASE_SERVICE_ROLE_KEY: "test-role-key",
        STRIPE_PAYOUT_CRON_SECRET: CRON_SECRET,
        PAYOUT_RETRY_SECRET: RETRY_SECRET,
        PAYOUTS_CRON_ENABLED: "",
        MPP_SECRET_KEY: "",
        X402_PAY_TO: "",
        RELAYER_PRIVATE_KEY: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk) => {
      serverLog += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      serverLog += chunk.toString();
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(serverLog || "server did not listen")), 10000);
      const check = () => {
        if (serverLog.includes("listening")) {
          clearTimeout(timer);
          resolve();
        }
      };
      child.stdout.on("data", check);
      child.stderr.on("data", check);
      child.on("exit", () => {
        if (!serverLog.includes("listening")) {
          clearTimeout(timer);
          reject(new Error(serverLog || "server exited"));
        }
      });
    });
  });

  const logs = [];
  before(() => {
    console.log = (...args) => {
      logs.push(args.map(String).join(" "));
    };
  });

  function payoutLogs() {
    return logs.filter((line) => line.startsWith("[stripe] payouts"));
  }

  function assertSafeLogs() {
    const text = payoutLogs().join("\n");
    assert.doesNotMatch(text, /ch_|pi_|acct_|tr_|0x|4242|Balance|synthetic|payout_job_/i);
  }

  test("cron flag is off unless the env value is true", () => {
    assert.equal(api.payoutsCronEnabled({}), false);
    assert.equal(api.payoutsCronEnabled({ PAYOUTS_CRON_ENABLED: "" }), false);
    assert.equal(api.payoutsCronEnabled({ PAYOUTS_CRON_ENABLED: "false" }), false);
    assert.equal(api.payoutsCronEnabled({ PAYOUTS_CRON_ENABLED: " TRUE " }), true);
  });

  test("transfer sets source_transaction and the payout idempotency key", async () => {
    reset();
    logs.length = 0;
    const result = await api.processPendingPayouts();
    assert.equal(result.paid, 1);
    assert.equal(transfers.length, 1);
    assert.equal(transfers[0].source_transaction, CHARGE);
    assert.equal(transfers[0].destination, ACCOUNT);
    assert.equal(transfers[0].amount, String(FIXTURE_CENTS - FEE_CENTS));
    assert.equal(state.jobs[0].stripe_fee_cents, FEE_CENTS);
    assert.equal(state.jobs[0].net_cents, FIXTURE_CENTS - FEE_CENTS);
    assert.equal(transfers[0].idempotencyKey, "payout_job_701");
    assert.equal(state.jobs[0].status, "paid");
    assert.equal(state.jobs[0].stripe_transfer_id, TRANSFER);
    assert.ok(payoutPatches.some((query) => query.includes("status=eq.pending") && query.includes("stripe_transfer_id=is.null")));
    assert.match(payoutLogs().join("\n"), /status=ran paid=1/);
    assertSafeLogs();
  });

  test("a second overlapping run cannot transfer the same row", async () => {
    reset();
    logs.length = 0;
    const [first, second] = await Promise.all([api.processPendingPayouts(), api.processPendingPayouts()]);
    assert.equal(transfers.length, 1);
    assert.equal(first.paid + second.paid, 1);
    assert.equal(state.jobs[0].status, "paid");
    assertSafeLogs();
  });

  test("refunded and disputed unlocks are skipped and never transferred", async () => {
    for (const status of ["refunded", "disputed"]) {
      reset();
      logs.length = 0;
      state.unlocks[0].status = status;
      const result = await api.processPendingPayouts();
      assert.equal(result.skipped, 1, status);
      assert.equal(result.paid, 0, status);
      assert.equal(transfers.length, 0, status);
      assert.equal(state.jobs[0].status, "skipped", status);
      assert.equal(state.jobs[0].error, "not_payable", status);
      assertSafeLogs();
    }
  });

  test("marking an unlock refunded or disputed skips an unpaid payout", async () => {
    reset();
    logs.length = 0;
    state.jobs.push({
      id: 702,
      fiat_unlock_id: 501,
      publisher: PUBLISHER,
      amount_cents: FIXTURE_CENTS,
      currency: "usd",
      status: "paid",
      stripe_transfer_id: TRANSFER,
      stripe_charge_id: CHARGE,
      error: null,
      created_at: "2020-01-02T00:00:00.000Z",
    });
    const refunded = await api.markUnlockNotPayable({
      paymentIntentId: INTENT,
      chargeId: CHARGE,
      status: "refunded",
    });
    assert.equal(refunded.skipped, 1);
    assert.equal(state.unlocks[0].status, "refunded");
    assert.equal(state.jobs.find((job) => job.id === 701).status, "skipped");
    assert.equal(state.jobs.find((job) => job.id === 702).status, "paid");
    const ran = await api.processPendingPayouts();
    assert.equal(ran.paid, 0);
    assert.equal(transfers.length, 0);
    assert.match(payoutLogs().join("\n"), /status=refunded paid=0 failed=0 pending=0 skipped=1/);
    assertSafeLogs();
  });

  test("a charge lookup supplies source_transaction when the row has none stored", async () => {
    reset();
    logs.length = 0;
    state.jobs[0].stripe_charge_id = null;
    state.unlocks[0].stripe_charge_id = null;
    const result = await api.processPendingPayouts();
    assert.equal(result.paid, 1);
    assert.equal(transfers[0].source_transaction, LOOKUP_CHARGE);
    assert.equal(state.unlocks[0].stripe_charge_id, LOOKUP_CHARGE);
    assertSafeLogs();
  });

  test("the scheduled run does not retry a failed row", async () => {
    reset();
    logs.length = 0;
    failTransfer = true;
    const failed = await api.processPendingPayouts();
    assert.equal(failed.failed, 1);
    assert.equal(state.jobs[0].status, "failed");
    assert.equal(state.jobs[0].error, "balance_insufficient");
    assert.equal(transfers[0].amount, String(FIXTURE_CENTS - FEE_CENTS));
    assert.equal(state.jobs[0].net_cents, FIXTURE_CENTS - FEE_CENTS);
    assert.equal(transfers.length, 1);
    failTransfer = false;
    const again = await api.processPendingPayouts();
    assert.equal(again.paid, 0);
    assert.equal(again.failed, 0);
    assert.equal(transfers.length, 1);
    assert.equal(state.jobs[0].status, "failed");
    assertSafeLogs();
  });

  test("admin retry is explicit and still claims the row once", async () => {
    reset();
    logs.length = 0;
    state.jobs[0].status = "failed";
    await assert.rejects(api.retryFailedPayouts({ confirm: false }), /payout_retry_not_confirmed/);
    assert.equal(transfers.length, 0);
    const [first, second] = await Promise.all([
      api.retryFailedPayouts({ confirm: true }),
      api.retryFailedPayouts({ confirm: true }),
    ]);
    assert.equal(transfers.length, 1);
    assert.equal(transfers[0].idempotencyKey, "payout_job_701");
    assert.equal(transfers[0].source_transaction, CHARGE);
    assert.equal(transfers[0].amount, String(FIXTURE_CENTS));
    assert.equal(first.paid + second.paid, 1);
    assert.equal(state.jobs[0].status, "paid");
    const cron = await api.processPendingPayouts();
    assert.equal(cron.paid, 0);
    assert.equal(transfers.length, 1);
    assertSafeLogs();
  });

  test("a transfer that loses the row to a refund is reversed", async () => {
    reset();
    logs.length = 0;
    flipOnTransfer = true;
    const result = await api.processPendingPayouts();
    assert.equal(transfers.length, 1);
    assert.equal(reversals.length, 1);
    assert.equal(reversals[0].idempotencyKey, "payout_job_701_reversal");
    assert.equal(result.paid, 0);
    assert.equal(result.reversed, 1);
    assert.equal(state.jobs[0].status, "skipped");
    assertSafeLogs();
  });

  test("the process endpoint is disabled by default and does not transfer", async () => {
    reset();
    const beforeCount = transfers.length;
    const res = await fetch(`http://127.0.0.1:${APP_PORT}/api/stripe/payouts/process`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CRON_SECRET}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.status, "disabled");
    assert.equal(body.paid, 0);
    assert.equal(transfers.length, beforeCount);
    assert.equal(state.jobs[0].status, "pending");
    assert.equal(JSON.stringify(body).includes(CHARGE), false);
    assert.match(serverLog, /\[stripe\] payouts status=disabled paid=0/);
    assert.doesNotMatch(serverLog, /ch_|pi_|acct_|tr_|0x|4242|synthetic/i);
  });

  test("the cron secret cannot call the admin retry", async () => {
    reset();
    state.jobs[0].status = "failed";
    const missing = await fetch(`http://127.0.0.1:${APP_PORT}/api/stripe/payouts/retry`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CRON_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ confirm: true }),
    });
    assert.equal(missing.status, 401);
    const unconfirmed = await fetch(`http://127.0.0.1:${APP_PORT}/api/stripe/payouts/retry`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RETRY_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ confirm: false }),
    });
    assert.equal(unconfirmed.status, 400);
    assert.equal(transfers.length, 0);
    assert.equal(state.jobs[0].status, "failed");
  });

  test("the retry script is manual, and the schedule does not call it", async () => {
    const script = read("scripts/retry-failed-payouts.mjs");
    const migration = read("supabase/migrations/0018_payout_source_charge.sql");
    const index = read("server/index.mjs");
    const processAt = index.indexOf('"/api/stripe/payouts/process"');
    const retryAt = index.indexOf('"/api/stripe/payouts/retry"');
    const processBlock = index.slice(processAt, retryAt);
    assert.equal(processBlock.includes("retryFailedPayouts"), false);
    assert.ok(processBlock.indexOf("payoutsCronEnabled") < processBlock.indexOf("processPendingPayouts"));
    assert.match(migration, /NOT APPLIED to production/);
    assert.match(migration, /open-paywall-payouts/);
    assert.match(migration, /stripe_payout_cron_secret/);
    assert.match(migration, /x-cron-secret/);
    assert.match(migration, /\/api\/stripe\/payouts\/process/);
    assert.match(migration, /PAYOUTS_CRON_ENABLED/);
    assert.doesNotMatch(migration, /payouts\/retry|sk_live|whsec_|rk_live/);
    assert.doesNotMatch(script, /openpaywall\.app/);
    for (const name of fs.readdirSync(path.join(ROOT, ".github/workflows"))) {
      const workflow = read(path.join(".github/workflows", name));
      assert.equal(workflow.includes("/api/stripe/payouts"), false, name);
    }

    reset();
    state.jobs[0].status = "failed";
    const refused = spawn(process.execPath, ["scripts/retry-failed-payouts.mjs"], {
      cwd: ROOT,
      env: { ...process.env, PAYOUT_RETRY_SECRET: RETRY_SECRET },
    });
    const refusedCode = await new Promise((resolve) => refused.on("exit", resolve));
    assert.equal(refusedCode, 1);
    assert.equal(transfers.length, 0);

    const ran = spawn(
      process.execPath,
      ["scripts/retry-failed-payouts.mjs", "--confirm", "--url", `http://127.0.0.1:${APP_PORT}`],
      { cwd: ROOT, env: { ...process.env, PAYOUT_RETRY_SECRET: RETRY_SECRET } }
    );
    let out = "";
    ran.stdout.on("data", (chunk) => {
      out += chunk.toString();
    });
    ran.stderr.on("data", (chunk) => {
      out += chunk.toString();
    });
    const code = await new Promise((resolve) => ran.on("exit", resolve));
    assert.equal(code, 0, out);
    assert.match(out, /status=ran paid=1/);
    assert.doesNotMatch(out, new RegExp(`${RETRY_SECRET}|${CHARGE}|${FIXTURE_CENTS}`));
    assert.equal(transfers.length, 1);
    assert.equal(state.jobs[0].status, "paid");
  });

  test("a 50 cent sale transfers the charge fee's net", async () => {
    reset();
    logs.length = 0;
    state.jobs[0].amount_cents = 50;
    chargeState.amount = 50;
    chargeState.fee = 31;
    chargeState.net = 19;
    const result = await api.processPendingPayouts();
    assert.equal(result.paid, 1);
    assert.equal(transfers[0].amount, "19");
    assert.equal(state.jobs[0].stripe_fee_cents, 31);
    assert.equal(state.jobs[0].net_cents, 19);
    assert.equal(state.jobs[0].amount_cents, 50);
    assertSafeLogs();
  });

  test("tax collected on the charge stays off the transfer", async () => {
    reset();
    logs.length = 0;
    state.jobs[0].amount_cents = 1000;
    chargeState.amount = 1080;
    chargeState.fee = 66;
    chargeState.net = 1014;
    const result = await api.processPendingPayouts();
    assert.equal(result.paid, 1);
    assert.equal(transfers[0].amount, "934");
    assert.equal(state.jobs[0].stripe_fee_cents, 66);
    assert.equal(state.jobs[0].net_cents, 934);
    assertSafeLogs();
  });

  test("the transfer is capped at the platform net", async () => {
    reset();
    state.jobs[0].amount_cents = 1000;
    chargeState.amount = 1000;
    chargeState.fee = 59;
    chargeState.net = 100;
    const result = await api.processPendingPayouts();
    assert.equal(result.paid, 1);
    assert.equal(transfers[0].amount, "100");
    assert.equal(state.jobs[0].net_cents, 100);
  });

  test("a partial refund reduces the transfer by the refunded cents", async () => {
    reset();
    state.jobs[0].amount_cents = 1000;
    chargeState.amount = 1000;
    chargeState.fee = 59;
    chargeState.net = 941;
    chargeState.refunded = 200;
    const result = await api.processPendingPayouts();
    assert.equal(result.paid, 1);
    assert.equal(transfers[0].amount, "741");
    assert.equal(state.jobs[0].net_cents, 741);
    assert.equal(state.jobs[0].stripe_fee_cents, 59);
  });

  test("a missing balance transaction stays pending and is not a failed transfer", async () => {
    reset();
    logs.length = 0;
    chargeState.balanceTransaction = false;
    const waiting = await api.processPendingPayouts();
    assert.equal(waiting.pending, 1);
    assert.equal(waiting.failed, 0);
    assert.equal(waiting.paid, 0);
    assert.equal(transfers.length, 0);
    assert.equal(state.jobs[0].status, "pending");
    assert.equal(state.jobs[0].error, "processing_fee_unavailable");
    chargeState.balanceTransaction = "id";
    const paid = await api.processPendingPayouts();
    assert.equal(paid.paid, 1);
    assert.equal(transfers[0].amount, String(FIXTURE_CENTS - FEE_CENTS));
    assertSafeLogs();
  });

  test("a non-positive net, a refund, and a dispute do not create a transfer", async () => {
    reset();
    logs.length = 0;
    chargeState.fee = FIXTURE_CENTS;
    chargeState.net = 0;
    const eaten = await api.processPendingPayouts();
    assert.equal(eaten.skipped, 1);
    assert.equal(eaten.failed, 0);
    assert.equal(transfers.length, 0);
    assert.equal(state.jobs[0].status, "skipped");
    assert.equal(state.jobs[0].error, "net_non_positive");
    assert.equal(state.jobs[0].stripe_fee_cents, FIXTURE_CENTS);
    assert.equal(state.jobs[0].net_cents, 0);

    reset();
    chargeState.fullyRefunded = true;
    const refunded = await api.processPendingPayouts();
    assert.equal(refunded.skipped, 1);
    assert.equal(transfers.length, 0);
    assert.equal(state.jobs[0].error, "not_payable");

    reset();
    chargeState.disputed = true;
    const disputed = await api.processPendingPayouts();
    assert.equal(disputed.skipped, 1);
    assert.equal(transfers.length, 0);
    assert.equal(state.jobs[0].status, "skipped");
    assertSafeLogs();
  });

  test("a fee in another currency is not converted into a transfer", async () => {
    reset();
    logs.length = 0;
    chargeState.currency = "eur";
    const result = await api.processPendingPayouts();
    assert.equal(result.skipped, 1);
    assert.equal(result.paid, 0);
    assert.equal(transfers.length, 0);
    assert.equal(state.jobs[0].status, "skipped");
    assert.equal(state.jobs[0].error, "fee_currency_mismatch");
    assert.equal(state.jobs[0].stripe_fee_cents, undefined);
    assertSafeLogs();
  });

  test("a failed transfer retries the same net, and a legacy failed row keeps its original amount", async () => {
    reset();
    logs.length = 0;
    failTransfer = true;
    const failed = await api.processPendingPayouts();
    assert.equal(failed.failed, 1);
    assert.equal(transfers[0].amount, String(FIXTURE_CENTS - FEE_CENTS));
    assert.equal(state.jobs[0].status, "failed");
    assert.equal(state.jobs[0].net_cents, FIXTURE_CENTS - FEE_CENTS);
    failTransfer = false;
    const retried = await api.retryFailedPayouts({ confirm: true });
    assert.equal(retried.paid, 1);
    assert.equal(transfers.length, 2);
    assert.equal(transfers[1].amount, String(FIXTURE_CENTS - FEE_CENTS));
    assert.equal(transfers[1].idempotencyKey, "payout_job_701");
    const cron = await api.processPendingPayouts();
    assert.equal(cron.paid, 0);
    assert.equal(transfers.length, 2);

    reset();
    state.jobs[0].status = "failed";
    const legacy = await api.retryFailedPayouts({ confirm: true });
    assert.equal(legacy.paid, 1);
    assert.equal(transfers[0].amount, String(FIXTURE_CENTS));
    assertSafeLogs();
  });

  test("a payout still transfers the net when the fee columns are not migrated", async () => {
    reset();
    logs.length = 0;
    rejectFeeColumns = true;
    const result = await api.processPendingPayouts();
    assert.equal(result.paid, 1);
    assert.equal(result.failed, 0);
    assert.equal(transfers[0].amount, String(FIXTURE_CENTS - FEE_CENTS));
    assert.equal(state.jobs[0].status, "paid");
    assert.equal(state.jobs[0].stripe_fee_cents, undefined);
    assert.equal(state.jobs[0].net_cents, undefined);
    assertSafeLogs();
  });
});

const originalLog = console.log;
after(() => {
  console.log = originalLog;
  child?.kill("SIGTERM");
  supabase.close();
  stripe.close();
});
