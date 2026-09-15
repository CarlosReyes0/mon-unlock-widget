import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { locatePaywall, slugFromTitle, splitPost, uniqueSlugFromTitle } from "./split-post.js";

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

describe("locatePaywall", () => {
  it("marks the fold after the first paragraph", () => {
    const raw = "First graph.\n\nSecond graph.\n\nThird.";
    const f = locatePaywall(raw);
    assert.equal(f.hasFold, true);
    assert.equal(raw.slice(0, f.freeEnd), "First graph.");
    assert.equal(raw.slice(f.paidStart), "Second graph.\n\nThird.");
    assert.equal(raw.slice(0, f.freeEnd).trim(), splitPost(raw).teaser);
  });

  it("marks the fold at a --- line", () => {
    const raw = "Walking home in the rain.\n---\nI kept my hands in my pockets.";
    const f = locatePaywall(raw);
    assert.equal(f.hasFold, true);
    assert.equal(raw.slice(0, f.freeEnd).trim(), "Walking home in the rain.");
    assert.equal(raw.slice(f.paidStart), "I kept my hands in my pockets.");
  });

  it("has no fold when the whole short piece is the preview", () => {
    const f = locatePaywall("Just one line.");
    assert.equal(f.hasFold, false);
  });

  it("cuts a long single block at the same preview as splitPost", () => {
    const long = `${"word ".repeat(80)}end`;
    const f = locatePaywall(long);
    const r = splitPost(long);
    assert.equal(f.hasFold, true);
    assert.equal(long.slice(0, f.freeEnd).trim(), r.teaser);
  });
});

describe("uniqueSlugFromTitle", () => {
  it("builds a url-safe slug from the title", () => {
    assert.equal(slugFromTitle("July rain walk"), "july-rain-walk");
    const slug = uniqueSlugFromTitle("July rain walk");
    assert.match(slug, /^july-rain-walk-[a-z0-9]+$/);
  });
});
