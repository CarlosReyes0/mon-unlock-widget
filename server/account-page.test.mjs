import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("sign out stays clickable while wallet setup is busy", () => {
  const auth = fs.readFileSync(path.join(ROOT, "src/publisher/PublisherAuth.tsx"), "utf8");
  assert.match(auth, /Sign out/);
  assert.doesNotMatch(auth, /disabled=\{actionBusy\}[\s\S]{0,120}Sign out/);
  assert.doesNotMatch(auth, /Sign out[\s\S]{0,120}disabled=\{actionBusy\}/);
  assert.match(auth, /disabled=\{busy\}[\s\S]{0,80}Sign out/);
  assert.match(auth, /setWalletSetup\(false\)/);
});

test("account page is You + Get paid, no wallet address", () => {
  const app = fs.readFileSync(path.join(ROOT, "src/publisher/PublisherApp.tsx"), "utf8");
  const auth = fs.readFileSync(path.join(ROOT, "src/publisher/PublisherAuth.tsx"), "utf8");
  assert.match(app, /Get paid/);
  assert.match(app, /Connect payments/);
  assert.match(app, /then money goes to your bank/);
  assert.match(app, /goes to the wallet you are signed in with/);
  assert.doesNotMatch(app, /USDC wallet/);
  assert.doesNotMatch(app, /USDC is on/);
  assert.doesNotMatch(app, /Copy address/);
  assert.doesNotMatch(app, /<summary>Advanced<\/summary>/);
  assert.match(app, /href="\/write"/);
  assert.doesNotMatch(app, /Your writer plan/);
  assert.doesNotMatch(app, /Subscriptions you pay for/);
  assert.doesNotMatch(app, /Set up Stripe payouts/);
  assert.doesNotMatch(auth, /This wallet receives on-chain MON/);
  assert.match(auth, /Email or Google\. No password\./);
});

test("checkout offers USDC as a lower-fee alternative to card", () => {
  const checkout = fs.readFileSync(path.join(ROOT, "src/checkout/CheckoutApp.tsx"), "utf8");
  const crypto = fs.readFileSync(path.join(ROOT, "src/checkout/CryptoPaySection.tsx"), "utf8");
  assert.match(checkout, /USDC — lower fees/);
  assert.doesNotMatch(checkout, /Or pay with crypto/);
  assert.match(crypto, /Continue with email to pay USDC/);
  assert.doesNotMatch(crypto, /Continue with crypto/);
});

test("card checkout does not dump raw JSON parse errors", () => {
  const stripe = fs.readFileSync(path.join(ROOT, "src/checkout/StripeFiatPay.tsx"), "utf8");
  assert.match(stripe, /You can pay with USDC/);
  assert.match(stripe, /readApiJson/);
});

test("wallet and card confirms share checkoutConfirmOptions", () => {
  const stripe = fs.readFileSync(path.join(ROOT, "src/checkout/StripeFiatPay.tsx"), "utf8");
  const helper = fs.readFileSync(path.join(ROOT, "src/core/stripe-confirm.ts"), "utf8");
  assert.match(stripe, /checkoutConfirmOptions\(event\)/);
  assert.match(stripe, /onConfirm=\{\(event\) =>/);
  assert.match(stripe, /paymentFailed/);
  assert.match(helper, /expressCheckoutConfirmEvent/);
  assert.match(helper, /applePay/);
  assert.match(helper, /googlePay/);
  assert.match(helper, /link/);
  assert.match(helper, /amazonPay/);
  assert.match(helper, /klarna/);
  assert.match(stripe, /applePay: "never"/);
  assert.match(stripe, /expressPaymentMethods/);
  assert.doesNotMatch(stripe, /applePay: "always"/);
});
