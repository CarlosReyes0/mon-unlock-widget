import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import {
  EMBED_SIG_PREFIX,
  MAINNET_UNLOCK_CONTRACT,
  buildEmbedSignMessage,
  verifyEmbedSignature,
} from "./embed-signature.js";

const GOLDEN = {
  chainId: 143,
  contract: MAINNET_UNLOCK_CONTRACT,
  articleId: "golden-test-article",
  priceWei: 1_000_000_000_000_000_000n,
  privateKey:
    "0xac0974bec39a17e36ba4a6b4d4aad435cce0e4c9335790421507b8a191e28881" as const,
};

const goldenAccount = privateKeyToAccount(GOLDEN.privateKey);

describe("buildEmbedSignMessage", () => {
  it("uses a stable multiline format", () => {
    const message = buildEmbedSignMessage(GOLDEN);
    assert.equal(
      message,
      `${EMBED_SIG_PREFIX}\nchain:143\ncontract:${MAINNET_UNLOCK_CONTRACT.toLowerCase()}\narticle:golden-test-article\npriceWei:1000000000000000000`
    );
  });
});

describe("verifyEmbedSignature", () => {
  it("accepts a valid publisher signature", async () => {
    const message = buildEmbedSignMessage(GOLDEN);
    const signature = await goldenAccount.signMessage({ message });

    const valid = await verifyEmbedSignature({
      signature,
      chainId: GOLDEN.chainId,
      contract: GOLDEN.contract,
      articleId: GOLDEN.articleId,
      priceWei: GOLDEN.priceWei,
      publisher: goldenAccount.address,
    });

    assert.equal(valid, true);
  });

  it("rejects a tampered contract", async () => {
    const message = buildEmbedSignMessage(GOLDEN);
    const signature = await goldenAccount.signMessage({ message });

    const valid = await verifyEmbedSignature({
      signature,
      chainId: GOLDEN.chainId,
      contract: "0x0000000000000000000000000000000000000001",
      articleId: GOLDEN.articleId,
      priceWei: GOLDEN.priceWei,
      publisher: goldenAccount.address,
    });

    assert.equal(valid, false);
  });

  it("rejects a tampered article id", async () => {
    const message = buildEmbedSignMessage(GOLDEN);
    const signature = await goldenAccount.signMessage({ message });

    const valid = await verifyEmbedSignature({
      signature,
      chainId: GOLDEN.chainId,
      contract: GOLDEN.contract,
      articleId: "other-article",
      priceWei: GOLDEN.priceWei,
      publisher: goldenAccount.address,
    });

    assert.equal(valid, false);
  });

  it("rejects a tampered price", async () => {
    const message = buildEmbedSignMessage(GOLDEN);
    const signature = await goldenAccount.signMessage({ message });

    const valid = await verifyEmbedSignature({
      signature,
      chainId: GOLDEN.chainId,
      contract: GOLDEN.contract,
      articleId: GOLDEN.articleId,
      priceWei: 2_000_000_000_000_000_000n,
      publisher: goldenAccount.address,
    });

    assert.equal(valid, false);
  });

  it("rejects a signature from the wrong wallet", async () => {
    const message = buildEmbedSignMessage(GOLDEN);
    const signature = await goldenAccount.signMessage({ message });

    const valid = await verifyEmbedSignature({
      signature,
      chainId: GOLDEN.chainId,
      contract: GOLDEN.contract,
      articleId: GOLDEN.articleId,
      priceWei: GOLDEN.priceWei,
      publisher: "0x0000000000000000000000000000000000000002",
    });

    assert.equal(valid, false);
  });
});
