/**
 * Writer card transfer amount. The fee is an input from the charge balance
 * transaction. These cases do not call Stripe.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { subscriptionSaleCents } from "./subscriptions.mjs";
import {
  MIN_STRIPE_TRANSFER_CENTS,
  settlementFromCharge,
  writerCardTransferCents,
} from "./stripe.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function charge({ amount, fee, net, currency = "usd", refunded = 0, fullyRefunded = false, disputed = false, balance = true }) {
  return {
    amount,
    currency,
    amount_refunded: refunded,
    refunded: fullyRefunded,
    disputed,
    balance_transaction: balance
      ? { amount, fee, net, currency, object: "balance_transaction" }
      : null,
  };
}

describe("writer card transfer amount", () => {
  test("uses the balance transaction fee, not a percentage estimate", () => {
    assert.equal(MIN_STRIPE_TRANSFER_CENTS, 1);
    const unusual = writerCardTransferCents({
      saleCents: 1000,
      feeCents: 1,
      platformNetCents: 999,
      chargeCents: 1000,
    });
    assert.equal(unusual.action, "transfer");
    assert.equal(unusual.transferCents, 999);
    assert.notEqual(unusual.transferCents, 941);
  });

  test("a 50 cent sale transfers the real net above the 1 cent transfer minimum", () => {
    const decision = writerCardTransferCents({
      saleCents: 50,
      feeCents: 31,
      platformNetCents: 19,
      chargeCents: 50,
    });
    assert.equal(decision.action, "transfer");
    assert.equal(decision.transferCents, 19);
    assert.equal(decision.feeCents, 31);
  });

  test("keeps collected tax on the platform", () => {
    const settlement = settlementFromCharge(
      charge({ amount: 1080, fee: 66, net: 1014 }),
      1000
    );
    assert.equal(settlement.action, "transfer");
    assert.equal(settlement.transferCents, 934);
    assert.equal(settlement.feeCents, 66);
    assert.ok(settlement.transferCents < 1014);
  });

  test("never transfers more than the platform net", () => {
    const decision = writerCardTransferCents({
      saleCents: 1000,
      feeCents: 59,
      platformNetCents: 100,
      chargeCents: 1000,
    });
    assert.equal(decision.transferCents, 100);
    const refunded = settlementFromCharge(
      charge({ amount: 1000, fee: 59, net: 941, refunded: 200 }),
      1000
    );
    assert.equal(refunded.transferCents, 741);
  });

  test("skips a non-positive net and a net under the transfer minimum", () => {
    const eaten = writerCardTransferCents({
      saleCents: 50,
      feeCents: 50,
      platformNetCents: 0,
      chargeCents: 50,
    });
    assert.equal(eaten.action, "skip");
    assert.equal(eaten.reason, "net_non_positive");
    assert.equal(eaten.netCents, 0);
    assert.equal(eaten.feeCents, 50);

    const negative = writerCardTransferCents({
      saleCents: 50,
      feeCents: 80,
      platformNetCents: -30,
      chargeCents: 50,
    });
    assert.equal(negative.action, "skip");
    assert.equal(negative.reason, "net_non_positive");
    assert.equal(negative.transferCents, 0);

    const small = writerCardTransferCents({
      saleCents: 100,
      feeCents: 90,
      platformNetCents: 10,
      chargeCents: 100,
      minimumCents: 50,
    });
    assert.equal(small.action, "skip");
    assert.equal(small.reason, "below_minimum_transfer");
    assert.equal(small.netCents, 10);
    assert.equal(small.transferCents, 10);
  });

  test("a refunded or disputed charge is not payable", () => {
    for (const flag of ["fullyRefunded", "disputed"]) {
      const settlement = settlementFromCharge(
        charge({ amount: 1000, fee: 59, net: 941, [flag]: true }),
        1000
      );
      assert.equal(settlement.action, "skip", flag);
      assert.equal(settlement.reason, "not_payable", flag);
      assert.equal(settlement.feeCents, 59, flag);
      assert.equal(settlement.netCents, 0, flag);
    }
  });

  test("a missing balance transaction stays unread, and a foreign currency is not converted", () => {
    const missing = settlementFromCharge(charge({ amount: 1000, fee: 59, net: 941, balance: false }), 1000);
    assert.equal(missing.ready, false);
    assert.equal(missing.reason, "processing_fee_unavailable");

    const foreign = settlementFromCharge(
      charge({ amount: 1000, fee: 59, net: 941, currency: "eur" }),
      1000,
      "usd"
    );
    assert.equal(foreign.action, "skip");
    assert.equal(foreign.reason, "fee_currency_mismatch");
    assert.equal(foreign.feeCents, null);
  });

  test("rejects amounts that are not integer cents", () => {
    const bad = writerCardTransferCents({
      saleCents: 10.5,
      feeCents: 1,
      platformNetCents: 9,
    });
    assert.equal(bad.ok, false);
    assert.equal(bad.reason, "invalid_amounts");
  });
});

describe("subscription sale before tax", () => {
  test("uses the pre-tax total when Stripe provides it", () => {
    assert.equal(
      subscriptionSaleCents({ total_excluding_tax: 500, subtotal: 500, amount_paid: 540, tax: 40 }),
      500
    );
    assert.equal(subscriptionSaleCents({ subtotal: 500, amount_paid: 540 }), 500);
    assert.equal(subscriptionSaleCents({ amount_paid: 540 }), 540);
    assert.equal(subscriptionSaleCents({ amount_due: 500 }), 500);
    assert.equal(subscriptionSaleCents({ total_excluding_tax: 0, amount_paid: 0 }), 0);
  });
});

test("processing fee migration is additive and does not touch payout rows", () => {
  const sql = fs.readFileSync(
    path.join(ROOT, "supabase/migrations/0019_payout_processing_fee.sql"),
    "utf8"
  );
  assert.match(sql, /NOT APPLIED to production/);
  assert.match(sql, /add column if not exists stripe_fee_cents/i);
  assert.match(sql, /add column if not exists net_cents/i);
  assert.match(sql, /stripe_fee_cents is null or stripe_fee_cents >= 0/);
  assert.match(sql, /net_cents is null or net_cents >= 0/);
  assert.doesNotMatch(sql, /update\s+public\.payout_jobs/i);
  assert.doesNotMatch(sql, /payouts\/retry|sk_live|whsec_|rk_live/);
});
