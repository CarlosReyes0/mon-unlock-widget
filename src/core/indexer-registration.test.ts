import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PUBLISHER_LEFT_UNCHANGED_WARNING,
  REGISTRATION_IGNORED_WARNING,
  decideArticleRegistration,
  registrationUpdatePatch,
} from "./indexer-registration.js";

const STORED = "0x0000000000000000000000000000000000000001";
const OTHER = "0x0000000000000000000000000000000000000002";
const BLOCKED = "0x000000000000000000000000000000000000dead";

describe("decideArticleRegistration", () => {
  it("inserts when the article is new and the publisher is not blocked", () => {
    assert.deepEqual(
      decideArticleRegistration({
        rowExists: false,
        eventPublisher: STORED,
        blockedList: "",
      }),
      { action: "insert" }
    );
  });

  it("ignores a registration whose publisher is blocked", () => {
    const list = ` ${BLOCKED.toUpperCase()} `;
    assert.deepEqual(
      decideArticleRegistration({
        rowExists: false,
        eventPublisher: BLOCKED,
        blockedList: list,
      }),
      { action: "skip", warn: REGISTRATION_IGNORED_WARNING }
    );
    assert.deepEqual(
      decideArticleRegistration({
        rowExists: true,
        existingPublisher: STORED,
        eventPublisher: BLOCKED,
        blockedList: list,
      }).action,
      "skip"
    );
  });

  it("does not replace a stored publisher with a different wallet", () => {
    const decision = decideArticleRegistration({
      rowExists: true,
      existingPublisher: STORED.toUpperCase(),
      eventPublisher: OTHER,
      blockedList: "",
    });
    assert.equal(decision.action, "skip");
    assert.equal(decision.warn, PUBLISHER_LEFT_UNCHANGED_WARNING);
    assert.equal(decision.warn?.includes("0x"), false);
  });

  it("updates when the event publisher matches the stored one", () => {
    assert.deepEqual(
      decideArticleRegistration({
        rowExists: true,
        existingPublisher: STORED,
        eventPublisher: STORED.toUpperCase(),
        blockedList: BLOCKED,
      }),
      { action: "update" }
    );
  });
});

describe("registrationUpdatePatch", () => {
  it("never writes a publisher over one that is already stored", () => {
    const patch = registrationUpdatePatch({
      existingPublisher: STORED,
      eventPublisher: OTHER,
      priceWei: "500000",
      paymentAsset: "usdc",
      now: "2020-01-01T00:00:00.000Z",
    });
    assert.equal("publisher" in patch, false);
    assert.equal(patch.price_wei, "500000");
    assert.equal(patch.registration_status, "registered");
  });

  it("can set a publisher only when the row has none", () => {
    const patch = registrationUpdatePatch({
      existingPublisher: "  ",
      eventPublisher: STORED.toUpperCase(),
      priceWei: "1",
      paymentAsset: "mon",
      now: "2020-01-01T00:00:00.000Z",
    });
    assert.equal(patch.publisher, STORED);
  });
});
