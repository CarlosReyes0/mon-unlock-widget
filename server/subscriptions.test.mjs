import assert from "node:assert/strict";
import { test } from "node:test";
import { publicPlan, writerSubscriptionCheckoutSessionParams } from "./subscriptions.mjs";
import { checkoutIntegrationId } from "./stripe.mjs";
import { DEFAULT_MONTHLY_CENTS } from "./access.mjs";

test("publicPlan treats a missing row as not offered", () => {
  const plan = publicPlan(null, "0x1111111111111111111111111111111111111111");
  assert.equal(plan.offered, false);
  assert.equal(plan.monthlyPriceCents, 0);
  assert.equal(plan.allowALaCarte, true);
});

test("publicPlan exposes a $5 monthly label", () => {
  const plan = publicPlan(
    {
      monthly_price_cents: 500,
      monthly_price_usdc: 5_000_000,
      allow_a_la_carte: true,
    },
    "0x1111111111111111111111111111111111111111"
  );
  assert.equal(plan.offered, true);
  assert.equal(plan.monthlyPriceCents, DEFAULT_MONTHLY_CENTS);
  assert.equal(plan.monthlyPriceLabel, "$5/mo");
  assert.equal(plan.allowALaCarte, true);
});

test("publicPlan can turn off à la carte", () => {
  const plan = publicPlan(
    { monthly_price_cents: 900, allow_a_la_carte: false },
    "0x1111111111111111111111111111111111111111"
  );
  assert.equal(plan.allowALaCarte, false);
  assert.equal(plan.monthlyPriceLabel, "$9/mo");
});

test("writer subscription Checkout enables automatic tax on the platform", () => {
  const params = writerSubscriptionCheckoutSessionParams({
    reader: "0x1111111111111111111111111111111111111111",
    writer: "0x2222222222222222222222222222222222222222",
    priceId: "price_test",
    successUrl: "https://example.com/ok",
    cancelUrl: "https://example.com/no",
    integrationId: "op_writer_sub_abcdefgh",
  });
  assert.deepEqual(params.automatic_tax, { enabled: true, liability: { type: "self" } });
  assert.equal(params.integration_identifier, "op_writer_sub_abcdefgh");
  assert.equal(params.mode, "subscription");
  assert.equal("billing_address_collection" in params, false);
  assert.equal("payment_method_types" in params, false);
});

test("writer subscription Checkout excludes inactive payment methods when provided", () => {
  const params = writerSubscriptionCheckoutSessionParams({
    reader: "0x1111111111111111111111111111111111111111",
    writer: "0x2222222222222222222222222222222222222222",
    priceId: "price_test",
    successUrl: "https://example.com/ok",
    cancelUrl: "https://example.com/no",
    integrationId: "op_writer_sub_abcdefgh",
    excludedPaymentMethodTypes: ["klarna", "cashapp"],
  });
  assert.deepEqual(params.excluded_payment_method_types, ["klarna", "cashapp"]);
  assert.equal("payment_method_types" in params, false);
});

test("checkoutIntegrationId uses a prefix plus 8 letters", () => {
  const id = checkoutIntegrationId("op_writer_sub");
  assert.match(id, /^op_writer_sub_[a-z]{8}$/);
});
