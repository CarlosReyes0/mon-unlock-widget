import assert from "node:assert/strict";
import { test, beforeEach } from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import { keccak256, toBytes } from "viem";
import { buildEmbedSignMessage, MAINNET_USDC_UNLOCK_CONTRACT } from "./embed-signature.mjs";
import {
  articleIdFromSlug,
  parseRelayRequest,
  relayRegisterArticle,
  resetRelayRateLimits,
  takeRateLimitToken,
} from "./relay-register.mjs";

const PUBLISHER_KEY =
  "0xac0974bec39a17e36ba4a6b4d4aad435cce0e4c9335790421507b8a191e28881";
const publisher = privateKeyToAccount(PUBLISHER_KEY);
const SLUG = "july-rain-walk";
const PRICE = 500_000n;
const CONTRACT = MAINNET_USDC_UNLOCK_CONTRACT.toLowerCase();
const HASH = keccak256(toBytes(SLUG));

async function signEmbed() {
  const message = buildEmbedSignMessage({
    chainId: 143,
    contract: CONTRACT,
    articleId: SLUG,
    priceWei: PRICE,
  });
  return publisher.signMessage({ message });
}

function reservation(overrides = {}) {
  return {
    article_id: SLUG,
    article_id_hash: HASH,
    publisher: publisher.address.toLowerCase(),
    price_wei: PRICE.toString(),
    registration_status: "reserved",
    ...overrides,
  };
}

beforeEach(() => {
  resetRelayRateLimits();
});

test("articleIdFromSlug matches widget keccak256(bytes(slug))", () => {
  assert.equal(articleIdFromSlug(SLUG), HASH);
});

test("parseRelayRequest fills USDC contract and checks hash", () => {
  const parsed = parseRelayRequest({
    slug: SLUG,
    articleIdHash: HASH,
    priceWei: PRICE.toString(),
    publisher: publisher.address,
    embedSig: "0xsig",
    paymentAsset: "usdc",
  });
  assert.equal(parsed.contract, CONTRACT);
  assert.equal(parsed.articleIdHash, HASH);
  assert.equal(parsed.priceWei, PRICE);
});

test("parseRelayRequest rejects hash mismatch", () => {
  assert.throws(
    () =>
      parseRelayRequest({
        slug: SLUG,
        articleIdHash: keccak256(toBytes("other-slug")),
        priceWei: "1",
        publisher: publisher.address,
        embedSig: "0xsig",
        paymentAsset: "usdc",
      }),
    /hash_mismatch/
  );
});

test("parseRelayRequest rejects unknown contracts", () => {
  assert.throws(
    () =>
      parseRelayRequest({
        slug: SLUG,
        articleIdHash: HASH,
        priceWei: "1",
        publisher: publisher.address,
        embedSig: "0xsig",
        contract: "0x0000000000000000000000000000000000000001",
      }),
    /unsupported_contract/
  );
});

test("takeRateLimitToken blocks after the cap", () => {
  assert.equal(takeRateLimitToken("k", 2, 60_000, 1), true);
  assert.equal(takeRateLimitToken("k", 2, 60_000, 1), true);
  assert.equal(takeRateLimitToken("k", 2, 60_000, 1), false);
  assert.equal(takeRateLimitToken("k", 2, 60_000, 70_000), true);
});

test("relayRegisterArticle 503s when the relayer key is missing", async () => {
  await assert.rejects(
    () =>
      relayRegisterArticle(
        {},
        {},
        { configured: () => false }
      ),
    (err) => err.status === 503 && err.message === "relayer_not_configured" && err.fallback === true
  );
});

test("relayRegisterArticle registers via owner after a valid embed signature", async () => {
  const embedSig = await signEmbed();
  const submitted = [];
  const confirmed = [];
  const result = await relayRegisterArticle(
    {
      slug: SLUG,
      articleIdHash: HASH,
      priceWei: PRICE.toString(),
      publisher: publisher.address,
      embedSig,
      paymentAsset: "usdc",
      contract: CONTRACT,
    },
    { ip: "1.1.1.1" },
    {
      configured: () => true,
      lookupReservation: async () => reservation(),
      getOnchainArticle: async () => ({
        publisher: "0x0000000000000000000000000000000000000000",
        priceWei: 0n,
        active: false,
      }),
      submitRegisterArticleFor: async (args) => {
        submitted.push(args);
        return "0xabc";
      },
      confirmRegistered: async (row) => {
        confirmed.push(row);
      },
    }
  );
  assert.equal(result.ok, true);
  assert.equal(result.relayer, true);
  assert.equal(result.txHash, "0xabc");
  assert.equal(result.alreadyRegistered, false);
  assert.equal(submitted.length, 1);
  assert.equal(submitted[0].publisher, publisher.address.toLowerCase());
  assert.equal(submitted[0].priceWei, PRICE);
  assert.equal(confirmed[0].embedSig, embedSig);
});

test("relayRegisterArticle is idempotent when already registered to the writer", async () => {
  const embedSig = await signEmbed();
  let submitted = 0;
  const result = await relayRegisterArticle(
    {
      slug: SLUG,
      articleIdHash: HASH,
      priceWei: PRICE.toString(),
      publisher: publisher.address,
      embedSig,
      paymentAsset: "usdc",
    },
    { ip: "2.2.2.2" },
    {
      configured: () => true,
      lookupReservation: async () => reservation(),
      getOnchainArticle: async () => ({
        publisher: publisher.address.toLowerCase(),
        priceWei: PRICE,
        active: true,
      }),
      submitRegisterArticleFor: async () => {
        submitted += 1;
        return "0xshould-not-send";
      },
      confirmRegistered: async () => {},
    }
  );
  assert.equal(result.alreadyRegistered, true);
  assert.equal(result.txHash, null);
  assert.equal(submitted, 0);
});

test("relayRegisterArticle rejects a signature from a different wallet", async () => {
  const embedSig = await signEmbed();
  await assert.rejects(
    () =>
      relayRegisterArticle(
        {
          slug: SLUG,
          articleIdHash: HASH,
          priceWei: PRICE.toString(),
          publisher: "0x0000000000000000000000000000000000000001",
          embedSig,
          paymentAsset: "usdc",
        },
        { ip: "3.3.3.3" },
        { configured: () => true }
      ),
    (err) => err.status === 403 || err.message === "invalid_embed_sig"
  );
});

test("relayRegisterArticle requires a reserved slug owned by the signer", async () => {
  const embedSig = await signEmbed();
  await assert.rejects(
    () =>
      relayRegisterArticle(
        {
          slug: SLUG,
          articleIdHash: HASH,
          priceWei: PRICE.toString(),
          publisher: publisher.address,
          embedSig,
          paymentAsset: "usdc",
        },
        { ip: "4.4.4.4" },
        {
          configured: () => true,
          lookupReservation: async () => null,
        }
      ),
    (err) => err.status === 403 && err.message === "reservation_required"
  );
});

test("relayRegisterArticle 409s when another publisher reserved the slug", async () => {
  const embedSig = await signEmbed();
  await assert.rejects(
    () =>
      relayRegisterArticle(
        {
          slug: SLUG,
          articleIdHash: HASH,
          priceWei: PRICE.toString(),
          publisher: publisher.address,
          embedSig,
          paymentAsset: "usdc",
        },
        { ip: "5.5.5.5" },
        {
          configured: () => true,
          lookupReservation: async () =>
            reservation({ publisher: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }),
        }
      ),
    (err) => err.status === 409 && err.message === "slug_taken"
  );
});
