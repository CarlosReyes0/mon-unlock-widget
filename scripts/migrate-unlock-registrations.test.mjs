import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyPublisherRemap,
  buildPlan,
  loadRemap,
  mergeRows,
  normalizeDbArticle,
  parseArgs,
} from "./migrate-unlock-registrations.mjs";

const OLD = "0x1111111111111111111111111111111111111111";
const NEXT = "0x2222222222222222222222222222222222222222";
const HASH = "0x" + "ab".repeat(32);
const NEW_MON = "0x3333333333333333333333333333333333333333";
const NEW_USDC = "0x4444444444444444444444444444444444444444";

test("parseArgs is a dry-run unless --confirm is passed", () => {
  assert.equal(parseArgs([]).confirm, false);
  assert.equal(parseArgs(["--source=db"]).source, "db");
  assert.equal(parseArgs(["--confirm", "--dry-run"]).confirm, false);
  assert.equal(parseArgs(["--dry-run", "--confirm"]).confirm, true);
  assert.equal(parseArgs(["--remap=custom.json"]).remapPath, "custom.json");
  assert.throws(() => parseArgs(["--source=nope"]), /invalid_source/);
});

test("loadRemap accepts one publisher mapping and rejects junk", () => {
  const remap = loadRemap(
    JSON.stringify({ publishers: { [OLD]: NEXT } })
  );
  assert.equal(applyPublisherRemap(OLD.toUpperCase(), remap), NEXT);
  assert.equal(applyPublisherRemap("0xabcabcabcabcabcabcabcabcabcabcabcabcabca", remap), "0xabcabcabcabcabcabcabcabcabcabcabcabcabca");
  assert.throws(() => loadRemap("{"), /remap_invalid/);
  assert.throws(
    () => loadRemap(JSON.stringify({ publishers: { [OLD]: "not-an-address" } })),
    /remap_invalid/
  );
});

test("buildPlan keeps the original publisher and price and can remap one", () => {
  const rows = [
    {
      articleIdHash: HASH,
      publisher: OLD,
      priceWei: "500000",
      paymentAsset: "usdc",
      active: true,
    },
    {
      articleIdHash: "0x" + "cd".repeat(32),
      publisher: OLD,
      priceWei: "1000000000000000000",
      paymentAsset: "mon",
      active: false,
    },
  ];
  const { plans, skipped } = buildPlan(rows, {
    newMon: NEW_MON,
    newUsdc: NEW_USDC,
    remap: { [OLD]: NEXT },
  });
  assert.equal(plans.length, 1);
  assert.equal(plans[0].publisher, NEXT);
  assert.equal(plans[0].originalPublisher, OLD);
  assert.equal(plans[0].priceWei, "500000");
  assert.equal(plans[0].target, NEW_USDC);
  assert.equal(plans[0].remapped, true);
  assert.equal(skipped[0].reason, "inactive");
});

test("mergeRows lets the chain row replace the database row", () => {
  const db = [
    normalizeDbArticle({
      article_id_hash: HASH,
      publisher: OLD,
      price_wei: "1",
      payment_asset: "usdc",
      active: true,
    }),
  ];
  const chain = [
    {
      articleIdHash: HASH,
      publisher: NEXT,
      priceWei: "9",
      paymentAsset: "usdc",
      active: true,
    },
  ];
  const merged = mergeRows(chain, db);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].publisher, NEXT);
  assert.equal(merged[0].priceWei, "9");
});
