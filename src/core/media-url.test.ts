import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JSDOM } from "jsdom";
import {
  buildMediaSnippet,
  confidentMediaKind,
  detectMediaKind,
  extractMediaUrls,
  normalizeUrl,
  snippetFromPastedText,
} from "./media-url.js";

const { window } = new JSDOM("");
globalThis.DOMParser = window.DOMParser;

describe("media-url", () => {
  it("normalizes http(s) URLs and rejects javascript", () => {
    assert.equal(normalizeUrl("https://example.com/a.jpg"), "https://example.com/a.jpg");
    assert.equal(normalizeUrl("javascript:alert(1)"), "");
    assert.equal(normalizeUrl(""), "");
  });

  it("detects image, video, audio, and embed kinds", () => {
    assert.equal(detectMediaKind("https://example.com/photo.jpg"), "image");
    assert.equal(detectMediaKind("https://example.com/clip.mp4"), "video");
    assert.equal(detectMediaKind("https://example.com/song.mp3"), "audio");
    assert.equal(detectMediaKind("https://www.youtube.com/watch?v=abc123"), "embed");
    assert.equal(detectMediaKind("https://vimeo.com/123456789"), "embed");
    assert.equal(detectMediaKind("https://www.loom.com/share/abc"), "embed");
  });

  it("does not treat an unknown URL as pasteable media", () => {
    assert.equal(confidentMediaKind("https://example.com/article"), null);
    assert.equal(snippetFromPastedText("https://example.com/article"), null);
    assert.equal(snippetFromPastedText("hello https://example.com/a.jpg"), null);
  });

  it("builds HTML snippets including audio and playsinline video", () => {
    assert.match(buildMediaSnippet("https://example.com/a.jpg", "image"), /<img /);
    assert.match(buildMediaSnippet("https://example.com/a.mp4", "video"), /playsinline/);
    assert.match(buildMediaSnippet("https://example.com/a.mp3", "audio"), /<audio /);
    assert.match(
      buildMediaSnippet("https://www.youtube.com/watch?v=abc", "embed"),
      /youtube\.com\/embed\/abc/
    );
  });

  it("converts a pasted media URL into a snippet", () => {
    const yt = snippetFromPastedText("https://youtu.be/abc123");
    assert.ok(yt && yt.includes("<iframe") && yt.includes("youtube.com/embed/abc123"));
    const img = snippetFromPastedText("https://cdn.example.com/hero.webp");
    assert.ok(img && img.includes("<img"));
    const audio = snippetFromPastedText("https://cdn.example.com/track.m4a");
    assert.ok(audio && audio.includes("<audio"));
  });

  it("extracts img, video, audio, and iframe URLs", () => {
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
