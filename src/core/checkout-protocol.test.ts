import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CHECKOUT_MESSAGE_SOURCE,
  buildCheckoutUrl,
  isCheckoutMessage,
} from "./checkout-protocol.js";

describe("buildCheckoutUrl", () => {
  it("includes required query params", () => {
    const url = buildCheckoutUrl(
      {
        articleId: "demo-post",
        title: "Hello",
        price: "1.5",
        contract: "0x038446b1F736e254cC0E256B20D74823c41EeADB",
        embedSig: "0xabc",
        parentOrigin: "https://publisher.example",
      },
      "https://cdn.example"
    );
    const parsed = new URL(url);
    assert.equal(parsed.origin, "https://cdn.example");
    assert.equal(parsed.pathname, "/unlock.html");
    assert.equal(parsed.searchParams.get("articleId"), "demo-post");
    assert.equal(parsed.searchParams.get("price"), "1.5");
    assert.equal(parsed.searchParams.get("parentOrigin"), "https://publisher.example");
    assert.equal(parsed.searchParams.get("embedSig"), "0xabc");
  });
});

describe("isCheckoutMessage", () => {
  it("accepts unlocked messages", () => {
    assert.equal(
      isCheckoutMessage({
        source: CHECKOUT_MESSAGE_SOURCE,
        type: "mon:unlocked",
        articleId: "a",
        address: "0x1",
      }),
      true
    );
  });

  it("rejects foreign messages", () => {
    assert.equal(isCheckoutMessage({ type: "mon:unlocked" }), false);
  });
});
