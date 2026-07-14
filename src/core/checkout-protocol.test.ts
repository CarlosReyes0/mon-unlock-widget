import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CHECKOUT_MESSAGE_SOURCE,
  buildCheckoutUrl,
  buildArticleReturnUrl,
  readFiatReturnFromLocation,
  isCheckoutMessage,
  FIAT_SESSION_PARAM,
  FIAT_ARTICLE_PARAM,
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
        returnUrl: "https://publisher.example/post?x=1",
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
    assert.equal(parsed.searchParams.get("returnUrl"), "https://publisher.example/post?x=1");
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

  it("accepts fiat unlocked messages", () => {
    assert.equal(
      isCheckoutMessage({
        source: CHECKOUT_MESSAGE_SOURCE,
        type: "mon:unlocked",
        articleId: "a",
        fiatSession: "session-uuid",
        mode: "fiat",
      }),
      true
    );
  });

  it("rejects foreign messages", () => {
    assert.equal(isCheckoutMessage({ type: "mon:unlocked" }), false);
  });
});

describe("fiat return URL helpers", () => {
  it("embeds session on the article URL", () => {
    const url = buildArticleReturnUrl("https://publisher.example/post?x=1", {
      articleId: "july-9",
      fiatSession: "sess-1",
    });
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get(FIAT_SESSION_PARAM), "sess-1");
    assert.equal(parsed.searchParams.get(FIAT_ARTICLE_PARAM), "july-9");
    assert.equal(parsed.searchParams.get("x"), "1");
  });

  it("reads fiat return params", () => {
    const got = readFiatReturnFromLocation(
      `?${FIAT_SESSION_PARAM}=abc&${FIAT_ARTICLE_PARAM}=july-9`
    );
    assert.deepEqual(got, { articleId: "july-9", fiatSession: "abc" });
  });
});

