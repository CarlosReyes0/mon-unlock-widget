import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { OG_DESCRIPTION_MAX, OG_IMAGE_HEIGHT, OG_IMAGE_WIDTH } from "./article-og.mjs";
import {
  DEFAULT_OG_PRICE_LABEL,
  defaultOgJpegBuffer,
  formatOgPriceLabel,
  getArticleOgJpeg,
  isSafeOgSlug,
  jpegDimensions,
  parseOgImagePath,
  renderOgJpeg,
} from "./og-card.mjs";

test("formatOgPriceLabel prefers two-decimal USDC and falls back to $0.50 USDC", () => {
  assert.equal(formatOgPriceLabel({ priceWei: "500000", paymentAsset: "usdc" }), "$0.50 USDC");
  assert.equal(formatOgPriceLabel({ priceWei: "1000000", paymentAsset: "usdc" }), "$1.00 USDC");
  assert.equal(formatOgPriceLabel({ priceWei: "1000000000000000000", paymentAsset: "mon" }), "1 MON");
  assert.equal(formatOgPriceLabel({}), DEFAULT_OG_PRICE_LABEL);
});

test("parseOgImagePath only accepts /og/{slug}.jpg", () => {
  assert.equal(parseOgImagePath("/og/the-quote-was-a-trap.jpg"), "the-quote-was-a-trap");
  assert.equal(parseOgImagePath("/og/hello.jpeg"), "hello");
  assert.equal(parseOgImagePath("/og/../secret.jpg"), null);
  assert.equal(parseOgImagePath("/og/%2e%2e.jpg"), null);
  assert.equal(parseOgImagePath("/assets/og-default.jpg"), null);
  assert.equal(isSafeOgSlug("ok-slug_1"), true);
  assert.equal(isSafeOgSlug("not/a/slug"), false);
});

test("jpegDimensions reads SOF from a baseline JPEG", () => {
  const dim = jpegDimensions(defaultOgJpegBuffer());
  assert.deepEqual(dim, { width: OG_IMAGE_WIDTH, height: OG_IMAGE_HEIGHT });
});

test("renderOgJpeg produces a 1200x630 JPEG and differs by article title", async () => {
  const prev = process.env.OG_CACHE_DIR;
  process.env.OG_CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "og-card-test-"));
  try {
    const a = await renderOgJpeg({
      title: "The Quote Was a Trap",
      teaser: "Explore how Uniswap v4 hooks can be used to intercept quotes and protect users from MEV and bad routing.",
      priceWei: "500000",
      paymentAsset: "usdc",
    });
    const b = await renderOgJpeg({
      title: "A Different Essay Entirely",
      teaser: "Another preview so the share card is not identical.",
      priceWei: "500000",
      paymentAsset: "usdc",
    });
    assert.equal(a[0], 0xff);
    assert.equal(a[1], 0xd8);
    assert.deepEqual(jpegDimensions(a), { width: 1200, height: 630 });
    assert.deepEqual(jpegDimensions(b), { width: 1200, height: 630 });
    assert.notEqual(a.equals(b), true);
    assert.ok(a.length > 20_000);
    assert.ok(a.length < 1_500_000);
  } finally {
    if (prev === undefined) delete process.env.OG_CACHE_DIR;
    else process.env.OG_CACHE_DIR = prev;
  }
});

test("getArticleOgJpeg falls back to the default card when the listing is missing", async () => {
  const buf = await getArticleOgJpeg("missing-slug", {
    loadArticle: async () => {
      const err = new Error("not_found");
      err.status = 404;
      throw err;
    },
  });
  assert.equal(buf.equals(defaultOgJpegBuffer()), true);
  assert.deepEqual(jpegDimensions(buf), { width: 1200, height: 630 });
});

test("getArticleOgJpeg generates a per-article card when a listing exists", async () => {
  const prev = process.env.OG_CACHE_DIR;
  process.env.OG_CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "og-card-list-"));
  try {
    const buf = await getArticleOgJpeg("the-quote-was-a-trap", {
      loadArticle: async () => ({
        title: "The Quote Was a Trap",
        teaser: "A short free preview everyone can read.",
        priceWei: "500000",
        paymentAsset: "usdc",
      }),
    });
    assert.equal(buf[0], 0xff);
    assert.notEqual(buf.equals(defaultOgJpegBuffer()), true);
    assert.deepEqual(jpegDimensions(buf), { width: 1200, height: 630 });
  } finally {
    if (prev === undefined) delete process.env.OG_CACHE_DIR;
    else process.env.OG_CACHE_DIR = prev;
  }
});

test("OG description cap is 120–125 characters", () => {
  assert.equal(OG_DESCRIPTION_MAX, 125);
});
