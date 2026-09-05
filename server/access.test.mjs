import assert from "node:assert/strict";
import { test } from "node:test";
import {
  centsToUsdcUnits,
  evaluateAccess,
  normalizeAddress,
  normalizeMonthlyCents,
  resolveAllowALaCarte,
  subscriptionIsLive,
} from "./access.mjs";

test("normalizeAddress accepts checksum and rejects junk", () => {
  assert.equal(
    normalizeAddress("0xAbcDef0123456789AbcDef0123456789AbcDef01"),
    "0xabcdef0123456789abcdef0123456789abcdef01"
  );
  assert.equal(normalizeAddress("not-an-address"), "");
  assert.equal(normalizeAddress(""), "");
});

test("purchase always opens the article, even if à la carte is off", () => {
  const got = evaluateAccess({
    purchased: true,
    subscriptionLive: false,
    allowALaCarte: false,
  });
  assert.deepEqual(got, { allowed: true, reason: "purchase", canPurchase: false });
});

test("live subscription opens without a purchase", () => {
  const got = evaluateAccess({
    purchased: false,
    subscriptionLive: true,
    allowALaCarte: true,
  });
  assert.deepEqual(got, { allowed: true, reason: "subscription", canPurchase: true });
});

test("subscribe-only writer hides the buy button when locked", () => {
  const got = evaluateAccess({
    purchased: false,
    subscriptionLive: false,
    allowALaCarte: false,
  });
  assert.deepEqual(got, { allowed: false, reason: "subscribe_only", canPurchase: false });
});

test("locked article can still be bought when à la carte is on", () => {
  const got = evaluateAccess({
    purchased: false,
    subscriptionLive: false,
    allowALaCarte: true,
  });
  assert.deepEqual(got, { allowed: false, reason: "locked", canPurchase: true });
});

test("subscriptionIsLive is false after cancel, even mid-period", () => {
  const now = new Date("2026-09-05T12:00:00Z");
  assert.equal(
    subscriptionIsLive(
      {
        status: "active",
        canceled_at: "2026-09-05T11:00:00Z",
        current_period_end: "2026-10-05T12:00:00Z",
      },
      now
    ),
    false
  );
  assert.equal(
    subscriptionIsLive(
      {
        status: "active",
        canceled_at: null,
        current_period_end: "2026-10-05T12:00:00Z",
      },
      now
    ),
    true
  );
  assert.equal(
    subscriptionIsLive(
      {
        status: "active",
        canceled_at: null,
        current_period_end: "2026-09-01T12:00:00Z",
      },
      now
    ),
    false
  );
});

test("article false overrides writer true for à la carte", () => {
  assert.equal(resolveAllowALaCarte({ articleAllow: false, writerAllow: true }), false);
  assert.equal(resolveAllowALaCarte({ articleAllow: true, writerAllow: false }), false);
  assert.equal(resolveAllowALaCarte({ articleAllow: null, writerAllow: true }), true);
});

test("cents map to USDC 6-decimal units", () => {
  assert.equal(normalizeMonthlyCents(500), 500);
  assert.equal(centsToUsdcUnits(500), 5_000_000);
  assert.equal(centsToUsdcUnits(50), 500_000);
});
