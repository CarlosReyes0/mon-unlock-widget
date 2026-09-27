import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  WRITE_DRAFT_LEGACY_KEY,
  WRITE_DRAFTS_KEY,
  WRITE_PROMPTS,
  createWriteDraft,
  deleteWriteDraft,
  draftLabel,
  formatSavedAt,
  getActiveDraft,
  getWriteDraft,
  isDraftEmpty,
  listWriteDrafts,
  memoryDraftStorage,
  migrateLegacyWriteDraft,
  peekResumableDraft,
  promptsForDay,
  saveWriteDraft,
  wordCount,
  writeNudge,
} from "./write-drafts.js";

describe("write drafts", () => {
  it("migrates the single localStorage draft", () => {
    const storage = memoryDraftStorage({
      [WRITE_DRAFT_LEGACY_KEY]: JSON.stringify({
        title: "July rain walk",
        body: "Walking home the streets were empty.",
        reservedSlug: "july-rain-walk-ab12",
      }),
    });
    const store = migrateLegacyWriteDraft(storage, 1_700_000_000_000);
    assert.equal(store.drafts.length, 1);
    assert.equal(store.drafts[0].title, "July rain walk");
    assert.equal(store.drafts[0].reservedSlug, "july-rain-walk-ab12");
    assert.equal(storage.getItem(WRITE_DRAFT_LEGACY_KEY), null);
    assert.ok(storage.getItem(WRITE_DRAFTS_KEY));
  });

  it("keeps more than one draft and resumes the active one", () => {
    const storage = memoryDraftStorage();
    const first = createWriteDraft(storage, { title: "First", body: "One." }, 100);
    createWriteDraft(storage, { title: "Second", body: "Two." }, 200);
    assert.equal(listWriteDrafts(storage).length, 2);
    saveWriteDraft(storage, first.id, { title: "First again", body: "Updated." }, 300);
    const active = getActiveDraft(storage);
    assert.equal(active?.id, first.id);
    assert.equal(active?.body, "Updated.");
    const peek = peekResumableDraft(storage);
    assert.equal(peek?.label, "First again");
  });

  it("does not pile up empty drafts", () => {
    const storage = memoryDraftStorage();
    createWriteDraft(storage, {}, 100);
    createWriteDraft(storage, {}, 200);
    createWriteDraft(storage, { title: "Kept" }, 300);
    createWriteDraft(storage, {}, 400);
    const drafts = listWriteDrafts(storage);
    assert.equal(drafts.filter((d) => isDraftEmpty(d)).length, 1);
    assert.equal(drafts.some((d) => d.title === "Kept"), true);
  });

  it("delete moves active to the next draft", () => {
    const storage = memoryDraftStorage();
    const older = createWriteDraft(storage, { title: "Older", body: "A" }, 100);
    const newer = createWriteDraft(storage, { title: "Newer", body: "B" }, 200);
    const next = deleteWriteDraft(storage, newer.id);
    assert.equal(next?.id, older.id);
    assert.equal(listWriteDrafts(storage).length, 1);
  });

  it("keeps an author byline and still loads drafts saved without one", () => {
    const storage = memoryDraftStorage({
      [WRITE_DRAFTS_KEY]: JSON.stringify({
        version: 1,
        activeId: "d1",
        drafts: [{ id: "d1", title: "Old", body: "Body", reservedSlug: "", createdAt: 1, updatedAt: 1 }],
      }),
    });
    assert.equal(getWriteDraft(storage, "d1")?.author, "");
    const created = createWriteDraft(storage, { title: "Named", author: "Ada Lovelace" }, 100);
    assert.equal(created.author, "Ada Lovelace");
    saveWriteDraft(storage, created.id, { author: "Carlos Reyes" }, 200);
    assert.equal(getWriteDraft(storage, created.id)?.author, "Carlos Reyes");
    assert.equal(isDraftEmpty({ title: "", body: "" }), true);
    assert.equal(isDraftEmpty({ title: "", body: "---" }), true);
    assert.equal(isDraftEmpty({ title: "", body: "Hello\n---\nthere" }), false);
    const fresh = createWriteDraft(memoryDraftStorage(), {}, 500);
    assert.equal(fresh.body, "---");
    assert.equal(isDraftEmpty(fresh), true);
  });

  it("peek ignores empty drafts", () => {
    const storage = memoryDraftStorage();
    createWriteDraft(storage, {}, 100);
    assert.equal(peekResumableDraft(storage), null);
    createWriteDraft(storage, { title: "Hello" }, 200);
    assert.equal(peekResumableDraft(storage)?.label, "Hello");
  });
});

describe("write encouragement copy", () => {
  it("counts words without HTML tags", () => {
    assert.equal(wordCount(""), 0);
    assert.equal(wordCount("  one   two "), 2);
    assert.equal(wordCount('<img src="x.jpg" alt="hero" /> rain walk'), 2);
  });

  it("labels untitled drafts from the first line", () => {
    assert.equal(draftLabel({ title: "Named", body: "ignored" }), "Named");
    assert.equal(draftLabel({ title: "", body: "" }), "Untitled");
    assert.equal(draftLabel({ title: "  ", body: "Walking home the streets were empty." }), "Walking home the streets were empty.");
  });

  it("nudges without gamifying", () => {
    assert.equal(writeNudge(0), "A few paragraphs is a post.");
    assert.equal(writeNudge(1), "1 word · the first graph is free.");
    assert.equal(writeNudge(40), "40 words · the first graph is free.");
    assert.equal(writeNudge(120), "120 words · enough for a $0.50 piece.");
    assert.equal(writeNudge(400), "400 words · publish when you’re ready.");
  });

  it("formats a device-local save time", () => {
    const now = 1_700_000_060_000;
    assert.equal(formatSavedAt(now - 2000, now), "Saved on this device just now");
    assert.equal(formatSavedAt(now - 20_000, now), "Saved on this device 20s ago");
    assert.equal(formatSavedAt(now - 3 * 60_000, now), "Saved on this device 3 min ago");
  });

  it("rotates four starters from a fixed set", () => {
    const a = promptsForDay(0);
    const b = promptsForDay(86_400_000);
    assert.equal(a.length, 4);
    assert.equal(WRITE_PROMPTS.length >= 4, true);
    assert.notDeepEqual(a.map((p) => p.id), b.map((p) => p.id));
    for (const prompt of a) {
      assert.ok(WRITE_PROMPTS.some((row) => row.id === prompt.id));
      assert.ok(prompt.title);
    }
  });
});
