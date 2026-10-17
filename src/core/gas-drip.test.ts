import assert from "node:assert/strict";
import { test } from "node:test";
import { gasDripFallbackCopy, gasDripNeedsCardFallback } from "./gas-drip.js";

test("capped or unavailable gas points the reader at card checkout", () => {
  assert.equal(gasDripNeedsCardFallback(429), true);
  assert.equal(gasDripNeedsCardFallback(503), true);
  assert.equal(gasDripNeedsCardFallback(401), false);
  assert.equal(gasDripNeedsCardFallback(403), false);
  assert.equal(gasDripNeedsCardFallback(200), false);
  assert.match(gasDripFallbackCopy(429), /used up for today/);
  assert.match(gasDripFallbackCopy(429), /Apple Pay, Google Pay, or card/);
  assert.match(gasDripFallbackCopy(503), /isn't available right now/);
  assert.match(gasDripFallbackCopy(503), /Apple Pay, Google Pay, or card/);
});
