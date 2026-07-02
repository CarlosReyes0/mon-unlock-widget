import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JSDOM } from "jsdom";
import { looksLikeHtml, sanitizeRichHtml } from "./body-content.js";

const { window } = new JSDOM("");
globalThis.DOMParser = window.DOMParser;

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

describe("sanitizeRichHtml", () => {
  it("removes scripts and event handlers", () => {
    const out = sanitizeRichHtml(
      '<div onclick="alert(1)">hello<script>alert(2)</script><img src="https://example.com/a.jpg" onerror="alert(3)"></div>'
    );
    assert.equal(out.includes("script"), false);
    assert.equal(out.includes("onclick"), false);
    assert.equal(out.includes("onerror"), false);
    assert.equal(out.includes("img"), true);
  });

  it("blocks javascript URLs", () => {
    const out = sanitizeRichHtml('<a href="javascript:alert(1)">Click</a>');
    assert.equal(out.includes("javascript:"), false);
  });

  it("allows trusted iframe hosts", () => {
    const out = sanitizeRichHtml(
      '<iframe src="https://www.youtube.com/embed/abc" allowfullscreen></iframe>'
    );
    assert.equal(out.includes("iframe"), true);
    assert.equal(out.includes("youtube.com/embed/abc"), true);
  });

  it("drops untrusted iframe hosts", () => {
    const out = sanitizeRichHtml('<iframe src="https://evil.example.com/embed/abc"></iframe>');
    assert.equal(out.includes("iframe"), false);
  });
});
