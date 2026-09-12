import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("account page is You + Get paid, wallet under Advanced", () => {
  const app = fs.readFileSync(path.join(ROOT, "src/publisher/PublisherApp.tsx"), "utf8");
  const auth = fs.readFileSync(path.join(ROOT, "src/publisher/PublisherAuth.tsx"), "utf8");
  assert.match(app, /Get paid/);
  assert.match(app, /Connect payments/);
  assert.match(app, /USDC is on/);
  assert.match(app, /<summary>Advanced<\/summary>/);
  assert.match(app, /Write a post/);
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
