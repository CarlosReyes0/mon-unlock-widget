import assert from "node:assert/strict";
import { test } from "node:test";
import {
  COINBASE_MIN_USD,
  PAY_BASE,
  buildPayUrl,
  normalizeOnrampAsset,
  resolveOnrampPreset,
} from "./coinbase-onramp.mjs";

test("normalizeOnrampAsset defaults to USDC and maps MON aliases", () => {
  assert.equal(normalizeOnrampAsset(undefined), "USDC");
  assert.equal(normalizeOnrampAsset("usdc"), "USDC");
  assert.equal(normalizeOnrampAsset("MON"), "MON");
  assert.equal(normalizeOnrampAsset("monad_mon"), "MON");
  assert.equal(normalizeOnrampAsset("MONAD"), "MON");
});

test("resolveOnrampPreset uses fiat and floors to Coinbase's ~$1 minimum", () => {
  assert.deepEqual(resolveOnrampPreset({ amount: "0.05", asset: "MON" }), {
    presetFiatAmount: String(COINBASE_MIN_USD),
  });
  assert.deepEqual(resolveOnrampPreset({ amount: "0.50", asset: "USDC" }), {
    presetFiatAmount: String(COINBASE_MIN_USD),
  });
  assert.deepEqual(resolveOnrampPreset({ amount: "5", asset: "USDC" }), {
    presetFiatAmount: "5",
  });
  assert.equal(resolveOnrampPreset({}).presetFiatAmount, String(COINBASE_MIN_USD));
});

test("buildPayUrl is a one-click USDC buy, not the Monad asset picker", () => {
  const url = buildPayUrl("tok_test", {
    asset: "USDC",
    amount: "0.50",
    redirectUrl: "https://example.com/unlock",
  });
  const parsed = new URL(url);
  assert.equal(`${parsed.origin}${parsed.pathname}`, PAY_BASE);
  assert.equal(parsed.searchParams.get("defaultAsset"), "USDC");
  assert.equal(parsed.searchParams.get("defaultNetwork"), "monad");
  assert.equal(parsed.searchParams.get("presetFiatAmount"), "1");
  assert.equal(parsed.searchParams.get("presetCryptoAmount"), null);
  assert.equal(parsed.searchParams.get("sessionToken"), "tok_test");
  assert.doesNotMatch(url, /select-asset/);
});

test("buildPayUrl does not emit a 0.05 MON crypto preset", () => {
  const url = buildPayUrl("tok_gas", { asset: "MON", amount: "0.05" });
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get("defaultAsset"), "MON");
  assert.equal(parsed.searchParams.get("presetFiatAmount"), "1");
  assert.equal(parsed.searchParams.get("presetCryptoAmount"), null);
});
