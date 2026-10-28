/**
 * Direct charges on the writer's connected account. Stripe and Supabase are
 * local mocks. Fixtures are synthetic.
 */
import assert from "node:assert/strict";
import http from "node:http";
import { after, describe, test } from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import { buildConnectAuthMessage } from "./writer-mutation-auth.mjs";

const OWNER_KEY = "0xac0974bec39a17e36ba4a6b4d4aad435cce0e4c9335790421507b8a191e28881";
const owner = privateKeyToAccount(OWNER_KEY);
const READER = "0x0000000000000000000000000000000000000002";
const BLOCKED = "0x000000000000000000000000000000000000dead";
const HASH = `0x${"ab".repeat(32)}`;

const state = {
  account: null,
  chargesEnabled: true,
  plans: [],
  subs: [],
  unlocks: [],
  payouts: [],
};
const stripeCalls = [];
const sbPosts = [];

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

function eq(params, key) {
  const value = params.get(key) || "";
  return value.startsWith("eq.") ? decodeURIComponent(value.slice(3)) : "";
}

const supabase = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const raw = req.method === "GET" || req.method === "HEAD" ? "" : await readBody(req);
  if (req.method === "POST") sbPosts.push({ path: url.pathname, raw });

  if (url.pathname === "/rest/v1/articles" && req.method === "GET") {
    const cents = url.searchParams.get("article_id") === "eq.under-min" ? 10 : 50;
    sendJson(res, 200, [
      {
        article_id: eq(url.searchParams, "article_id") || "story",
        article_id_hash: HASH,
        publisher: owner.address.toLowerCase(),
        price_wei: "500000",
        price_cents: cents,
        listing_status: "listed",
        payment_asset: "usdc",
        allow_a_la_carte: true,
      },
    ]);
    return;
  }
  if (url.pathname === "/rest/v1/publisher_accounts" && req.method === "GET") {
    const publisher = eq(url.searchParams, "publisher");
    if (state.account && state.account.publisher === publisher) sendJson(res, 200, [state.account]);
    else sendJson(res, 200, []);
    return;
  }
  if (url.pathname === "/rest/v1/publisher_accounts" && req.method === "POST") {
    const row = raw ? JSON.parse(raw)[0] : null;
    if (row) state.account = { ...state.account, ...row };
    sendJson(res, 201, []);
    return;
  }
  if (url.pathname === "/rest/v1/writer_plans" && req.method === "GET") {
    sendJson(res, 200, state.plans);
    return;
  }
  if (url.pathname === "/rest/v1/writer_plans" && req.method === "PATCH") {
    sendJson(res, 200, state.plans);
    return;
  }
  if (url.pathname === "/rest/v1/subscriptions" && req.method === "GET") {
    const reader = eq(url.searchParams, "reader");
    const writer = eq(url.searchParams, "writer");
    sendJson(
      res,
      200,
      state.subs.filter((row) => (!reader || row.reader === reader) && (!writer || row.writer === writer))
    );
    return;
  }
  if (url.pathname === "/rest/v1/subscriptions" && (req.method === "POST" || req.method === "PATCH")) {
    sendJson(res, 200, [{ id: 3, status: "canceled" }]);
    return;
  }
  if (url.pathname === "/rest/v1/fiat_unlocks" && req.method === "POST") {
    const row = raw ? JSON.parse(raw)[0] : {};
    state.unlocks.push({ id: state.unlocks.length + 1, ...row });
    sendJson(res, 201, [state.unlocks.at(-1)]);
    return;
  }
  if (url.pathname === "/rest/v1/payout_jobs" && req.method === "POST") {
    state.payouts.push(raw ? JSON.parse(raw)[0] : {});
    sendJson(res, 201, [{ id: 1 }]);
    return;
  }
  sendJson(res, 200, []);
});

const stripe = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const raw = req.method === "GET" || req.method === "HEAD" ? "" : await readBody(req);
  stripeCalls.push({
    method: req.method,
    path: url.pathname,
    raw,
    stripeAccount: req.headers["stripe-account"] || "",
    stripeVersion: req.headers["stripe-version"] || "",
  });
  if (req.method === "POST" && url.pathname === "/v1/accounts") {
    sendJson(res, 200, { id: "acct_new_direct", object: "account", charges_enabled: false, payouts_enabled: false });
    return;
  }
  if (req.method === "GET" && url.pathname.startsWith("/v1/accounts/")) {
    sendJson(res, 200, {
      id: decodeURIComponent(url.pathname.split("/").pop() || ""),
      object: "account",
      charges_enabled: state.chargesEnabled,
      payouts_enabled: state.chargesEnabled,
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/v1/account_links") {
    sendJson(res, 200, { object: "account_link", url: "https://connect.stripe.test/onboard", expires_at: 1 });
    return;
  }
  if (req.method === "GET" && url.pathname === "/v1/payment_method_configurations") {
    sendJson(res, 200, { object: "list", data: [] });
    return;
  }
  if (req.method === "POST" && url.pathname === "/v1/checkout/sessions") {
    sendJson(res, 200, {
      id: "cs_direct_fixture",
      object: "checkout.session",
      client_secret: "cs_secret_fixture",
      url: "https://checkout.stripe.test/pay",
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/v1/products") {
    sendJson(res, 200, { id: "prod_direct_fixture", object: "product" });
    return;
  }
  if (req.method === "POST" && url.pathname === "/v1/prices") {
    sendJson(res, 200, { id: "price_direct_fixture", object: "price" });
    return;
  }
  if (req.method === "DELETE" && url.pathname.startsWith("/v1/subscriptions/")) {
    sendJson(res, 200, { id: "sub_direct_fixture", object: "subscription", status: "canceled" });
    return;
  }
  sendJson(res, 404, { error: { message: `unmocked ${req.method} ${url.pathname}` } });
});

await new Promise((resolve) => supabase.listen(0, "127.0.0.1", resolve));
await new Promise((resolve) => stripe.listen(0, "127.0.0.1", resolve));

process.env.SUPABASE_URL = `http://127.0.0.1:${supabase.address().port}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-role";
process.env.STRIPE_SECRET_KEY = "sk_test_mock_openpaywall_local_only";
process.env.STRIPE_MOCK_BASE_URL = `http://127.0.0.1:${stripe.address().port}`;
process.env.STRIPE_WEBHOOK_SECRET = "";
process.env.STRIPE_CONNECT_WEBHOOK_SECRET = "";
process.env.STRIPE_CONNECT_DIRECT_CHARGES = "";
process.env.STRIPE_DIRECT_TAX_LIABILITY = "";
delete process.env.BLOCKED_PUBLISHERS;

const api = await import("./stripe.mjs");
const subs = await import("./subscriptions.mjs");

after(() => {
  supabase.close();
  stripe.close();
  delete process.env.BLOCKED_PUBLISHERS;
  delete process.env.STRIPE_CONNECT_DIRECT_CHARGES;
});

function reset() {
  state.account = null;
  state.chargesEnabled = true;
  state.plans = [];
  state.subs = [];
  state.unlocks = [];
  state.payouts = [];
  stripeCalls.length = 0;
  sbPosts.length = 0;
  api.resetPayoutColumnSupportForTests();
  api.resetPaymentMethodConfigurationCache?.();
  process.env.STRIPE_CONNECT_DIRECT_CHARGES = "";
  process.env.STRIPE_DIRECT_TAX_LIABILITY = "";
  delete process.env.BLOCKED_PUBLISHERS;
}

function checkoutCalls() {
  return stripeCalls.filter((call) => call.path === "/v1/checkout/sessions");
}

async function signedOnboard(overrides = {}) {
  const issuedAt = new Date().toISOString();
  const reonboard = overrides.reonboard === true;
  const message = buildConnectAuthMessage({ publisher: owner.address, issuedAt, reonboard });
  const connectSig = await owner.signMessage({ message });
  return api.createConnectOnboardingLink({
    publisher: owner.address,
    issuedAt,
    connectSig,
    reonboard,
    refreshUrl: "https://example.test/account.html",
    returnUrl: "https://example.test/account.html",
  });
}

describe("direct charges", { concurrency: false }, () => {
test("flag off creates a legacy Express account and does not send the preview version", async () => {
  reset();
  const link = await signedOnboard();
  assert.equal(link.stripeAccountId, "acct_new_direct");
  const created = stripeCalls.find((call) => call.method === "POST" && call.path === "/v1/accounts");
  assert.ok(created);
  assert.match(created.raw, /type=express/);
  assert.equal(created.stripeVersion, "2026-06-24.dahlia");
  assert.doesNotMatch(created.raw, /fees\[payer\]/);
  assert.equal(state.account.connect_model, undefined);
});

test("flag on creates a direct account with the preview controller properties", async () => {
  reset();
  process.env.STRIPE_CONNECT_DIRECT_CHARGES = "true";
  await signedOnboard();
  const created = stripeCalls.find((call) => call.method === "POST" && call.path === "/v1/accounts");
  assert.equal(created.stripeVersion, "2026-06-24.preview");
  assert.match(created.raw, /controller\[stripe_dashboard\]\[type\]=express/);
  assert.match(created.raw, /controller\[fees\]\[payer\]=account/);
  assert.match(created.raw, /controller\[losses\]\[payments\]=stripe/);
  assert.match(created.raw, /controller\[requirement_collection\]=stripe/);
  assert.match(created.raw, /capabilities\[card_payments\]\[requested\]=true/);
  assert.match(created.raw, /capabilities\[transfers\]\[requested\]=true/);
  assert.doesNotMatch(created.raw, /(^|&)type=express(&|$)/);
  assert.equal(state.account.connect_model, "direct");
  assert.equal(state.account.legacy_stripe_account_id, null);
});

test("direct-model accounts set the fee payer to the connected account", async () => {
  const params = api.directConnectAccountParams("0x0000000000000000000000000000000000000001");
  assert.equal(params.controller.fees.payer, "account");
  assert.equal(
    ["application", "application_express", "application_custom"].includes(params.controller.fees.payer),
    false
  );
  reset();
  process.env.STRIPE_CONNECT_DIRECT_CHARGES = "true";
  await signedOnboard();
  const created = stripeCalls.find((call) => call.method === "POST" && call.path === "/v1/accounts");
  const payer = new URLSearchParams(created.raw).get("controller[fees][payer]");
  assert.equal(payer, "account");
  assert.equal(["application", "application_express", "application_custom"].includes(payer), false);
});

test("a legacy account keeps working until the writer re-onboards", async () => {
  reset();
  process.env.STRIPE_CONNECT_DIRECT_CHARGES = "true";
  state.account = {
    publisher: owner.address.toLowerCase(),
    stripe_account_id: "acct_legacy_writer",
    connect_model: null,
    onboarded_at: "2020-01-01T00:00:00.000Z",
  };
  const link = await signedOnboard();
  assert.equal(link.stripeAccountId, "acct_legacy_writer");
  assert.equal(
    stripeCalls.some((call) => call.method === "POST" && call.path === "/v1/accounts"),
    false
  );
  stripeCalls.length = 0;
  const again = await signedOnboard({ reonboard: true });
  assert.equal(again.stripeAccountId, "acct_new_direct");
  assert.equal(state.account.connect_model, "direct");
  assert.equal(state.account.legacy_stripe_account_id, "acct_legacy_writer");
  assert.equal(state.account.onboarded_at, null);
});

test("direct checkout is created on the connected account and keeps the 50 cent minimum", async () => {
  reset();
  process.env.STRIPE_CONNECT_DIRECT_CHARGES = "true";
  state.account = {
    publisher: owner.address.toLowerCase(),
    stripe_account_id: "acct_writer_direct",
    connect_model: "direct",
    onboarded_at: "2020-01-01T00:00:00.000Z",
  };
  const session = await api.createArticleCheckoutSession({
    articleId: "story",
    amountUsdCents: 50,
    title: "Fixture",
    returnUrl: "https://example.test/unlock.html?session_id={CHECKOUT_SESSION_ID}",
  });
  assert.equal(session.stripeAccountId, "acct_writer_direct");
  assert.equal(session.amountUsdCents, 50);
  const created = checkoutCalls()[0];
  assert.equal(created.stripeAccount, "acct_writer_direct");
  assert.equal(created.stripeVersion, "2026-06-24.dahlia");
  assert.match(created.raw, /connectModel.*direct|connectModel=direct/);
  assert.doesNotMatch(created.raw, /application_fee_amount/);
  assert.doesNotMatch(created.raw, /(^|&)payment_method_types(\[|=)/);
  assert.match(created.raw, /stripe_account/);
  const pmc = stripeCalls.find((call) => call.path === "/v1/payment_method_configurations");
  assert.equal(pmc.stripeAccount, "acct_writer_direct");
});

test("a writer with no payable account cannot take cards while the flag is on", async () => {
  reset();
  process.env.STRIPE_CONNECT_DIRECT_CHARGES = "true";
  await assert.rejects(
    () =>
      api.createArticleCheckoutSession({
        articleId: "story",
        amountUsdCents: 50,
        title: "Fixture",
        returnUrl: "https://example.test/unlock.html?session_id={CHECKOUT_SESSION_ID}",
      }),
    (err) => err.status === 409 && err.message === "publisher_not_payable"
  );
  assert.equal(checkoutCalls().length, 0);
  state.account = {
    publisher: owner.address.toLowerCase(),
    stripe_account_id: "acct_writer_direct",
    connect_model: "direct",
  };
  state.chargesEnabled = false;
  await assert.rejects(
    () =>
      api.createArticleCheckoutSession({
        articleId: "story",
        amountUsdCents: 50,
        title: "Fixture",
        returnUrl: "https://example.test/unlock.html?session_id={CHECKOUT_SESSION_ID}",
      }),
    (err) => err.message === "publisher_not_payable"
  );
});

test("stored prices under 50 cents are still rejected on the direct path", async () => {
  reset();
  process.env.STRIPE_CONNECT_DIRECT_CHARGES = "true";
  state.account = {
    publisher: owner.address.toLowerCase(),
    stripe_account_id: "acct_writer_direct",
    connect_model: "direct",
  };
  state.chargesEnabled = true;
  await assert.rejects(
    () =>
      api.createArticleCheckoutSession({
        articleId: "under-min",
        amountUsdCents: 50,
        title: "Fixture",
        returnUrl: "https://example.test/unlock.html?session_id={CHECKOUT_SESSION_ID}",
      }),
    (err) => err.status === 400 && err.message === "invalid_amount"
  );
});

test("a direct-charge unlock does not queue a payout job", async () => {
  reset();
  const granted = await api.grantFiatUnlockFromIntent({
    id: "pi_direct_fixture",
    status: "succeeded",
    amount: 50,
    amount_received: 50,
    currency: "usd",
    metadata: {
      product: "mon_unlock_fiat",
      articleId: "story",
      articleIdHash: HASH,
      publisher: owner.address.toLowerCase(),
      sessionToken: "sess_direct",
      amountUsdCents: "50",
      connectModel: "direct",
    },
  });
  assert.equal(granted.granted, true);
  assert.equal(state.payouts.length, 0);
  assert.equal(sbPosts.some((row) => row.path === "/rest/v1/payout_jobs"), false);
});

test("a blocked publisher still cannot onboard or check out when the flag is on", async () => {
  reset();
  process.env.STRIPE_CONNECT_DIRECT_CHARGES = "true";
  process.env.BLOCKED_PUBLISHERS = BLOCKED;
  await assert.rejects(
    () =>
      api.createConnectOnboardingLink({
        publisher: BLOCKED,
        refreshUrl: "https://example.test/r",
        returnUrl: "https://example.test/r",
      }),
    (err) => err.status === 403 && err.message === "forbidden"
  );
  assert.equal(
    stripeCalls.some((call) => call.path.startsWith("/v1/accounts")),
    false
  );
});

test("direct subscription checkout and cancel run on the connected account and skip payouts", async () => {
  reset();
  process.env.STRIPE_CONNECT_DIRECT_CHARGES = "true";
  state.account = {
    publisher: owner.address.toLowerCase(),
    stripe_account_id: "acct_writer_direct",
    connect_model: "direct",
    onboarded_at: "2020-01-01T00:00:00.000Z",
  };
  state.plans = [{ publisher: owner.address.toLowerCase(), monthly_price_cents: 500, allow_a_la_carte: true }];
  const session = await subs.createStripeSubscriptionCheckout({
    reader: READER,
    writer: owner.address,
    successUrl: "https://example.test/ok",
    cancelUrl: "https://example.test/no",
  });
  assert.equal(session.stripeAccountId, "acct_writer_direct");
  const created = checkoutCalls()[0];
  assert.equal(created.stripeAccount, "acct_writer_direct");
  assert.doesNotMatch(created.raw, /application_fee_percent/);
  assert.match(created.raw, /connectModel/);
  const product = stripeCalls.find((call) => call.path === "/v1/products");
  const price = stripeCalls.find((call) => call.path === "/v1/prices");
  assert.equal(product.stripeAccount, "acct_writer_direct");
  assert.equal(price.stripeAccount, "acct_writer_direct");

  state.subs = [
    {
      id: 9,
      reader: READER,
      writer: owner.address.toLowerCase(),
      source: "stripe",
      status: "active",
      stripe_subscription_id: "sub_direct_fixture",
    },
  ];
  stripeCalls.length = 0;
  await subs.cancelWriterSubscription({ reader: READER, writer: owner.address });
  const canceled = stripeCalls.find((call) => call.method === "DELETE");
  assert.equal(canceled.path, "/v1/subscriptions/sub_direct_fixture");
  assert.equal(canceled.stripeAccount, "acct_writer_direct");
});
});
