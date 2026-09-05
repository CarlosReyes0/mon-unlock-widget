import assert from "node:assert/strict";
import { test } from "node:test";
import { publicPlan } from "./subscriptions.mjs";
import { DEFAULT_MONTHLY_CENTS } from "./access.mjs";

test("publicPlan treats a missing row as not offered", () => {
  const plan = publicPlan(null, "0x1111111111111111111111111111111111111111");
  assert.equal(plan.offered, false);
  assert.equal(plan.monthlyPriceCents, 0);
  assert.equal(plan.allowALaCarte, true);
});

test("publicPlan exposes a $5 monthly label", () => {
  const plan = publicPlan(
    {
      monthly_price_cents: 500,
      monthly_price_usdc: 5_000_000,
      allow_a_la_carte: true,
    },
    "0x1111111111111111111111111111111111111111"
  );
  assert.equal(plan.offered, true);
  assert.equal(plan.monthlyPriceCents, DEFAULT_MONTHLY_CENTS);
  assert.equal(plan.monthlyPriceLabel, "$5/mo");
  assert.equal(plan.allowALaCarte, true);
});

test("publicPlan can turn off à la carte", () => {
  const plan = publicPlan(
    { monthly_price_cents: 900, allow_a_la_carte: false },
    "0x1111111111111111111111111111111111111111"
  );
  assert.equal(plan.allowALaCarte, false);
  assert.equal(plan.monthlyPriceLabel, "$9/mo");
});
