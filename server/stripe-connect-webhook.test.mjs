/**
 * Connect webhook: events on connected accounts, verified with
 * STRIPE_CONNECT_WEBHOOK_SECRET. Stripe signature helpers are local.
 * Supabase is a localhost mock. Fixtures are synthetic.
 */
import assert from "node:assert/strict";
import http from "node:http";
import { after, describe, test } from "node:test";
import Stripe from "stripe";

const PLATFORM_SECRET = "whsec_platform_test_only";
const CONNECT_SECRET = "whsec_connect_test_only";
const WRITER = "0x0000000000000000000000000000000000000004";
const READER = "0x0000000000000000000000000000000000000005";
const ACCOUNT = "acct_connect_fixture";
const HASH = `0x${"cd".repeat(32)}`;

const signer = new Stripe("sk_test_mock_openpaywall_local_only");
const state = { unlocks: [], payouts: [], subs: [] };
const stripeCalls = [];

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json", "Request-Id": "req_mock" });
  res.end(JSON.stringify(body));
}

function headerFor(payload, secret) {
  return signer.webhooks.generateTestHeaderString({ payload, secret });
}

const supabase = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const raw = req.method === "GET" || req.method === "HEAD" ? "" : await readBody(req);
  const body = raw ? JSON.parse(raw) : null;

  if (url.pathname === "/rest/v1/fiat_unlocks" && req.method === "POST") {
    const row = body[0];
    if (state.unlocks.some((item) => item.stripe_payment_intent_id === row.stripe_payment_intent_id)) {
      sendJson(res, 409, {
        code: "23505",
        message: 'duplicate key value violates unique constraint "fiat_unlocks_stripe_payment_intent_id_key"',
      });
      return;
    }
    const saved = { id: state.unlocks.length + 1, session_token: row.session_token, ...row };
    state.unlocks.push(saved);
    sendJson(res, 201, [saved]);
    return;
  }
  if (url.pathname === "/rest/v1/fiat_unlocks" && req.method === "GET") {
    const intent = url.searchParams.get("stripe_payment_intent_id") || "";
    const token = url.searchParams.get("session_token") || "";
    const rows = state.unlocks.filter((item) => {
      if (intent.startsWith("eq.")) return item.stripe_payment_intent_id === intent.slice(3);
      if (token.startsWith("eq.")) return item.session_token === token.slice(3);
      return true;
    });
    sendJson(res, 200, rows);
    return;
  }
  if (url.pathname === "/rest/v1/fiat_unlocks" && req.method === "PATCH") {
    const intent = url.searchParams.get("stripe_payment_intent_id") || "";
    const matched = [];
    for (const item of state.unlocks) {
      if (intent.startsWith("eq.") && item.stripe_payment_intent_id === intent.slice(3)) {
        Object.assign(item, body);
        matched.push(item);
      }
    }
    sendJson(res, 200, matched);
    return;
  }
  if (url.pathname === "/rest/v1/payout_jobs" && req.method === "POST") {
    state.payouts.push(body[0]);
    sendJson(res, 201, [{ id: state.payouts.length }]);
    return;
  }
  if (url.pathname === "/rest/v1/payout_jobs" && req.method === "PATCH") {
    const matched = [];
    for (const job of state.payouts) {
      if (job.stripe_transfer_id) continue;
      if (job.status !== "pending" && job.status !== "processing") continue;
      Object.assign(job, body);
      matched.push(job);
    }
    sendJson(res, 200, matched);
    return;
  }
  if (url.pathname === "/rest/v1/subscriptions" && req.method === "POST") {
    const row = { id: 4, ...(body[0] || {}) };
    state.subs.push(row);
    sendJson(res, 201, [row]);
    return;
  }
  sendJson(res, 200, []);
});

const stripeMock = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  if (req.method !== "GET" && req.method !== "HEAD") await readBody(req);
  stripeCalls.push({
    method: req.method,
    path: url.pathname,
    stripeAccount: req.headers["stripe-account"] || "",
  });
  if (req.method === "GET" && url.pathname === "/v1/subscriptions/sub_direct_fixture") {
    sendJson(res, 200, {
      id: "sub_direct_fixture",
      object: "subscription",
      status: "active",
      customer: "cus_fixture",
      current_period_end: 1_800_000_000,
      metadata: {
        product: "writer_subscription",
        reader: READER,
        writer: WRITER,
        connectModel: "direct",
      },
    });
    return;
  }
  sendJson(res, 404, { error: { message: "unmocked" } });
});

await new Promise((resolve) => supabase.listen(0, "127.0.0.1", resolve));
await new Promise((resolve) => stripeMock.listen(0, "127.0.0.1", resolve));

process.env.SUPABASE_URL = `http://127.0.0.1:${supabase.address().port}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-role";
process.env.STRIPE_SECRET_KEY = "sk_test_mock_openpaywall_local_only";
process.env.STRIPE_MOCK_BASE_URL = `http://127.0.0.1:${stripeMock.address().port}`;
process.env.STRIPE_WEBHOOK_SECRET = PLATFORM_SECRET;
process.env.STRIPE_CONNECT_WEBHOOK_SECRET = CONNECT_SECRET;
process.env.STRIPE_CONNECT_DIRECT_CHARGES = "";

const { handleStripeWebhook, handleStripeConnectWebhook } = await import("./stripe.mjs");

after(() => {
  supabase.close();
  stripeMock.close();
});

function reset() {
  state.unlocks = [];
  state.payouts = [];
  state.subs = [];
  stripeCalls.length = 0;
}

function directIntentEvent() {
  return {
    id: "evt_direct_unlock",
    object: "event",
    type: "checkout.session.completed",
    account: ACCOUNT,
    data: {
      object: {
        id: "cs_direct_fixture",
        object: "checkout.session",
        payment_status: "paid",
        payment_intent: "pi_direct_fixture",
        currency: "usd",
        amount_subtotal: 50,
        metadata: {
          product: "mon_unlock_fiat",
          articleId: "story",
          articleIdHash: HASH,
          publisher: WRITER,
          sessionToken: "sess_direct",
          amountUsdCents: "50",
          connectModel: "direct",
        },
      },
    },
  };
}

describe("connect webhook", { concurrency: false }, () => {
test("the connect webhook grants once and does not queue a payout", async () => {
  reset();
  const payload = JSON.stringify(directIntentEvent());
  const header = headerFor(payload, CONNECT_SECRET);
  const first = await handleStripeConnectWebhook(payload, header);
  const second = await handleStripeConnectWebhook(payload, header);
  assert.equal(first.granted, true);
  assert.equal(first.already, false);
  assert.equal(second.already, true);
  assert.equal(state.unlocks.length, 1);
  assert.equal(state.payouts.length, 0);
});

test("the platform secret is rejected on the connect handler", async () => {
  reset();
  const payload = JSON.stringify(directIntentEvent());
  const header = headerFor(payload, PLATFORM_SECRET);
  await assert.rejects(() => handleStripeConnectWebhook(payload, header));
  assert.equal(state.unlocks.length, 0);
});

test("a connect endpoint without event.account is ignored", async () => {
  reset();
  const event = directIntentEvent();
  delete event.account;
  const payload = JSON.stringify(event);
  const result = await handleStripeConnectWebhook(payload, headerFor(payload, CONNECT_SECRET));
  assert.equal(result.ignored, true);
  assert.equal(result.reason, "missing_account");
  assert.equal(state.unlocks.length, 0);
});

test("a platform webhook still queues a legacy payout", async () => {
  reset();
  const event = {
    id: "evt_platform_unlock",
    object: "event",
    type: "payment_intent.succeeded",
    data: {
      object: {
        id: "pi_platform_fixture",
        object: "payment_intent",
        status: "succeeded",
        amount: 50,
        amount_received: 50,
        currency: "usd",
        metadata: {
          product: "mon_unlock_fiat",
          articleId: "story",
          articleIdHash: HASH,
          publisher: WRITER,
          sessionToken: "sess_platform",
          amountUsdCents: "50",
        },
      },
    },
  };
  const payload = JSON.stringify(event);
  const result = await handleStripeWebhook(payload, headerFor(payload, PLATFORM_SECRET));
  assert.equal(result.granted, true);
  assert.equal(state.payouts.length, 1);
  assert.equal(state.payouts[0].status, "pending");
});

test("a connect subscription invoice retrieves on the connected account and skips the payout", async () => {
  reset();
  const event = {
    id: "evt_invoice",
    object: "event",
    type: "invoice.paid",
    account: ACCOUNT,
    data: {
      object: {
        id: "in_direct_fixture",
        object: "invoice",
        subscription: "sub_direct_fixture",
        amount_paid: 500,
        subtotal: 500,
        total_excluding_tax: 500,
      },
    },
  };
  const payload = JSON.stringify(event);
  const result = await handleStripeConnectWebhook(payload, headerFor(payload, CONNECT_SECRET));
  assert.equal(result.applied, true);
  assert.equal(stripeCalls[0].path, "/v1/subscriptions/sub_direct_fixture");
  assert.equal(stripeCalls[0].stripeAccount, ACCOUNT);
  assert.equal(state.payouts.length, 0);
  assert.equal(state.subs.length, 1);
});

test("a connect refund still revokes access and skips an unpaid payout", async () => {
  reset();
  state.unlocks.push({
    id: 7,
    stripe_payment_intent_id: "pi_direct_fixture",
    session_token: "sess_direct",
    status: "succeeded",
  });
  state.payouts.push({
    id: 8,
    fiat_unlock_id: 7,
    status: "pending",
    stripe_transfer_id: null,
  });
  const event = {
    id: "evt_refund",
    object: "event",
    type: "charge.refunded",
    account: ACCOUNT,
    data: {
      object: {
        id: "ch_direct_fixture",
        object: "charge",
        payment_intent: "pi_direct_fixture",
      },
    },
  };
  const payload = JSON.stringify(event);
  const result = await handleStripeConnectWebhook(payload, headerFor(payload, CONNECT_SECRET));
  assert.equal(result.type, "charge.refunded");
  assert.equal(state.unlocks[0].status, "refunded");
  assert.equal(state.payouts[0].status, "skipped");
  assert.equal(state.payouts[0].error, "not_payable");
});

test("the connect handler is not configured without its secret", async () => {
  const previous = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
  process.env.STRIPE_CONNECT_WEBHOOK_SECRET = "";
  try {
    await assert.rejects(
      () => handleStripeConnectWebhook("{}", "t"),
      (err) => err.status === 503 && err.message === "stripe_connect_webhook_not_configured"
    );
  } finally {
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET = previous;
  }
});
});
