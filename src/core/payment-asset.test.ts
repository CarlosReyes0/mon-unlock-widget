import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAINNET_MON_UNLOCK_CONTRACT,
  MAINNET_USDC_UNLOCK_CONTRACT,
  isUsdcUnlockConfigured,
  normalizePaymentAsset,
  paymentAssetForContract,
  resolvePaymentAsset,
} from "./payment-asset.js";
import { formatUsd, parseUsdAmount } from "./types.js";

describe("payment-asset", () => {
  it("normalizes usdc aliases", () => {
    assert.equal(normalizePaymentAsset("USDC"), "usdc");
    assert.equal(normalizePaymentAsset("usd"), "usdc");
    assert.equal(normalizePaymentAsset("mon"), "mon");
    assert.equal(normalizePaymentAsset(""), "mon");
  });

  it("treats mainnet USDC unlock as configured", () => {
    assert.equal(isUsdcUnlockConfigured(), true);
    assert.match(MAINNET_USDC_UNLOCK_CONTRACT, /^0x[a-fA-F0-9]{40}$/);
    assert.equal(paymentAssetForContract(MAINNET_USDC_UNLOCK_CONTRACT), "usdc");
  });

  it("defaults unknown contracts to mon (path A)", () => {
    assert.equal(paymentAssetForContract(MAINNET_MON_UNLOCK_CONTRACT), "mon");
    assert.equal(
      paymentAssetForContract("0x0000000000000000000000000000000000000001"),
      "mon"
    );
  });

  it("prefers explicit asset over contract", () => {
    assert.equal(
      resolvePaymentAsset({
        explicit: "usdc",
        contract: MAINNET_MON_UNLOCK_CONTRACT,
      }),
      "usdc"
    );
  });
});

describe("usd amounts", () => {
  it("parses and formats 6-decimal USDC", () => {
    assert.equal(parseUsdAmount("0.50"), 500000n);
    assert.equal(parseUsdAmount("1"), 1000000n);
    assert.equal(formatUsd(500000n), "0.50");
  });
});
