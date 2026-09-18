import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ARTICLE_NFT_CHAIN_ID,
  MAX_EDITION_SUPPLY,
  cardUnlockNftCopy,
  clampEditionAmount,
  encodeMintCall,
  explorerTxUrl,
  isNftContractAddress,
} from "./article-nft.js";

describe("article-nft helpers", () => {
  it("validates contract addresses", () => {
    assert.equal(isNftContractAddress("0xd66Df017335ae80BcE5d4Ec728421f3a3DAf6f9f"), true);
    assert.equal(isNftContractAddress(""), false);
    assert.equal(isNftContractAddress("0x123"), false);
  });

  it("clamps edition size to a small supply", () => {
    assert.equal(clampEditionAmount(1), 1);
    assert.equal(clampEditionAmount(0), 1);
    assert.equal(clampEditionAmount(99), MAX_EDITION_SUPPLY);
    assert.equal(clampEditionAmount("5"), 5);
  });

  it("encodes mintEdition and mintReceipt without a private key", () => {
    const edition = encodeMintCall({ role: "edition", slug: "july-rain-walk", amount: 1 });
    const receipt = encodeMintCall({ role: "receipt", slug: "july-rain-walk" });
    assert.match(edition, /^0x[a-fA-F0-9]+$/);
    assert.match(receipt, /^0x[a-fA-F0-9]+$/);
    assert.notEqual(edition, receipt);
  });

  it("points explorers at Monad mainnet", () => {
    assert.equal(ARTICLE_NFT_CHAIN_ID, 143);
    assert.match(explorerTxUrl("0xabc"), /monadvision\.com\/tx\/0xabc/);
  });

  it("explains that card unlocks skip the receipt NFT", () => {
    assert.match(cardUnlockNftCopy(), /Apple Pay/);
    assert.match(cardUnlockNftCopy(), /no NFT needed to read/i);
  });
});
