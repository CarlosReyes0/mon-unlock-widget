import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  altFromFilename,
  classifyClientFile,
  MEDIA_LIMITS,
  snippetForHostedFile,
} from "./media-file.js";

describe("media-file", () => {
  it("accepts a jpeg under the photo limit", () => {
    const result = classifyClientFile({ type: "image/jpeg", name: "beach.jpg", size: 1200 });
    assert.deepEqual(result, { ok: true, kind: "image", contentType: "image/jpeg" });
  });

  it("treats an iPhone movie as video", () => {
    const result = classifyClientFile({ type: "video/quicktime", name: "clip.mov", size: 2000 });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.kind, "video");
      assert.equal(result.contentType, "video/mp4");
    }
  });

  it("rejects HEIC with a JPEG hint", () => {
    const result = classifyClientFile({ type: "image/heic", name: "IMG.HEIC", size: 2000 });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.message, /JPEG/);
  });

  it("rejects an oversized video before upload", () => {
    const result = classifyClientFile({
      type: "video/mp4",
      name: "long.mp4",
      size: MEDIA_LIMITS.video + 1,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.message, /45 MB/);
  });

  it("builds an image snippet from the file name", () => {
    const html = snippetForHostedFile("https://cdn.example/a.jpg", "image", "Harbor walk.jpg");
    assert.match(html, /alt="Harbor walk"/);
    assert.match(html, /https:\/\/cdn\.example\/a\.jpg/);
  });

  it("uses Photo when the file name is only a number", () => {
    assert.equal(altFromFilename("IMG_2048.JPG"), "IMG 2048");
    assert.equal(altFromFilename("12345.png"), "Photo");
  });
});
