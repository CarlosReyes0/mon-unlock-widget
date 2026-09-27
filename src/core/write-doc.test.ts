import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { splitPost } from "./split-post.js";
import {
  parseWriteDoc,
  placeFold,
  serializeWriteDoc,
  splitTextBlock,
  visibleFoldIndex,
} from "./write-doc.js";

describe("write-doc", () => {
  it("turns a photo tag into a media block and back into a player", () => {
    const raw = 'Walking home.\n\n<img src="https://cdn.example.com/harbor.jpg" alt="Harbor" />\n\nThe rest.';
    const blocks = parseWriteDoc(raw);
    assert.deepEqual(
      blocks.map((block) => block.type),
      ["text", "media", "text"]
    );
    const media = blocks[1];
    assert.equal(media.type, "media");
    if (media.type === "media") {
      assert.equal(media.kind, "image");
      assert.equal(media.url, "https://cdn.example.com/harbor.jpg");
      assert.equal(media.alt, "Harbor");
    }
    const again = serializeWriteDoc(blocks);
    assert.match(again, /<img /);
    assert.match(again, /alt="Harbor"/);
    assert.equal(splitPost(again).teaser, "Walking home.");
  });

  it("keeps an explicit paywall line", () => {
    const raw = "Walking home in the rain.\n---\nI kept my hands in my pockets.";
    const blocks = parseWriteDoc(raw);
    assert.deepEqual(
      blocks.map((block) => block.type),
      ["text", "fold", "text"]
    );
    const saved = serializeWriteDoc(blocks);
    assert.equal(splitPost(saved).teaser, "Walking home in the rain.");
    assert.equal(splitPost(saved).body, "I kept my hands in my pockets.");
    assert.equal(visibleFoldIndex(blocks), 1);
  });

  it("draws the automatic line before the second paragraph", () => {
    const blocks = parseWriteDoc("First graph.\n\nSecond graph.\n\nThird.");
    assert.equal(visibleFoldIndex(blocks), 1);
    const at = visibleFoldIndex(blocks) ?? 0;
    const content = blocks.filter((block) => block.type !== "fold");
    assert.equal(serializeWriteDoc(content.slice(0, at)), splitPost(serializeWriteDoc(blocks)).teaser);
  });

  it("places the line where the writer drops it", () => {
    const blocks = parseWriteDoc("One.\n\nTwo.\n\nThree.");
    const moved = placeFold(blocks, 2);
    assert.equal(visibleFoldIndex(moved), 2);
    const saved = serializeWriteDoc(moved);
    assert.equal(splitPost(saved).teaser, "One.\n\nTwo.");
    assert.equal(splitPost(saved).body, "Three.");
  });

  it("splits a paragraph at the cursor", () => {
    const blocks = parseWriteDoc("Hello world");
    const id = blocks[0].id;
    const split = splitTextBlock(blocks, id, 5);
    const text = split.blocks.filter((block) => block.type === "text").map((block) => block.type === "text" ? block.text : "");
    assert.deepEqual(text, ["Hello", " world"]);
    assert.equal(serializeWriteDoc(split.blocks), "Hello\n\nworld");
  });

  it("keeps a video and a YouTube embed as players", () => {
    const raw = [
      '<video controls playsinline src="https://cdn.example.com/clip.mp4"></video>',
      "",
      '<iframe src="https://www.youtube.com/embed/abc123xyz" allowfullscreen></iframe>',
    ].join("\n");
    const blocks = parseWriteDoc(raw);
    const kinds = blocks.filter((block) => block.type === "media").map((block) => (block.type === "media" ? block.kind : ""));
    assert.deepEqual(kinds, ["video", "embed"]);
    const saved = serializeWriteDoc(blocks);
    assert.match(saved, /<video /);
    assert.match(saved, /youtube\.com\/embed\/abc123xyz/);
  });
});
