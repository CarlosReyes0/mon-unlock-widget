import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_ARTICLE_PRICE_CENTS,
  MIN_ARTICLE_PRICE_CENTS,
  cardNetCents,
  formatUsdFromCents,
  needsHighPriceConfirm,
  parseArticlePriceCents,
  parseUsdToCents,
  priceNetLine,
  readLastPublishedPriceCents,
  usdcAtomicForCents,
  writeLastPublishedPriceCents,
} from "./article-price.js";

describe("article price", () => {
  it("rejects amounts under the $0.50 Stripe minimum", () => {
    assert.equal(MIN_ARTICLE_PRICE_CENTS, 50);
    assert.deepEqual(parseArticlePriceCents(49), { ok: false, error: "price_below_minimum" });
    assert.deepEqual(parseArticlePriceCents("49"), { ok: false, error: "price_below_minimum" });
    assert.deepEqual(parseArticlePriceCents(0), { ok: false, error: "price_below_minimum" });
    assert.deepEqual(parseArticlePriceCents("0.50"), { ok: false, error: "invalid_price" });
    assert.deepEqual(parseArticlePriceCents(50.5), { ok: false, error: "invalid_price" });
    assert.deepEqual(parseArticlePriceCents(50), { ok: true, cents: 50 });
    assert.deepEqual(parseArticlePriceCents("250000"), { ok: true, cents: 250000 });
  });

  it("parses a USD field into cents", () => {
    assert.equal(parseUsdToCents("0.50"), 50);
    assert.equal(parseUsdToCents("$0.5"), 50);
    assert.equal(parseUsdToCents("1"), 100);
    assert.equal(parseUsdToCents("25"), 2500);
    assert.equal(parseUsdToCents("25.01"), 2501);
    assert.equal(parseUsdToCents("0.499"), null);
    assert.equal(parseUsdToCents("-1"), null);
    assert.equal(parseUsdToCents(""), null);
  });

  it("estimates card net and leaves USDC at the price", () => {
    assert.equal(cardNetCents(50), 19);
    assert.equal(priceNetLine(50), "Card: you get ~$0.19 · USDC: ~$0.50");
    assert.equal(formatUsdFromCents(100), "$1.00");
    assert.equal(usdcAtomicForCents(50), 500_000n);
    assert.equal(usdcAtomicForCents(250), 2_500_000n);
  });

  it("asks before a price above $25 and not at $25", () => {
    assert.equal(needsHighPriceConfirm(2500), false);
    assert.equal(needsHighPriceConfirm(2501), true);
  });

  it("defaults to the last published price, else $0.50", () => {
    const saved = new Map<string, string>();
    const storage = {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => {
        saved.set(key, value);
      },
    };
    assert.equal(readLastPublishedPriceCents(storage), DEFAULT_ARTICLE_PRICE_CENTS);
    writeLastPublishedPriceCents(storage, 200);
    assert.equal(readLastPublishedPriceCents(storage), 200);
    writeLastPublishedPriceCents(storage, 10);
    assert.equal(readLastPublishedPriceCents(storage), 200);
  });
});
