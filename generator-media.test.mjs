import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildMediaSnippet,
  detectMediaKind,
  extractMediaUrls,
  normalizeUrl,
  youtubeUrlToEmbed,
} from "./generator-media.js";

describe("generator-media", () => {
  it("normalizes http(s) URLs", () => {
    assert.equal(normalizeUrl("https://example.com/a.jpg"), "https://example.com/a.jpg");
    assert.equal(normalizeUrl("javascript:alert(1)"), "");
    assert.equal(normalizeUrl(""), "");
  });

  it("converts YouTube watch URLs to embed", () => {
    assert.equal(
      youtubeUrlToEmbed("https://www.youtube.com/watch?v=abc123"),
      "https://www.youtube.com/embed/abc123"
    );
    assert.equal(
      youtubeUrlToEmbed("https://youtu.be/abc123"),
      "https://www.youtube.com/embed/abc123"
    );
  });

  it("detects embed kind for YouTube links", () => {
    assert.equal(detectMediaKind("https://www.youtube.com/watch?v=abc123"), "embed");
    assert.equal(detectMediaKind("https://example.com/photo.jpg"), "image");
    assert.equal(detectMediaKind("https://example.com/clip.mp4"), "video");
  });

  it("builds HTML snippets", () => {
    assert.match(buildMediaSnippet("https://example.com/a.jpg", "image"), /<img /);
    assert.match(buildMediaSnippet("https://example.com/a.mp4", "video"), /<video /);
    assert.match(
      buildMediaSnippet("https://www.youtube.com/embed/abc", "embed"),
      /<iframe /
    );
  });

  it("extracts media URLs from HTML", { skip: typeof DOMParser === "undefined" ? "DOMParser required" : false }, () => {
    const html = `
      <p>Hi</p>
      <img src="https://example.com/a.jpg" />
      <video src="https://example.com/b.mp4"></video>
      <iframe src="https://www.youtube.com/embed/abc"></iframe>
    `;
    const items = extractMediaUrls(html);
    assert.equal(items.length, 3);
    assert.deepEqual(
      items.map((i) => i.type),
      ["image", "video", "embed"]
    );
  });
});
