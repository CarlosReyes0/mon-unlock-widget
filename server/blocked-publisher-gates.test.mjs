/**
 * Denylist gates for writer mutations, card checkout, and payout creation.
 * Supabase and Stripe are local mocks. Wallet addresses are fixtures.
 */
import assert from "node:assert/strict";
import http from "node:http";
import { after, describe, test } from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import { MAINNET_USDC_UNLOCK_CONTRACT } from "./embed-signature.mjs";

const DEAD = "0x000000000000000000000000000000000000dead";
const ALLOWED = "0x0000000000000000000000000000000000000001";
const READER = "0x0000000000000000000000000000000000000002";
const LOCAL_TEST_KEY = "0xac0974bec39a17e36ba4a6b4d4aad435cce0e4c9335790421507b8a191e28881";
const signer = privateKeyToAccount(LOCAL_TEST_KEY);
const HASH = `0x${"ab".repeat(32)}`;

const sbPosts = [];
const stripeHits = [];

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const supabase = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const raw = req.method === "GET" || req.method === "HEAD" ? "" : await readBody(req);
  if (req.method === "POST") {
    sbPosts.push({ path: url.pathname, body: raw ? JSON.parse(raw) : null });
  }
  res.setHeader("Content-Type", "application/json");
  if (url.pathname === "/rest/v1/articles" && req.method === "GET") {
    const slug = String(url.searchParams.get("article_id") || "");
    const publisher = slug.includes("blocked") ? DEAD : ALLOWED;
    res.end(
      JSON.stringify([
        {
          article_id: slug.replace(/^eq\./, ""),
          article_id_hash: HASH,
          publisher,
          price_wei: "500000",
          price_cents: 50,
          listing_status: "listed",
          payment_asset: "usdc",
          allow_a_la_carte: true,
        },
      ])
    );
    return;
  }
  if (url.pathname === "/rest/v1/fiat_unlocks" && req.method === "POST") {
    res.end(JSON.stringify([{ id: 41, session_token: "sess_fixture" }]));
    return;
  }
  res.end("[]");
});

const stripeMock = http.createServer(async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") await readBody(req);
  stripeHits.push(`${req.method} ${req.url}`);
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Request-Id", "req_fixture");
  res.end(JSON.stringify({ id: "cs_fixture", client_secret: "cs_secret", object: "checkout.session" }));
});

await new Promise((resolve) => supabase.listen(0, "127.0.0.1", resolve));
await new Promise((resolve) => stripeMock.listen(0, "127.0.0.1", resolve));
const sbPort = supabase.address().port;
const stripePort = stripeMock.address().port;

process.env.SUPABASE_URL = `http://127.0.0.1:${sbPort}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-role";
process.env.STRIPE_SECRET_KEY = "sk_test_fixture";
process.env.STRIPE_WEBHOOK_SECRET = "";
process.env.STRIPE_MOCK_BASE_URL = `http://127.0.0.1:${stripePort}`;
process.env.STRIPE_PLATFORM_FEE_BPS = "0";
process.env.BLOCKED_PUBLISHERS = `${DEAD}, ${signer.address}`;

const { createArticleCheckoutSession, createConnectOnboardingLink, grantFiatUnlockFromIntent } =
  await import("./stripe.mjs");
const { assertWriterMutationSignature, buildPlanAuthMessage } = await import(
  "./writer-mutation-auth.mjs"
);
const { publishArticleForAgent } = await import("./publish.mjs");
const { relayRegisterArticle } = await import("./relay-register.mjs");
const { createStripeSubscriptionCheckout } = await import("./subscriptions.mjs");

after(() => {
  supabase.close();
  stripeMock.close();
  delete process.env.BLOCKED_PUBLISHERS;
});

function intent(publisher, id) {
  return {
    id,
    status: "succeeded",
    amount: 500,
    amount_received: 500,
    currency: "usd",
    metadata: {
      product: "mon_unlock_fiat",
      articleId: "blocked-piece",
      articleIdHash: HASH,
      publisher,
      sessionToken: `sess_${id}`,
      amountUsdCents: "500",
    },
  };
}

describe("denylist gates", { concurrency: 1 }, () => {
test("a blocked publisher cannot authenticate a writer plan change", async () => {
  const issuedAt = new Date().toISOString();
  const message = buildPlanAuthMessage({
    publisher: signer.address,
    monthlyPriceCents: 500,
    allowALaCarte: true,
    issuedAt,
  });
  const signature = await signer.signMessage({ message });
  await assert.rejects(
    () =>
      assertWriterMutationSignature({
        publisher: signer.address,
        message,
        signature,
        issuedAt,
      }),
    (err) => err.status === 403 && err.message === "forbidden"
  );
});

test("an unlisted publisher with no signature is still unauthorized", async () => {
  await assert.rejects(
    () =>
      assertWriterMutationSignature({
        publisher: ALLOWED,
        message: "unused",
        signature: "",
        issuedAt: new Date().toISOString(),
      }),
    (err) => err.status === 401 && err.message === "unauthorized"
  );
});

test("card checkout refuses an article whose publisher is blocked and does not open a session", async () => {
  stripeHits.length = 0;
  await assert.rejects(
    () =>
      createArticleCheckoutSession({
        articleId: "blocked-piece",
        amountUsdCents: 50,
        title: "Fixture",
        returnUrl: "https://example.com/back?session_id={CHECKOUT_SESSION_ID}",
      }),
    (err) => err.status === 403 && err.message === "forbidden"
  );
  assert.equal(
    stripeHits.some((hit) => hit.includes("/v1/checkout/sessions")),
    false
  );
});

test("a succeeded card payment for a blocked publisher grants the unlock and skips the payout job", async () => {
  sbPosts.length = 0;
  const granted = await grantFiatUnlockFromIntent(intent(DEAD, "pi_blocked_fixture"));
  assert.equal(granted.granted, true);
  assert.equal(granted.already, false);
  assert.equal(
    sbPosts.some((row) => row.path === "/rest/v1/fiat_unlocks"),
    true
  );
  assert.equal(
    sbPosts.some((row) => row.path === "/rest/v1/payout_jobs"),
    false
  );
});

test("a succeeded card payment for an allowed publisher still queues a payout job", async () => {
  const previous = process.env.BLOCKED_PUBLISHERS;
  process.env.BLOCKED_PUBLISHERS = DEAD;
  sbPosts.length = 0;
  try {
    const granted = await grantFiatUnlockFromIntent(intent(ALLOWED, "pi_allowed_fixture"));
    assert.equal(granted.granted, true);
    const payout = sbPosts.find((row) => row.path === "/rest/v1/payout_jobs");
    assert.ok(payout);
    assert.equal(payout.body[0].publisher, ALLOWED);
    assert.equal(payout.body[0].status, "pending");
  } finally {
    process.env.BLOCKED_PUBLISHERS = previous;
  }
});

test("Connect onboarding refuses a blocked publisher before Stripe", async () => {
  stripeHits.length = 0;
  await assert.rejects(
    () =>
      createConnectOnboardingLink({
        publisher: DEAD,
        refreshUrl: "https://example.com/refresh",
        returnUrl: "https://example.com/return",
      }),
    (err) => err.status === 403 && err.message === "forbidden"
  );
  assert.equal(
    stripeHits.some((hit) => hit.includes("/v1/accounts")),
    false
  );
});

test("agent publish and relay register refuse a blocked publisher", async () => {
  await assert.rejects(
    () =>
      publishArticleForAgent({
        title: "Fixture",
        articleId: "fixture-piece",
        teaser: "Preview",
        body: "Body",
        publisher: `0x${DEAD.slice(2).toUpperCase()}`,
      }),
    (err) => err.status === 403 && err.message === "forbidden"
  );

  let verified = false;
  await assert.rejects(
    () =>
      relayRegisterArticle(
        {
          slug: "fixture-piece",
          publisher: DEAD,
          embedSig: "0xabc",
          priceWei: "500000",
          paymentAsset: "usdc",
          contract: MAINNET_USDC_UNLOCK_CONTRACT,
        },
        {},
        {
          configured: () => true,
          verifyEmbed: async () => {
            verified = true;
            return { ok: true };
          },
        }
      ),
    (err) => err.status === 403 && err.message === "forbidden"
  );
  assert.equal(verified, false);
});

test("a new writer subscription checkout refuses a blocked payee", async () => {
  await assert.rejects(
    () =>
      createStripeSubscriptionCheckout({
        reader: READER,
        writer: DEAD,
        successUrl: "https://example.com/ok",
        cancelUrl: "https://example.com/cancel",
      }),
    (err) => err.status === 403 && err.message === "forbidden"
  );
});
});
