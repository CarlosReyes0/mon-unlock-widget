import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { truncateAddress } from "./wallet.js";

describe("truncateAddress", () => {
  it("does not throw for null/undefined (fiat unlocks have no wallet)", () => {
    assert.equal(truncateAddress(null), "Wallet");
    assert.equal(truncateAddress(undefined), "Wallet");
    assert.equal(truncateAddress(""), "Wallet");
  });

  it("truncates a normal address", () => {
    assert.equal(
      truncateAddress("0x1234567890abcdef1234567890abcdef12345678"),
      "0x1234…5678"
    );
  });
});
