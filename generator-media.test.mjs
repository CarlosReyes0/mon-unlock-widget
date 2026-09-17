import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  buildMediaSnippet,
  detectMediaKind,
  extractMediaUrls,
  normalizeUrl,
  trustedEmbedSrc,
  youtubeUrlToEmbed,
} from "./generator-media.js";

const { window } = new JSDOM("");
globalThis.DOMParser = window.DOMParser;

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

  it("converts Vimeo and Loom share URLs to embed", () => {
    assert.equal(trustedEmbedSrc("https://vimeo.com/123456789"), "https://player.vimeo.com/video/123456789");
    assert.equal(
      trustedEmbedSrc("https://www.loom.com/share/abcDEF"),
      "https://www.loom.com/embed/abcDEF"
    );
  });

  it("detects embed kind for YouTube links", () => {
    assert.equal(detectMediaKind("https://www.youtube.com/watch?v=abc123"), "embed");
    assert.equal(detectMediaKind("https://example.com/photo.jpg"), "image");
    assert.equal(detectMediaKind("https://example.com/clip.mp4"), "video");
    assert.equal(detectMediaKind("https://example.com/song.mp3"), "audio");
  });

  it("builds HTML snippets", () => {
    assert.match(buildMediaSnippet("https://example.com/a.jpg", "image"), /<img /);
    assert.match(buildMediaSnippet("https://example.com/a.mp4", "video"), /<video /);
    assert.match(buildMediaSnippet("https://example.com/a.mp3", "audio"), /<audio /);
    assert.match(
      buildMediaSnippet("https://www.youtube.com/embed/abc", "embed"),
      /<iframe /
    );
  });

  it("extracts media URLs from HTML", () => {
    const html = `
      <p>Hi</p>
      <img src="https://example.com/a.jpg" />
      <video src="https://example.com/b.mp4"></video>
      <audio src="https://example.com/c.mp3"></audio>
      <iframe src="https://www.youtube.com/embed/abc"></iframe>
    `;
    const items = extractMediaUrls(html);
    assert.equal(items.length, 4);
    assert.deepEqual(
      items.map((i) => i.type),
      ["image", "video", "audio", "embed"]
    );
  });
});
