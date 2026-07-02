import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { looksLikeHtml } from "./body-content.js";

describe("looksLikeHtml", () => {
  it("detects plain text", () => {
    assert.equal(looksLikeHtml("Hello\n\nWorld"), false);
  });

  it("detects basic HTML", () => {
    assert.equal(looksLikeHtml("<p>Hello</p>"), true);
  });

  it("detects images", () => {
    assert.equal(looksLikeHtml('<img src="https://example.com/a.jpg" alt="test">'), true);
  });

  it("detects video", () => {
    assert.equal(looksLikeHtml('<video src="https://example.com/a.mp4" controls></video>'), true);
  });

  it("detects iframe embeds", () => {
    assert.equal(
      looksLikeHtml('<iframe src="https://www.youtube.com/embed/abc"></iframe>'),
      true
    );
  });
});
