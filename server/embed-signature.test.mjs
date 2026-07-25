import assert from "node:assert/strict";
import { test } from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import {
  MAINNET_UNLOCK_CONTRACT,
  assertFiatEmbedAuthorized,
  buildEmbedSignMessage,
} from "./embed-signature.mjs";

const GOLDEN = {
  chainId: 143,
  contract: MAINNET_UNLOCK_CONTRACT,
  articleId: "golden-fiat-article",
  priceWei: 1_000_000_000_000_000_000n,
  privateKey:
    "0xac0974bec39a17e36ba4a6b4d4aad435cce0e4c9335790421507b8a191e28881",
};

const account = privateKeyToAccount(GOLDEN.privateKey);

test("assertFiatEmbedAuthorized accepts a valid publisher signature", async () => {
  const message = buildEmbedSignMessage(GOLDEN);
  const embedSig = await account.signMessage({ message });
  const result = await assertFiatEmbedAuthorized({
    embedSig,
    contract: GOLDEN.contract,
    articleId: GOLDEN.articleId,
    priceWei: GOLDEN.priceWei,
    publisher: account.address,
  });
  assert.equal(result.ok, true);
});

test("assertFiatEmbedAuthorized rejects missing signature", async () => {
  const result = await assertFiatEmbedAuthorized({
    embedSig: "",
    contract: GOLDEN.contract,
    articleId: GOLDEN.articleId,
    priceWei: GOLDEN.priceWei,
    publisher: account.address,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "missing_embed_sig");
});

test("assertFiatEmbedAuthorized rejects tampered article id", async () => {
  const message = buildEmbedSignMessage(GOLDEN);
  const embedSig = await account.signMessage({ message });
  const result = await assertFiatEmbedAuthorized({
    embedSig,
    contract: GOLDEN.contract,
    articleId: "other-article",
    priceWei: GOLDEN.priceWei,
    publisher: account.address,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "invalid_embed_sig");
});

test("assertFiatEmbedAuthorized rejects wrong contract", async () => {
  const message = buildEmbedSignMessage(GOLDEN);
  const embedSig = await account.signMessage({ message });
  const result = await assertFiatEmbedAuthorized({
    embedSig,
    contract: "0x0000000000000000000000000000000000000001",
    articleId: GOLDEN.articleId,
    priceWei: GOLDEN.priceWei,
    publisher: account.address,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "unsupported_contract");
});
