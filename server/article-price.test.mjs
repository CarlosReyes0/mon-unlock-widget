import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { resolveUnlockChargeCents } from "./article-price.mjs";
import { usdcAtomicForListing } from "./x402.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("checkout uses price_cents when present and refuses a stored price over $1,000", () => {
  const stored = resolveUnlockChargeCents({ price_cents: 250 }, 50);
  assert.deepEqual(stored, { ok: true, cents: 250, source: "price_cents" });
  assert.deepEqual(resolveUnlockChargeCents({ price_cents: 100_000 }, 50), {
    ok: true,
    cents: 100_000,
    source: "price_cents",
  });
  assert.deepEqual(resolveUnlockChargeCents({ price_cents: 100_001 }, 50), {
    ok: false,
    error: "amount_too_large",
  });
  assert.deepEqual(resolveUnlockChargeCents({ price_cents: 250000 }, 50), {
    ok: false,
    error: "amount_too_large",
  });
  assert.equal(usdcAtomicForListing("500000", "usdc", 250), "2500000");
  assert.equal(usdcAtomicForListing("1000000000", "usdc", 100_000), "1000000000");
  assert.equal(usdcAtomicForListing("1000010000", "usdc", 100_001), null);
  assert.equal(usdcAtomicForListing("1000010000", "usdc"), null);
  assert.equal(usdcAtomicForListing("1000000000", "usdc"), "1000000000");
});

test("checkout rejects a stored price under $0.50 and still validates a missing one", () => {
  assert.deepEqual(resolveUnlockChargeCents({ price_cents: 49 }, 50), {
    ok: false,
    error: "invalid_amount",
  });
  assert.deepEqual(resolveUnlockChargeCents({}, 49), { ok: false, error: "invalid_amount" });
  assert.deepEqual(resolveUnlockChargeCents({}, 50), { ok: true, cents: 50, source: "request" });
  assert.deepEqual(resolveUnlockChargeCents({}, 100_000), {
    ok: true,
    cents: 100_000,
    source: "request",
  });
  assert.deepEqual(resolveUnlockChargeCents({}, 100_001), {
    ok: false,
    error: "amount_too_large",
  });
  assert.deepEqual(
    resolveUnlockChargeCents({ payment_asset: "usdc", price_wei: "1000010000" }, 50),
    { ok: false, error: "amount_too_large" }
  );
  assert.deepEqual(
    resolveUnlockChargeCents({ payment_asset: "usdc", price_wei: "1000000000" }, 50),
    { ok: true, cents: 50, source: "request" }
  );
  assert.deepEqual(
    resolveUnlockChargeCents(
      { payment_asset: "mon", price_wei: "1000000000000000000000", price_cents: 100 },
      50
    ),
    { ok: true, cents: 100, source: "price_cents" }
  );
  assert.equal(usdcAtomicForListing("500000", "usdc"), "500000");
});

test("register and update-listing enforce the $0.50 minimum and the $1,000 cap on price_cents", () => {
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
  assert.match(register, /price_above_maximum/);
  assert.match(register, /usdcAtomicAboveCap/);
  assert.match(listing, /parseArticlePriceCents/);
  assert.match(listing, /price_cents/);
  assert.match(listing, /articlePriceErrorMessage/);
  const form = fs.readFileSync(path.join(ROOT, "src/publisher/ArticlePriceForm.tsx"), "utf8");
  const maxAt = form.indexOf("MAX_ARTICLE_PRICE_CENTS");
  const confirmAt = form.indexOf("needsHighPriceConfirm");
  assert.ok(maxAt > 0 && confirmAt > maxAt);
  assert.match(form, /PRICE_ABOVE_MAXIMUM_MESSAGE/);
  const shared = fs.readFileSync(path.join(ROOT, "src/core/article-price.ts"), "utf8");
  assert.match(shared, /Maximum is \$1,000\.00\./);
  assert.match(shared, /MAX_ARTICLE_PRICE_CENTS = 100_000/);
  const publishPost = fs.readFileSync(path.join(ROOT, "src/publisher/publish-post.ts"), "utf8");
  assert.match(publishPost, /articlePriceErrorMessage/);
  const migration = fs.readFileSync(
    path.join(ROOT, "supabase/migrations/20261028140000_article_price_cents_max.sql"),
    "utf8"
  );
  assert.match(migration, /price_cents <= 100000/);
  assert.match(migration, /not valid/i);
  assert.match(migration, /not rewritten/i);
  assert.doesNotMatch(listing, /from\('unlocks'\)\.delete|from\("unlocks"\)\.delete/);
  assert.match(stripe, /resolveUnlockChargeCents/);
  assert.match(stripe, /price_cents/);
});
