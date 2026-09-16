import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EXPRESS_CHECKOUT_METHODS,
  checkoutConfirmOptions,
  confirmUsesExpressEvent,
  expressCheckoutPaymentMethods,
} from "./stripe-confirm.js";

describe("checkoutConfirmOptions", () => {
  it("passes the Express Checkout event for wallet buttons", () => {
    const event = { expressPaymentType: "google_pay" };
    assert.deepEqual(checkoutConfirmOptions(event), {
      redirect: "if_required",
      expressCheckoutConfirmEvent: event,
    });
  });

  it("omits the event for the card Payment Element Pay button", () => {
    assert.deepEqual(checkoutConfirmOptions(), { redirect: "if_required" });
    assert.deepEqual(checkoutConfirmOptions(undefined), { redirect: "if_required" });
  });
});

describe("confirmUsesExpressEvent", () => {
  it("requires the event for every Express Checkout wallet", () => {
    for (const method of EXPRESS_CHECKOUT_METHODS) {
      assert.equal(confirmUsesExpressEvent(method), true, method);
    }
  });

  it("does not require the event for card", () => {
    assert.equal(confirmUsesExpressEvent("card"), false);
  });
});

describe("expressCheckoutPaymentMethods", () => {
  it("hides wallets that are not active and never shows PayPal", () => {
    assert.deepEqual(expressCheckoutPaymentMethods(["link", "amazon_pay", "klarna", "cashapp"]), {
      applePay: "auto",
      googlePay: "auto",
      link: "never",
      paypal: "never",
      amazonPay: "never",
      klarna: "never",
    });
  });

  it("hides Apple Pay and Google Pay when those methods are off", () => {
    const methods = expressCheckoutPaymentMethods(["apple_pay", "google_pay"]);
    assert.equal(methods.applePay, "never");
    assert.equal(methods.googlePay, "never");
    assert.equal(methods.link, "auto");
  });
});
