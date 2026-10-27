import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isBlockedPublisher, parseBlockedPublishers } from "./blocked-publishers.js";

const DEAD = "0x000000000000000000000000000000000000dead";
const BEEF = "0x000000000000000000000000000000000000beef";

describe("parseBlockedPublishers", () => {
  it("returns nothing when the list is empty or unset", () => {
    assert.deepEqual(parseBlockedPublishers(undefined), []);
    assert.deepEqual(parseBlockedPublishers(null), []);
    assert.deepEqual(parseBlockedPublishers(""), []);
    assert.deepEqual(parseBlockedPublishers("  ,  , "), []);
  });

  it("splits on commas, trims whitespace, and lowercases", () => {
    assert.deepEqual(
      parseBlockedPublishers(` ${DEAD.toUpperCase()} , ${BEEF} `),
      [DEAD, BEEF]
    );
  });

  it("drops entries that are not addresses and duplicate entries", () => {
    assert.deepEqual(parseBlockedPublishers(`nope, ${DEAD}, ${DEAD}, 0x123`), [DEAD]);
  });
});

describe("isBlockedPublisher", () => {
  it("matches case-insensitively and ignores a blank list", () => {
    assert.equal(isBlockedPublisher(DEAD.toUpperCase(), ` ${DEAD} `), true);
    assert.equal(isBlockedPublisher(BEEF, DEAD), false);
    assert.equal(isBlockedPublisher(DEAD, ""), false);
    assert.equal(isBlockedPublisher(DEAD, undefined), false);
    assert.equal(isBlockedPublisher("not-an-address", DEAD), false);
  });
});
