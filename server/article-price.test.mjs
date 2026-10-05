import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { resolveUnlockChargeCents } from "./article-price.mjs";
import { usdcAtomicForListing } from "./x402.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("checkout uses price_cents when present, including above the old client cap", () => {
  const stored = resolveUnlockChargeCents({ price_cents: 250 }, 50);
  assert.deepEqual(stored, { ok: true, cents: 250, source: "price_cents" });
  const high = resolveUnlockChargeCents({ price_cents: 250000 }, 50);
  assert.equal(high.ok && high.cents, 250000);
  assert.equal(usdcAtomicForListing("500000", "usdc", 250), "2500000");
});

test("checkout rejects a stored price under $0.50 and still validates a missing one", () => {
  assert.deepEqual(resolveUnlockChargeCents({ price_cents: 49 }, 50), {
    ok: false,
    error: "invalid_amount",
  });
  assert.deepEqual(resolveUnlockChargeCents({}, 49), { ok: false, error: "invalid_amount" });
  assert.deepEqual(resolveUnlockChargeCents({}, 50), { ok: true, cents: 50, source: "request" });
  assert.deepEqual(resolveUnlockChargeCents({}, 100_001), {
    ok: false,
    error: "amount_too_large",
  });
  assert.equal(usdcAtomicForListing("500000", "usdc"), "500000");
});

test("register and update-listing enforce the $0.50 minimum on price_cents", () => {
  const register = fs.readFileSync(
    path.join(ROOT, "supabase/functions/register-article/index.ts"),
    "utf8"
  );
  const listing = fs.readFileSync(
    path.join(ROOT, "supabase/functions/update-listing/index.ts"),
    "utf8"
  );
  const stripe = fs.readFileSync(path.join(ROOT, "server/stripe.mjs"), "utf8");
  assert.match(register, /parseArticlePriceCents/);
  assert.match(register, /price_cents/);
  assert.match(register, /price_mismatch/);
  assert.match(listing, /parseArticlePriceCents/);
  assert.match(listing, /price_cents/);
  assert.doesNotMatch(listing, /from\('unlocks'\)\.delete|from\("unlocks"\)\.delete/);
  assert.match(stripe, /resolveUnlockChargeCents/);
  assert.match(stripe, /price_cents/);
});
