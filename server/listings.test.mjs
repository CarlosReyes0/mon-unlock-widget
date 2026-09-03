import assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalizeExternalUrl,
  resolveListingUpdate,
  toPublicListing,
  formatPriceLabel,
  isListingStatus,
} from "./listings.mjs";

test("normalizeExternalUrl accepts https and clears empty", () => {
  assert.deepEqual(normalizeExternalUrl(""), { ok: true, url: null });
  assert.deepEqual(normalizeExternalUrl("  "), { ok: true, url: null });
  const ok = normalizeExternalUrl("https://maya.blog/post");
  assert.equal(ok.ok, true);
  assert.equal(ok.url, "https://maya.blog/post");
});

test("normalizeExternalUrl rejects non-http schemes", () => {
  assert.equal(normalizeExternalUrl("javascript:alert(1)").ok, false);
  assert.equal(normalizeExternalUrl("ftp://x").ok, false);
  assert.equal(normalizeExternalUrl("not a url").ok, false);
});

test("resolveListingUpdate auto-lists and stamps listed_at", () => {
  const now = new Date("2026-09-03T12:00:00.000Z");
  const r = resolveListingUpdate({
    currentStatus: "unlisted",
    listOn: true,
    externalUrl: "https://example.com/a",
    now,
  });
  assert.equal(r.ok, true);
  assert.equal(r.listing_status, "listed");
  assert.equal(r.listed_at, now.toISOString());
  assert.equal(r.external_url, "https://example.com/a");
});

test("resolveListingUpdate keeps listed_at when already listed", () => {
  const r = resolveListingUpdate({
    currentStatus: "listed",
    listOn: true,
    externalUrl: null,
  });
  assert.equal(r.ok, true);
  assert.equal(r.listing_status, "listed");
  assert.equal(r.listed_at, undefined);
});

test("resolveListingUpdate can unlist and clear URL later via separate fields", () => {
  const r = resolveListingUpdate({
    currentStatus: "listed",
    listOn: false,
    externalUrl: "",
  });
  assert.equal(r.ok, true);
  assert.equal(r.listing_status, "unlisted");
  assert.equal(r.external_url, null);
});

test("resolveListingUpdate re-lists after moderator hide when publisher opts in again", () => {
  const now = new Date("2026-09-03T13:00:00.000Z");
  const r = resolveListingUpdate({
    currentStatus: "hidden",
    listOn: true,
    now,
  });
  assert.equal(r.ok, true);
  assert.equal(r.listing_status, "listed");
  assert.equal(r.listed_at, now.toISOString());
});

test("toPublicListing omits non-listed and requires slug", () => {
  assert.equal(toPublicListing({ listing_status: "unlisted", article_id: "a" }), null);
  assert.equal(toPublicListing({ listing_status: "listed", article_id: "" }), null);
  const pub = toPublicListing({
    listing_status: "listed",
    article_id: "hello",
    title: "Hello",
    author: "Maya",
    teaser: "Preview",
    price_wei: "500000",
    payment_asset: "usdc",
    publisher: "0xabc",
    external_url: "https://maya.blog/hello",
    listed_at: "2026-09-03T12:00:00.000Z",
    embed_sig: "0xsig",
  });
  assert.equal(pub.slug, "hello");
  assert.equal(pub.externalUrl, "https://maya.blog/hello");
  assert.equal(pub.embedSig, "0xsig");
  assert.equal(pub.paymentAsset, "usdc");
  assert.ok(!("body" in pub));
});

test("formatPriceLabel formats usdc and mon", () => {
  assert.equal(formatPriceLabel("500000", "usdc"), "$0.5 USDC");
  assert.equal(formatPriceLabel("1000000000000000000", "mon"), "1 MON");
});

test("isListingStatus", () => {
  assert.equal(isListingStatus("listed"), true);
  assert.equal(isListingStatus("nope"), false);
});
