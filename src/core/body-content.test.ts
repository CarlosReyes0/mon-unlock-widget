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

  it("converts mistaken YouTube shorts/watch in <video> into working iframe embed", () => {
    const outShorts = sanitizeRichHtml('<video src="https://youtube.com/shorts/QBPmWE5JM3w" controls></video>');
    assert.ok(outShorts.includes("<iframe"), "should produce iframe");
    assert.ok(outShorts.includes("youtube.com/embed/QBPmWE5JM3w"), "should have embed id");

    const outWatch = sanitizeRichHtml('<video src="https://www.youtube.com/watch?v=dQw4w9wgccc" controls></video>');
    assert.ok(outWatch.includes("youtube.com/embed/dQw4w9wgccc"));

    const outYoutu = sanitizeRichHtml('<video src="https://youtu.be/abc123" controls></video>');
    assert.ok(outYoutu.includes("youtube.com/embed/abc123"));
  });

  it("rewrites YouTube watch/shorts URLs inside <iframe src> to /embed/", () => {
    const outWatch = sanitizeRichHtml(
      '<iframe src="https://www.youtube.com/watch?v=yUSvGpmOw10" allowfullscreen></iframe>'
    );
    assert.ok(outWatch.includes("<iframe"), "iframe should remain");
    assert.ok(outWatch.includes("youtube.com/embed/yUSvGpmOw10"), "should rewrite to embed URL");
    assert.equal(outWatch.includes("/watch?v="), false, "watch URL should be gone");

    const outShorts = sanitizeRichHtml(
      '<iframe src="https://www.youtube.com/shorts/QBPmWE5JM3w"></iframe>'
    );
    assert.ok(outShorts.includes("youtube.com/embed/QBPmWE5JM3w"));

    const outShare = sanitizeRichHtml('<iframe src="https://youtu.be/abc123xyz"></iframe>');
    assert.ok(outShare.includes("youtube.com/embed/abc123xyz"));
  });

  it("preserves blank-line paragraph spacing in mixed HTML + plain text", () => {
    const out = sanitizeRichHtml(
      '<img src="https://example.com/a.jpg" alt="x">\n\nFirst paragraph.\n\nSecond paragraph.'
    );
    assert.ok(out.includes("First paragraph."), "keeps text");
    assert.ok(out.includes("<br"), "converts newlines to br");
    // Two blank-line gaps → multiple <br> between the sentences
    const between = out.slice(out.indexOf("First paragraph."), out.indexOf("Second paragraph."));
    assert.ok((between.match(/<br\s*\/?>/gi) || []).length >= 2, "paragraph gap becomes multiple br");
  });
});
