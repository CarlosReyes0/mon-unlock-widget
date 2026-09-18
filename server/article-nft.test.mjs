import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ARTICLE_NFT_CHAIN_ID,
  articleNftConfigured,
  buildTokenMetadata,
  getNftConfig,
  metadataHasPaidBody,
  parseMetadataPath,
  parseRecordBody,
  recordMint,
  roleFromOnchain,
} from "./article-nft.mjs";

test("parseMetadataPath only matches /api/article-nfts/metadata/{id}", () => {
  assert.equal(parseMetadataPath("/api/article-nfts/metadata/12"), "12");
  assert.equal(parseMetadataPath("/api/article-nfts/metadata/12/"), "12");
  assert.equal(parseMetadataPath("/api/article-nfts/metadata/abc"), null);
  assert.equal(parseMetadataPath("/api/article-nfts/config"), null);
  assert.equal(parseMetadataPath("/api/articles/demo/download"), null);
});

test("buildTokenMetadata never includes paid body", () => {
  const meta = buildTokenMetadata({
    slug: "july-rain-walk",
    role: "edition",
    title: "July rain",
    teaser: "A free preview.",
    body: "SECRET PAID BODY SHOULD NOT APPEAR",
    paid_body: "nope",
    articleBody: "nope",
    priceLabel: "$0.50 USDC",
    origin: "https://example.test",
  });
  assert.equal(meta.name, "July rain — Writer edition");
  assert.equal(meta.description, "A free preview.");
  assert.equal(meta.external_url, "https://example.test/articles/july-rain-walk");
  assert.match(meta.image, /\/og\/july-rain-walk\.jpg/);
  assert.deepEqual(
    meta.attributes.find((a) => a.trait_type === "role"),
    { trait_type: "role", value: "edition" }
  );
  assert.deepEqual(
    meta.attributes.find((a) => a.trait_type === "articleSlug"),
    { trait_type: "articleSlug", value: "july-rain-walk" }
  );
  assert.deepEqual(
    meta.attributes.find((a) => a.trait_type === "price"),
    { trait_type: "price", value: "$0.50 USDC" }
  );
  assert.equal(metadataHasPaidBody(meta), false);
  assert.equal("body" in meta, false);
  assert.doesNotMatch(JSON.stringify(meta), /SECRET PAID BODY/);
});

test("receipt metadata uses the article URL not the unlock contract", () => {
  const meta = buildTokenMetadata({
    slug: "july-rain-walk",
    role: "receipt",
    title: "July rain",
    origin: "https://example.test",
  });
  assert.match(meta.name, /Unlock receipt/);
  assert.match(meta.description, /Not required to read/);
  assert.equal(meta.external_url, "https://example.test/articles/july-rain-walk");
});

test("roleFromOnchain maps 0/1", () => {
  assert.equal(roleFromOnchain(0), "edition");
  assert.equal(roleFromOnchain(1n), "receipt");
});

test("parseRecordBody requires slug, role, minter, tokenId", () => {
  const parsed = parseRecordBody({
    slug: "july-rain-walk",
    role: "edition",
    minter: "0x1111111111111111111111111111111111111111",
    tokenId: "3",
    txHash: "0x" + "ab".repeat(32),
  });
  assert.equal(parsed.slug, "july-rain-walk");
  assert.equal(parsed.role, "edition");
  assert.equal(parsed.tokenId, "3");
  assert.throws(() => parseRecordBody({ role: "edition", minter: "0x11", tokenId: "1" }));
  assert.throws(() =>
    parseRecordBody({
      slug: "x",
      role: "gate",
      minter: "0x1111111111111111111111111111111111111111",
      tokenId: "1",
    })
  );
});

test("getNftConfig reports unconfigured without ARTICLE_NFT_CONTRACT", () => {
  const prev = process.env.ARTICLE_NFT_CONTRACT;
  delete process.env.ARTICLE_NFT_CONTRACT;
  delete process.env.VITE_ARTICLE_NFT_CONTRACT;
  try {
    assert.equal(articleNftConfigured(), false);
    const cfg = getNftConfig();
    assert.equal(cfg.configured, false);
    assert.equal(cfg.chainId, ARTICLE_NFT_CHAIN_ID);
    assert.equal(cfg.mintAuth, "user-wallet");
    assert.match(cfg.note, /No server private key/);
  } finally {
    if (prev) process.env.ARTICLE_NFT_CONTRACT = prev;
  }
});

test("recordMint without a contract is nft_not_configured", async () => {
  const prev = process.env.ARTICLE_NFT_CONTRACT;
  delete process.env.ARTICLE_NFT_CONTRACT;
  delete process.env.VITE_ARTICLE_NFT_CONTRACT;
  try {
    await assert.rejects(
      () =>
        recordMint({
          slug: "july-rain-walk",
          role: "receipt",
          minter: "0x1111111111111111111111111111111111111111",
          tokenId: "1",
        }),
      /nft_not_configured/
    );
  } finally {
    if (prev) process.env.ARTICLE_NFT_CONTRACT = prev;
  }
});

test("recordMint persists when on-chain verify is skipped (CI, no mainnet mint)", async () => {
  const prev = process.env.ARTICLE_NFT_CONTRACT;
  process.env.ARTICLE_NFT_CONTRACT = "0x2222222222222222222222222222222222222222";
  try {
    const result = await recordMint(
      {
        slug: "july-rain-walk",
        role: "edition",
        minter: "0x1111111111111111111111111111111111111111",
        tokenId: "9",
        txHash: "0x" + "cd".repeat(32),
      },
      { verifyOnchain: false }
    );
    assert.equal(result.recorded, false);
    assert.equal(result.reason, "supabase_not_configured");
    assert.equal(result.tokenId, "9");
  } finally {
    if (prev) process.env.ARTICLE_NFT_CONTRACT = prev;
    else delete process.env.ARTICLE_NFT_CONTRACT;
  }
});
