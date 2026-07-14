/**
 * Unit tests for fiat unlock unique-constraint / race handling.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { isUniqueViolation } from "./stripe.mjs";

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
