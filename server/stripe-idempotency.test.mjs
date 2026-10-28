/**
 * Unit tests for fiat unlock unique-constraint / race handling.
 * Connect webhook delivery uses the same grant path (see stripe-connect-webhook.test.mjs).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { directChargesEnabled, isUniqueViolation } from "./stripe.mjs";

test("isUniqueViolation detects Postgres 23505 from PostgREST details", () => {
  const err = new Error(
    'duplicate key value violates unique constraint "fiat_unlocks_session_token_key"'
  );
  err.details = {
    code: "23505",
    message: 'duplicate key value violates unique constraint "fiat_unlocks_session_token_key"',
  };
  assert.equal(isUniqueViolation(err), true);
});

test("isUniqueViolation detects duplicate key message without code", () => {
  const err = new Error(
    'duplicate key value violates unique constraint "fiat_unlocks_stripe_payment_intent_id_key"'
  );
  assert.equal(isUniqueViolation(err), true);
});

test("isUniqueViolation returns false for unrelated errors", () => {
  assert.equal(isUniqueViolation(new Error("fiat_unlock_insert_failed")), false);
  assert.equal(isUniqueViolation(null), false);
  assert.equal(isUniqueViolation({ message: "supabase_502" }), false);
});

test("direct charges default off and the connect webhook reuses the unique grant", () => {
  assert.equal(directChargesEnabled({}), false);
  assert.equal(directChargesEnabled({ STRIPE_CONNECT_DIRECT_CHARGES: "false" }), false);
  assert.equal(directChargesEnabled({ STRIPE_CONNECT_DIRECT_CHARGES: " true " }), true);
  const src = fs.readFileSync(new URL("./stripe.mjs", import.meta.url), "utf8");
  assert.match(src, /function handleStripeConnectWebhook|export async function handleStripeConnectWebhook/);
  assert.match(src, /isUniqueViolation\(e\)/);
  assert.match(src, /connectModel === CONNECT_MODEL_DIRECT/);
  const index = fs.readFileSync(new URL("./index.mjs", import.meta.url), "utf8");
  assert.match(index, /\/api\/stripe\/connect-webhook/);
});
