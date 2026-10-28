import assert from "node:assert/strict";
import { test } from "node:test";
import {
  articleUnlockCheckoutSessionParams,
  checkoutIntegrationId,
  directChargeApplicationFeeCents,
  directChargeAutomaticTax,
} from "./stripe.mjs";

test("article unlock Checkout enables automatic tax and omits payment_method_types", () => {
  const params = articleUnlockCheckoutSessionParams({
    articleId: "founder-manifesto",
    title: "Why Every Founder",
    amountUsdCents: 500,
    sessionToken: "tok_test",
    publisher: "0x5594d76928c4974ae77387882cf9099c375e307b",
    hash: "0xabc",
    returnUrl: "https://example.com/unlock.html?session_id={CHECKOUT_SESSION_ID}",
    integrationId: "op_article_unlock_abcdefgh",
  });
  assert.equal(params.ui_mode, "elements");
  assert.equal(params.mode, "payment");
  assert.deepEqual(params.automatic_tax, { enabled: true, liability: { type: "self" } });
  assert.equal(params.integration_identifier, "op_article_unlock_abcdefgh");
  assert.equal(params.line_items[0].price_data.tax_behavior, "exclusive");
  assert.equal(params.line_items[0].price_data.unit_amount, 500);
  assert.equal(params.metadata.amountUsdCents, "500");
  assert.equal(params.metadata.product, "mon_unlock_fiat");
  assert.equal("billing_address_collection" in params, false);
  assert.equal("payment_method_types" in params, false);
});

test("article unlock Checkout excludes inactive payment methods when provided", () => {
  const params = articleUnlockCheckoutSessionParams({
    articleId: "founder-manifesto",
    title: "Why Every Founder",
    amountUsdCents: 500,
    sessionToken: "tok_test",
    publisher: "0x5594d76928c4974ae77387882cf9099c375e307b",
    hash: "0xabc",
    returnUrl: "https://example.com/unlock.html?session_id={CHECKOUT_SESSION_ID}",
    integrationId: "op_article_unlock_abcdefgh",
    excludedPaymentMethodTypes: ["klarna", "amazon_pay", "cashapp"],
  });
  assert.deepEqual(params.excluded_payment_method_types, ["klarna", "amazon_pay", "cashapp"]);
  assert.equal("payment_method_types" in params, false);
});

test("direct-charge article Checkout omits the platform fee and does not pick a tax party", () => {
  const params = articleUnlockCheckoutSessionParams({
    articleId: "founder-manifesto",
    title: "Why Every Founder",
    amountUsdCents: 500,
    sessionToken: "tok_test",
    publisher: "0x5594d76928c4974ae77387882cf9099c375e307b",
    hash: "0xabc",
    returnUrl: "https://example.com/unlock.html?session_id={CHECKOUT_SESSION_ID}",
    integrationId: "op_article_unlock_abcdefgh",
    directCharge: true,
  });
  assert.equal(params.metadata.connectModel, "direct");
  assert.equal(params.payment_intent_data.metadata.connectModel, "direct");
  assert.equal("application_fee_amount" in params.payment_intent_data, false);
  assert.equal(directChargeApplicationFeeCents(500), 0);
  assert.deepEqual(params.automatic_tax, { enabled: true });
  assert.equal("liability" in params.automatic_tax, false);
  assert.equal(params.line_items[0].price_data.unit_amount, 500);
  assert.equal("payment_method_types" in params, false);
  const previous = process.env.STRIPE_DIRECT_TAX_LIABILITY;
  process.env.STRIPE_DIRECT_TAX_LIABILITY = "account";
  try {
    assert.deepEqual(directChargeAutomaticTax(), { enabled: true, liability: { type: "self" } });
    process.env.STRIPE_DIRECT_TAX_LIABILITY = "platform";
    assert.deepEqual(directChargeAutomaticTax(), {
      enabled: true,
      liability: { type: "application" },
    });
  } finally {
    if (previous == null) delete process.env.STRIPE_DIRECT_TAX_LIABILITY;
    else process.env.STRIPE_DIRECT_TAX_LIABILITY = previous;
  }
});

test("checkoutIntegrationId for article unlocks is prefixed", () => {
  assert.match(checkoutIntegrationId("op_article_unlock"), /^op_article_unlock_[a-z]{8}$/);
});
