import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatUsdc, MONAD_USDC, WMON, MON_USDC_FEE } from "./swap-usdc-to-mon.js";

describe("formatUsdc", () => {
  it("formats 6-decimal amounts", () => {
    assert.equal(formatUsdc(1_500_000n), "1.50");
    assert.equal(formatUsdc(1n), "0.00");
    assert.equal(formatUsdc(1_000_000n), "1.00");
  });
});

describe("monad swap constants", () => {
  it("uses Circle USDC and WMON on Monad", () => {
    assert.equal(MONAD_USDC.toLowerCase(), "0x754704bc059f8c67012fed69bc8a327a5aafb603");
    assert.equal(WMON.toLowerCase(), "0x3bd359c1119da7da1d913d1c4d2b7c461115433a");
    assert.equal(MON_USDC_FEE, 500);
  });
});
