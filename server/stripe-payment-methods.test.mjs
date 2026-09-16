import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkoutMethodVisibility,
  checkoutMethodVisibilityOrFallback,
  inactivePaymentMethodTypesFromConfig,
  sessionExcludedPaymentMethodTypes,
} from "./stripe-payment-methods.mjs";

const pmc = {
  id: "pmc_test",
  object: "payment_method_configuration",
  active: true,
  is_default: true,
  name: "Default",
  card: { available: true, display_preference: { value: "on" } },
  apple_pay: { available: true, display_preference: { value: "on" } },
  google_pay: { available: true, display_preference: { value: "on" } },
  link: { available: false, display_preference: { value: "off" } },
  amazon_pay: { available: false, display_preference: { value: "off" } },
  klarna: { available: false, display_preference: { value: "off" } },
  cashapp: { available: false, display_preference: { value: "off" } },
  us_bank_account: { available: false, display_preference: { value: "off" } },
  paypal: { available: false, display_preference: { value: "off" } },
};

test("inactivePaymentMethodTypesFromConfig lists methods Stripe has not activated", () => {
  const inactive = inactivePaymentMethodTypesFromConfig(pmc);
  assert.ok(inactive.includes("link"));
  assert.ok(inactive.includes("klarna"));
  assert.ok(inactive.includes("amazon_pay"));
  assert.ok(inactive.includes("cashapp"));
  assert.ok(inactive.includes("us_bank_account"));
  assert.equal(inactive.includes("card"), false);
  assert.equal(inactive.includes("apple_pay"), false);
});

test("session exclusions omit wallets and card, keep Payment Element types", () => {
  const excluded = sessionExcludedPaymentMethodTypes(
    inactivePaymentMethodTypesFromConfig(pmc)
  );
  assert.ok(excluded.includes("klarna"));
  assert.ok(excluded.includes("amazon_pay"));
  assert.ok(excluded.includes("cashapp"));
  assert.ok(excluded.includes("us_bank_account"));
  assert.equal(excluded.includes("card"), false);
  assert.equal(excluded.includes("link"), false);
  assert.equal(excluded.includes("apple_pay"), false);
});

test("checkoutMethodVisibility hides inactive Express Checkout wallets", () => {
  const vis = checkoutMethodVisibility(pmc);
  assert.equal(vis.expressPaymentMethods.applePay, "auto");
  assert.equal(vis.expressPaymentMethods.googlePay, "auto");
  assert.equal(vis.expressPaymentMethods.link, "never");
  assert.equal(vis.expressPaymentMethods.amazonPay, "never");
  assert.equal(vis.expressPaymentMethods.klarna, "never");
  assert.equal(vis.expressPaymentMethods.paypal, "never");
});

test("checkoutMethodVisibility with no config leaves Express Checkout on auto", () => {
  const vis = checkoutMethodVisibility(null);
  assert.deepEqual(vis.excludedPaymentMethodTypes, []);
  assert.equal(vis.expressPaymentMethods.link, "auto");
  assert.equal(vis.expressPaymentMethods.applePay, "auto");
});

test("fallback hides test-mode preview methods when Dashboard config is unread", () => {
  const vis = checkoutMethodVisibilityOrFallback(null);
  assert.equal(vis.expressPaymentMethods.link, "never");
  assert.equal(vis.expressPaymentMethods.amazonPay, "never");
  assert.equal(vis.expressPaymentMethods.klarna, "never");
  assert.ok(vis.excludedPaymentMethodTypes.includes("klarna"));
  assert.ok(vis.excludedPaymentMethodTypes.includes("amazon_pay"));
  assert.ok(vis.excludedPaymentMethodTypes.includes("cashapp"));
  assert.equal(vis.expressPaymentMethods.applePay, "auto");
  assert.equal(vis.expressPaymentMethods.googlePay, "auto");
});
