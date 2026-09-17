import assert from "node:assert/strict";
import { test } from "node:test";
import {
  explorerTokenUrl,
  nftChainId,
  nftConfigured,
  nftFromRow,
  nftPublicStatus,
  openseaTokenUrl,
  parseNftArticlePath,
  parseNftTokenPath,
  recordArticleMint,
  tokenMetadata,
} from "./article-nft.mjs";

test("parseNftTokenPath only matches /api/nft/{tokenId}", () => {
  assert.equal(parseNftTokenPath("/api/nft/1"), "1");
  assert.equal(parseNftTokenPath("/api/nft/42/"), "42");
  assert.equal(parseNftTokenPath("/api/nft/health"), null);
  assert.equal(parseNftTokenPath("/api/nft/0xabc"), null);
  assert.equal(parseNftTokenPath("/api/articles/hello/nft"), null);
});

test("parseNftArticlePath reads /api/articles/{slug}/nft", () => {
  assert.equal(parseNftArticlePath("/api/articles/july-rain/nft"), "july-rain");
  assert.equal(parseNftArticlePath("/api/articles/hello%20world/nft"), "hello world");
  assert.equal(parseNftArticlePath("/api/articles/july-rain"), null);
  assert.equal(parseNftArticlePath("/api/articles/july-rain/download"), null);
});

test("nftFromRow is null without a token, never a read gate", () => {
  assert.equal(nftFromRow(null), null);
  assert.equal(nftFromRow({ listing_status: "listed", article_id: "x" }), null);
  const nft = nftFromRow({
    nft_token_id: "7",
    nft_contract: "0x1111111111111111111111111111111111111111",
    nft_chain_id: 8453,
    nft_tx_hash: "0x" + "ab".repeat(32),
    nft_owner: "0xABC",
    nft_minted_at: "2026-09-17T00:00:00.000Z",
  });
  assert.equal(nft.tokenId, "7");
  assert.equal(nft.contract, "0x1111111111111111111111111111111111111111");
  assert.match(nft.explorerUrl, /basescan\.org\/token\//);
  assert.match(nft.openseaUrl, /opensea\.io\/assets\/base\//);
});

test("tokenMetadata uses title, teaser, article URL, and OG image", () => {
  const meta = tokenMetadata({
    origin: "https://host.example",
    tokenId: "3",
    article: {
      slug: "the-quote-was-a-trap",
      title: "The Quote Was a Trap",
      teaser: "A short free preview everyone can read.",
      priceWei: "500000",
      paymentAsset: "usdc",
      body: "SECRET PAID TEXT",
    },
  });
  assert.equal(meta.name, "The Quote Was a Trap");
  assert.match(meta.description, /short free preview/);
  assert.equal(meta.external_url, "https://host.example/articles/the-quote-was-a-trap");
  assert.equal(meta.image, "https://host.example/og/the-quote-was-a-trap.jpg");
  assert.equal(
    meta.attributes.find((a) => a.trait_type === "Price")?.value,
    "$0.5 USDC"
  );
  assert.equal(meta.attributes.find((a) => a.trait_type === "Edition")?.value, "1/1");
  assert.match(
    String(meta.attributes.find((a) => a.trait_type === "Access")?.value || ""),
    /not required to read/i
  );
  assert.ok(!("body" in meta));
  assert.doesNotMatch(JSON.stringify(meta), /SECRET PAID TEXT/);
});

test("explorer URLs distinguish Base mainnet and Sepolia", () => {
  const main = {
    chainId: 8453,
    contract: "0x2222222222222222222222222222222222222222",
    tokenId: "1",
  };
  const sepolia = { ...main, chainId: 84532 };
  assert.match(explorerTokenUrl(main), /^https:\/\/basescan\.org\//);
  assert.match(explorerTokenUrl(sepolia), /^https:\/\/sepolia\.basescan\.org\//);
  assert.match(openseaTokenUrl(main), /opensea\.io\/assets\/base\//);
  assert.match(openseaTokenUrl(sepolia), /testnets\.opensea\.io\/assets\/base-sepolia\//);
});

test("nftPublicStatus is unconfigured without ARTICLE_NFT_CONTRACT", () => {
  const prev = process.env.ARTICLE_NFT_CONTRACT;
  delete process.env.ARTICLE_NFT_CONTRACT;
  try {
    assert.equal(nftConfigured(), false);
    assert.equal(nftChainId(), 8453);
    const status = nftPublicStatus();
    assert.equal(status.ok, true);
    assert.equal(status.configured, false);
    assert.equal(status.contract, null);
    assert.equal(status.unlockSeparate, true);
    assert.match(status.message, /ARTICLE_NFT_CONTRACT/);
  } finally {
    if (prev == null) delete process.env.ARTICLE_NFT_CONTRACT;
    else process.env.ARTICLE_NFT_CONTRACT = prev;
  }
});

test("recordArticleMint validates publisher and token before supabase", async () => {
  await assert.rejects(() => recordArticleMint({}), (err) => err.message === "missing_slug");
  await assert.rejects(
    () => recordArticleMint({ slug: "hello", publisher: "not-an-address", tokenId: "1" }),
    (err) => err.message === "invalid_publisher"
  );
  await assert.rejects(
    () =>
      recordArticleMint({
        slug: "hello",
        publisher: "0x1111111111111111111111111111111111111111",
        tokenId: "0",
      }),
    (err) => err.message === "invalid_token"
  );
  const prev = process.env.ARTICLE_NFT_CONTRACT;
  delete process.env.ARTICLE_NFT_CONTRACT;
  try {
    await assert.rejects(
      () =>
        recordArticleMint({
          slug: "hello",
          publisher: "0x1111111111111111111111111111111111111111",
          tokenId: "1",
        }),
      (err) => err.message === "nft_not_configured" && err.status === 503
    );
  } finally {
    if (prev == null) delete process.env.ARTICLE_NFT_CONTRACT;
    else process.env.ARTICLE_NFT_CONTRACT = prev;
  }
});

test("recordArticleMint rejects a contract that does not match env", async () => {
  const prev = process.env.ARTICLE_NFT_CONTRACT;
  process.env.ARTICLE_NFT_CONTRACT = "0x1111111111111111111111111111111111111111";
  try {
    await assert.rejects(
      () =>
        recordArticleMint({
          slug: "hello",
          publisher: "0x1111111111111111111111111111111111111111",
          tokenId: "1",
          contract: "0x2222222222222222222222222222222222222222",
        }),
      (err) => err.message === "contract_mismatch"
    );
  } finally {
    if (prev == null) delete process.env.ARTICLE_NFT_CONTRACT;
    else process.env.ARTICLE_NFT_CONTRACT = prev;
  }
});
