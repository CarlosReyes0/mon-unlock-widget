import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import { verifyMessage } from "viem";
import {
  A_LA_CARTE_AUTH_PREFIX,
  LISTING_AUTH_PREFIX,
  MON_UNLOCK_CONTRACT,
  PLAN_AUTH_PREFIX,
  PUBLISH_AUTH_PREFIX,
  USDC_UNLOCK_CONTRACT,
  allowedUnlockContracts,
  buildALaCarteAuthMessage,
  buildListingAuthMessage,
  buildPlanAuthMessage,
  buildPublishAuthMessage,
  canonicalPublishContent,
  isAllowedUnlockContract,
  requestHasSecret,
  secretsMatch,
  shouldApplyListing,
} from "./publish-auth.js";

const KEY = "0xac0974bec39a17e36ba4a6b4d4aad435cce0e4c9335790421507b8a191e28881" as const;
const account = privateKeyToAccount(KEY);

describe("secretsMatch", () => {
  it("accepts an exact secret and rejects empty or different values", () => {
    assert.equal(secretsMatch("abc", "abc"), true);
    assert.equal(secretsMatch(" abc ", "abc"), true);
    assert.equal(secretsMatch("abc", "abd"), false);
    assert.equal(secretsMatch("", "abc"), false);
    assert.equal(secretsMatch("abc", ""), false);
  });

  it("does not treat the public anon bearer as the indexer secret", () => {
    const headers = new Headers({
      authorization: "Bearer anon-jwt",
      "x-indexer-secret": "indexer-secret",
    });
    assert.equal(requestHasSecret(headers, "indexer-secret", "x-indexer-secret"), true);
    assert.equal(requestHasSecret(headers, "other", "x-indexer-secret"), false);
    assert.equal(requestHasSecret(headers, "", "x-indexer-secret"), false);
  });
});

describe("unlock contract allowlist", () => {
  it("accepts the Monad MON and USDC contracts and rejects caller-supplied addresses", () => {
    assert.equal(isAllowedUnlockContract(MON_UNLOCK_CONTRACT), true);
    assert.equal(isAllowedUnlockContract(USDC_UNLOCK_CONTRACT.toLowerCase()), true);
    assert.equal(isAllowedUnlockContract("0x0000000000000000000000000000000000000001"), false);
    assert.equal(isAllowedUnlockContract(""), false);
    const extra = allowedUnlockContracts(["0x1111111111111111111111111111111111111111"]);
    assert.equal(extra.length, 3);
    assert.equal(
      isAllowedUnlockContract("0x1111111111111111111111111111111111111111", [
        "0x1111111111111111111111111111111111111111",
      ]),
      true
    );
  });
});

describe("publish signature", () => {
  const fields = {
    slug: "july-rain",
    publisher: account.address,
    articleIdHash: "0x" + "ab".repeat(32),
    priceWei: "500000",
    paymentAsset: "usdc",
    title: "July rain",
    author: "Ada",
    teaser: "Preview",
    body: "Paid body",
    listOnOpenPaywall: true,
    externalUrl: null,
  };

  it("verifies a wallet signature and rejects a body swap", async () => {
    const message = await buildPublishAuthMessage(fields);
    assert.ok(message.startsWith(PUBLISH_AUTH_PREFIX));
    assert.match(message, /contract:0xd66df017335ae80bce5d4ec728421f3a3daf6f9f/);
    const signature = await account.signMessage({ message });
    assert.equal(
      await verifyMessage({ address: account.address, message, signature }),
      true
    );
    const tampered = await buildPublishAuthMessage({ ...fields, body: "Stolen" });
    assert.notEqual(tampered, message);
    assert.equal(
      await verifyMessage({ address: account.address, message: tampered, signature }),
      false
    );
  });

  it("uses the MON contract only when paymentAsset is mon", async () => {
    const message = await buildPublishAuthMessage({ ...fields, paymentAsset: "mon" });
    assert.match(message, new RegExp(`contract:${MON_UNLOCK_CONTRACT.toLowerCase()}`));
  });

  it("ignores confirm flags that are not part of the signed content", () => {
    const a = canonicalPublishContent(fields);
    const b = canonicalPublishContent({ ...fields, externalUrl: "" });
    assert.equal(a, b);
  });
});

describe("listing signature", () => {
  it("binds slug, publisher, and list flag", async () => {
    const message = buildListingAuthMessage({
      slug: "july-rain",
      publisher: account.address.toUpperCase(),
      listOnOpenPaywall: false,
      externalUrl: "https://example.com/post",
    });
    assert.ok(message.startsWith(LISTING_AUTH_PREFIX));
    assert.match(message, new RegExp(`publisher:${account.address.toLowerCase()}`));
    assert.match(message, /list:false/);
    const signature = await account.signMessage({ message });
    assert.equal(
      await verifyMessage({ address: account.address, message, signature }),
      true
    );
    const other = buildListingAuthMessage({
      slug: "july-rain",
      publisher: account.address,
      listOnOpenPaywall: true,
      externalUrl: "https://example.com/post",
    });
    assert.equal(
      await verifyMessage({ address: account.address, message: other, signature }),
      false
    );
  });

  it("appends priceCents only when the update sets a price", () => {
    const base = buildListingAuthMessage({
      slug: "july-rain",
      publisher: account.address,
      listOnOpenPaywall: true,
    });
    assert.doesNotMatch(base, /priceCents/);
    const priced = buildListingAuthMessage({
      slug: "july-rain",
      publisher: account.address,
      listOnOpenPaywall: true,
      priceCents: 100,
    });
    assert.match(priced, /priceCents:100/);
    assert.notEqual(priced, base);
  });
});

describe("plan signature", () => {
  it("binds publisher, price, and allow-a-la-carte so another change does not verify", async () => {
    const fields = {
      publisher: account.address.toUpperCase(),
      monthlyPriceCents: 500,
      allowALaCarte: false,
    };
    const message = buildPlanAuthMessage(fields);
    assert.ok(message.startsWith(PLAN_AUTH_PREFIX));
    assert.match(message, new RegExp(`publisher:${account.address.toLowerCase()}`));
    assert.match(message, /monthlyPriceCents:500/);
    assert.match(message, /allowALaCarte:false/);
    const signature = await account.signMessage({ message });
    assert.equal(
      await verifyMessage({ address: account.address, message, signature }),
      true
    );
    const otherPrice = buildPlanAuthMessage({ ...fields, monthlyPriceCents: 900 });
    const otherFlag = buildPlanAuthMessage({ ...fields, allowALaCarte: true });
    assert.equal(
      await verifyMessage({ address: account.address, message: otherPrice, signature }),
      false
    );
    assert.equal(
      await verifyMessage({ address: account.address, message: otherFlag, signature }),
      false
    );
  });
});

describe("a-la-carte signature", () => {
  it("binds article, publisher, and the flag being set", async () => {
    const fields = {
      articleId: "july-rain",
      publisher: account.address,
      allowALaCarte: false,
    };
    const message = buildALaCarteAuthMessage(fields);
    assert.ok(message.startsWith(A_LA_CARTE_AUTH_PREFIX));
    assert.match(message, /article:july-rain/);
    assert.match(message, /allowALaCarte:false/);
    const signature = await account.signMessage({ message });
    assert.equal(
      await verifyMessage({ address: account.address, message, signature }),
      true
    );
    const otherArticle = buildALaCarteAuthMessage({ ...fields, articleId: "other-piece" });
    const otherFlag = buildALaCarteAuthMessage({ ...fields, allowALaCarte: true });
    assert.equal(
      await verifyMessage({ address: account.address, message: otherArticle, signature }),
      false
    );
    assert.equal(
      await verifyMessage({ address: account.address, message: otherFlag, signature }),
      false
    );
  });
});

describe("shouldApplyListing", () => {
  it("defers listing until registration is confirmed", () => {
    assert.equal(
      shouldApplyListing({ confirmRegistered: false, priorStatus: "reserved", existingListingStatus: null }),
      false
    );
    assert.equal(shouldApplyListing({ confirmRegistered: true, priorStatus: "reserved" }), true);
    assert.equal(shouldApplyListing({ priorStatus: "registered" }), true);
    assert.equal(shouldApplyListing({ existingListingStatus: "listed" }), true);
    assert.equal(shouldApplyListing({ existingListingStatus: "unlisted", priorStatus: "reserved" }), false);
  });
});
