import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { slugFromTitle, splitPost, uniqueSlugFromTitle } from "./split-post.js";

describe("splitPost", () => {
  it("uses --- as the paywall fold", () => {
    const r = splitPost("Walking home in the rain.\n---\nI kept my hands in my pockets.");
    assert.equal(r.teaser, "Walking home in the rain.");
    assert.equal(r.body, "I kept my hands in my pockets.");
  });

  it("uses the first paragraph as the free preview", () => {
    const r = splitPost("First graph.\n\nSecond graph.\n\nThird.");
    assert.equal(r.teaser, "First graph.");
    assert.equal(r.body, "Second graph.\n\nThird.");
  });

  it("keeps a short single paragraph as both preview and body", () => {
    const r = splitPost("Just one line.");
    assert.equal(r.teaser, "Just one line.");
    assert.equal(r.body, "Just one line.");
  });

  it("trims a long single block for the preview", () => {
    const long = `${"word ".repeat(80)}end`;
    const r = splitPost(long);
    assert.ok(r.teaser.length <= 280);
    assert.ok(r.body.includes("end"));
  });
});

describe("uniqueSlugFromTitle", () => {
  it("builds a url-safe slug from the title", () => {
    assert.equal(slugFromTitle("July rain walk"), "july-rain-walk");
    const slug = uniqueSlugFromTitle("July rain walk");
    assert.match(slug, /^july-rain-walk-[a-z0-9]+$/);
  });
});
