/**
 * BLOCKED_PUBLISHERS parsing. Addresses here are fixtures, not users.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { isBlockedPublisher, parseBlockedPublishers } from "./blocked-publishers.mjs";
import {
  isBlockedPublisher as tsIsBlocked,
  parseBlockedPublishers as tsParse,
} from "../dist/core/blocked-publishers.js";

const DEAD = "0x000000000000000000000000000000000000dead";
const BEEF = "0x000000000000000000000000000000000000beef";

test("empty or unset BLOCKED_PUBLISHERS blocks nobody", () => {
  assert.deepEqual(parseBlockedPublishers(undefined), []);
  assert.deepEqual(parseBlockedPublishers(null), []);
  assert.deepEqual(parseBlockedPublishers(""), []);
  assert.deepEqual(parseBlockedPublishers(" , , "), []);
  assert.equal(isBlockedPublisher(DEAD, ""), false);
  assert.equal(isBlockedPublisher(DEAD, undefined), false);
});

test("the list is comma-separated, trimmed, and case-insensitive", () => {
  const raw = ` ${DEAD.toUpperCase()} , ${BEEF} , nope , ${DEAD} `;
  assert.deepEqual(parseBlockedPublishers(raw), [DEAD, BEEF]);
  assert.equal(isBlockedPublisher(`  ${DEAD.toUpperCase()}  `, raw), true);
  assert.equal(isBlockedPublisher("0x0000000000000000000000000000000000000001", raw), false);
  assert.equal(isBlockedPublisher("not-an-address", raw), false);
});

test("server and edge parsers agree", () => {
  const samples = ["", null, undefined, ` ${DEAD.toUpperCase()}, ${BEEF} , nope `, "0x123"];
  for (const sample of samples) {
    assert.deepEqual(parseBlockedPublishers(sample), tsParse(sample));
    assert.equal(isBlockedPublisher(DEAD, sample), tsIsBlocked(DEAD, sample));
    assert.equal(isBlockedPublisher(BEEF, sample), tsIsBlocked(BEEF, sample));
  }
});
