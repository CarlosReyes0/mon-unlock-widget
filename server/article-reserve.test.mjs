import assert from "node:assert/strict";
import { test } from "node:test";
import {
  evaluateArticleReserve,
  buildArticleReserveRow,
  REGISTRATION_STATUS,
} from "./article-reserve.mjs";

test("evaluateArticleReserve allows insert when free", () => {
  const result = evaluateArticleReserve({
    existing: null,
    publisher: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  });
  assert.equal(result.ok, true);
  assert.equal(result.action, "insert");
});

test("evaluateArticleReserve allows same publisher update", () => {
  const result = evaluateArticleReserve({
    existing: { publisher: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    publisher: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  });
  assert.equal(result.ok, true);
  assert.equal(result.action, "update");
});

test("evaluateArticleReserve rejects other publisher", () => {
  const result = evaluateArticleReserve({
    existing: { publisher: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
    publisher: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "slug_taken");
  assert.equal(result.status, 409);
  assert.equal(result.publisher, "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
});

test("buildArticleReserveRow defaults to reserved", () => {
  const row = buildArticleReserveRow({
    slug: "july-rain",
    articleIdHash: "0xabc",
    priceWei: 1n,
    publisher: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    teaser: "hi",
    body: "body",
  });
  assert.equal(row.registration_status, REGISTRATION_STATUS.reserved);
  assert.equal(row.publisher, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(row.article_id, "july-rain");
});

test("buildArticleReserveRow keeps registered once confirmed", () => {
  const row = buildArticleReserveRow({
    slug: "july-rain",
    articleIdHash: "0xabc",
    priceWei: "1",
    publisher: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    existingStatus: "registered",
    confirmRegistered: false,
  });
  assert.equal(row.registration_status, "registered");
});

test("buildArticleReserveRow confirmRegistered promotes status", () => {
  const row = buildArticleReserveRow({
    slug: "july-rain",
    articleIdHash: "0xabc",
    priceWei: "1",
    publisher: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    confirmRegistered: true,
  });
  assert.equal(row.registration_status, "registered");
});
