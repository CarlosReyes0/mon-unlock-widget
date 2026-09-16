import assert from "node:assert/strict";
import { test } from "node:test";
import { articleUnlockCheckoutSessionParams, checkoutIntegrationId } from "./stripe.mjs";

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

test("checkoutIntegrationId for article unlocks is prefixed", () => {
  assert.match(checkoutIntegrationId("op_article_unlock"), /^op_article_unlock_[a-z]{8}$/);
});
