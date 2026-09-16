/**
 * Unit tests for the x402 adapter (no HTTP server, no mainnet).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BASE_USDC,
  usdToUsdcAtomic,
  usdcAtomicForListing,
  encodeJsonB64,
  decodeJsonB64OrJson,
  paymentPayloadMatchesRequirements,
  readPaymentHeader,
  buildPaymentRequirements,
  paymentRequiredBody,
} from "./x402.mjs";

test("usdToUsdcAtomic converts decimal USD to 6-dec atomic", () => {
  assert.equal(usdToUsdcAtomic("0.05"), "50000");
  assert.equal(usdToUsdcAtomic("0.50"), "500000");
  assert.equal(usdToUsdcAtomic("1"), "1000000");
});

test("usdcAtomicForListing uses price_wei for USDC listings", () => {
  assert.equal(usdcAtomicForListing("500000", "usdc"), "500000");
  assert.equal(usdcAtomicForListing("1000000", "USDC"), "1000000");
});

test("usdcAtomicForListing falls back for MON listings", () => {
  assert.equal(usdcAtomicForListing("1000000000000000000", "mon"), usdToUsdcAtomic("0.50"));
});

test("decodeJsonB64OrJson accepts raw JSON and base64", () => {
  const obj = { x402Version: 1, scheme: "exact" };
  assert.deepEqual(decodeJsonB64OrJson(JSON.stringify(obj)), obj);
  assert.deepEqual(decodeJsonB64OrJson(encodeJsonB64(obj)), obj);
  assert.equal(decodeJsonB64OrJson("%%%notb64%%%").invalid, true);
});

test("readPaymentHeader prefers X-PAYMENT then PAYMENT-SIGNATURE", () => {
  const payload = { x402Version: 1, network: "base" };
  const b64 = encodeJsonB64(payload);
  const missing = readPaymentHeader({ headers: {} });
  assert.equal(missing.missing, true);
  const v1 = readPaymentHeader({ headers: { "x-payment": b64 } });
  assert.deepEqual(v1.payload, payload);
  const v2 = readPaymentHeader({ headers: { "payment-signature": b64 } });
  assert.deepEqual(v2.payload, payload);
  const bad = readPaymentHeader({ headers: { "x-payment": "nope!!" } });
  assert.equal(bad.invalid, true);
});

test("paymentPayloadMatchesRequirements fail-closes on wrong chain, recipient, amount", () => {
  const payTo = "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0";
  const reqs = {
    scheme: "exact",
    network: "base",
    maxAmountRequired: "50000",
    payTo,
    asset: BASE_USDC,
  };
  const base = {
    x402Version: 1,
    scheme: "exact",
    network: "base",
    payload: {
      authorization: {
        from: "0x1111111111111111111111111111111111111111",
        to: payTo,
        value: "50000",
        nonce: "0x1",
      },
    },
  };
  assert.equal(paymentPayloadMatchesRequirements(base, reqs).ok, true);

  const monad = structuredClone(base);
  monad.network = "monad";
  assert.equal(paymentPayloadMatchesRequirements(monad, reqs).reason, "unsupported_network");

  const wrongTo = structuredClone(base);
  wrongTo.payload.authorization.to = "0x0000000000000000000000000000000000000001";
  assert.equal(paymentPayloadMatchesRequirements(wrongTo, reqs).reason, "wrong_recipient");

  const low = structuredClone(base);
  low.payload.authorization.value = "1";
  assert.equal(paymentPayloadMatchesRequirements(low, reqs).reason, "insufficient_amount");

  const malformed = paymentPayloadMatchesRequirements({ invalid: true }, reqs);
  assert.equal(malformed.ok, false);
});

test("buildPaymentRequirements uses Base USDC", () => {
  const prev = process.env.X402_PAY_TO;
  process.env.X402_PAY_TO = "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0";
  try {
    const reqs = buildPaymentRequirements({
      resource: "https://example.test/api/x402/publish",
      description: "test",
      amountAtomic: "50000",
    });
    assert.equal(reqs.asset, BASE_USDC);
    assert.equal(reqs.network, "base");
    assert.equal(reqs.payTo.toLowerCase(), process.env.X402_PAY_TO.toLowerCase());
  } finally {
    if (prev == null) delete process.env.X402_PAY_TO;
    else process.env.X402_PAY_TO = prev;
  }
});

test("paymentRequiredBody is machine-readable x402 v1", () => {
  const body = paymentRequiredBody({
    accepts: [{ scheme: "exact", network: "base" }],
    error: "X-PAYMENT header is required",
  });
  assert.equal(body.x402Version, 1);
  assert.ok(Array.isArray(body.accepts));
  assert.match(body.error, /X-PAYMENT/);
});
