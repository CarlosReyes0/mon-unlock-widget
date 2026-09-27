/** Local write drafts. No account required — Publish is what needs a wallet. */
import { isPaywallOnlyBody, seedPaywallFold } from "./split-post.js";

export const WRITE_DRAFTS_KEY = "openpaywall-write-drafts";
export const WRITE_DRAFT_LEGACY_KEY = "openpaywall-write-draft";
export const WRITE_DRAFTS_MAX = 25;

export type DraftStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export type WriteDraft = {
  id: string;
  title: string;
  body: string;
  reservedSlug: string;
  /** Byline edited on Write. Empty until the writer or a Privy prefill sets it. */
  author: string;
  promptId?: string;
  createdAt: number;
  updatedAt: number;
};

export type WriteDraftStore = {
  version: 1;
  activeId: string;
  drafts: WriteDraft[];
};

export type WritePrompt = {
  id: string;
  title: string;
  seed: string;
};

export type ResumableDraft = {
  id: string;
  label: string;
  words: number;
  updatedAt: number;
};

/** Starters for a blank page. Personal, short — not growth-hack prompts. */
export const WRITE_PROMPTS: readonly WritePrompt[] = [
  { id: "walk", title: "A walk I keep thinking about", seed: "I took a walk I usually skip." },
  { id: "changed", title: "Something I changed my mind about", seed: "I used to think —" },
  { id: "noticed", title: "What I noticed this week", seed: "The thing I keep noticing:" },
  { id: "replay", title: "A conversation I can’t stop replaying", seed: "I keep hearing this line:" },
  { id: "morning", title: "This morning, before the phone", seed: "Before I opened anything:" },
  { id: "letter", title: "A letter I never sent", seed: "I never sent this:" },
  { id: "unseen", title: "The work nobody sees", seed: "The part that doesn’t show up:" },
  { id: "fifty", title: "A thing I’d pay 50¢ to read", seed: "" },
];

export function memoryDraftStorage(seed?: Record<string, string>): DraftStorage {
  const map = new Map<string, string>(Object.entries(seed || {}));
  return {
    getItem(key) {
      return map.has(key) ? map.get(key)! : null;
    },
    setItem(key, value) {
      map.set(key, value);
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

function emptyStore(): WriteDraftStore {
  return { version: 1, activeId: "", drafts: [] };
}

function newDraftId(now = Date.now()): string {
  const rand = Math.floor(Math.random() * 36 ** 4)
    .toString(36)
    .padStart(4, "0");
  return `d_${now.toString(36)}_${rand}`;
}

function normalizeDraft(raw: Partial<WriteDraft> | null | undefined, now = Date.now()): WriteDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const id = String(raw.id || "").trim();
  if (!id) return null;
  return {
    id,
    title: String(raw.title || ""),
    body: String(raw.body || ""),
    reservedSlug: String(raw.reservedSlug || ""),
    author: String(raw.author || ""),
    promptId: raw.promptId ? String(raw.promptId) : undefined,
    createdAt: Number(raw.createdAt) || now,
    updatedAt: Number(raw.updatedAt) || now,
  };
}

export function isDraftEmpty(draft: Pick<WriteDraft, "title" | "body">): boolean {
  return !String(draft.title || "").trim() && isPaywallOnlyBody(draft.body);
}

export function wordCount(text: string): number {
  const plain = String(text || "")
    .replace(/<[^>]+>/g, " ")
    .split("\n")
    .filter((line) => !/^---\s*$/.test(line.trim()))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!plain) return 0;
  return plain.split(" ").length;
}

export function draftLabel(draft: Pick<WriteDraft, "title" | "body">): string {
  const title = String(draft.title || "").trim();
  if (title) return title;
  const first = String(draft.body || "")
    .replace(/<[^>]+>/g, " ")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .find((line) => line && !/^---\s*$/.test(line));
  if (!first) return "Untitled";
  return first.length > 48 ? `${first.slice(0, 47)}…` : first;
}

export function writeNudge(words: number): string {
  const n = Math.max(0, Math.floor(Number(words) || 0));
  if (n <= 0) return "A few paragraphs is a post.";
  if (n < 80) return `${n} word${n === 1 ? "" : "s"} · the first graph is free.`;
  if (n < 220) return `${n} words · enough for a $0.50 piece.`;
  return `${n} words · publish when you’re ready.`;
}

export function formatSavedAt(updatedAt: number, now = Date.now()): string {
  const then = Number(updatedAt) || 0;
  if (!then) return "Saved on this device";
  const sec = Math.max(0, Math.round((now - then) / 1000));
  if (sec < 8) return "Saved on this device just now";
  if (sec < 60) return `Saved on this device ${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `Saved on this device ${min} min ago`;
  const hours = Math.round(min / 60);
  if (hours < 36) return `Saved on this device ${hours}h ago`;
  return "Saved on this device";
}

export function promptsForDay(now = Date.now(), count = 4): WritePrompt[] {
  const n = WRITE_PROMPTS.length;
  const take = Math.min(Math.max(1, count), n);
  const start = Math.floor(now / 86_400_000) % n;
  return Array.from({ length: take }, (_, i) => WRITE_PROMPTS[(start + i) % n]);
}

function readStore(storage: DraftStorage): WriteDraftStore {
  try {
    const raw = storage.getItem(WRITE_DRAFTS_KEY);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw) as Partial<WriteDraftStore>;
    const drafts = Array.isArray(parsed.drafts)
      ? parsed.drafts.map((row) => normalizeDraft(row)).filter((row): row is WriteDraft => Boolean(row))
      : [];
    const activeId = String(parsed.activeId || "");
    return {
      version: 1,
      activeId: drafts.some((d) => d.id === activeId) ? activeId : drafts[0]?.id || "",
      drafts,
    };
  } catch {
    return emptyStore();
  }
}

function writeStore(storage: DraftStorage, store: WriteDraftStore): void {
  const drafts = store.drafts
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, WRITE_DRAFTS_MAX);
  const activeId = drafts.some((d) => d.id === store.activeId) ? store.activeId : drafts[0]?.id || "";
  storage.setItem(WRITE_DRAFTS_KEY, JSON.stringify({ version: 1, activeId, drafts }));
}

export function migrateLegacyWriteDraft(storage: DraftStorage, now = Date.now()): WriteDraftStore {
  const store = readStore(storage);
  if (store.drafts.length) return store;
  try {
    const raw = storage.getItem(WRITE_DRAFT_LEGACY_KEY);
    if (!raw) return store;
    const parsed = JSON.parse(raw) as { title?: string; body?: string; reservedSlug?: string };
    const draft: WriteDraft = {
      id: newDraftId(now),
      title: String(parsed.title || ""),
      body: String(parsed.body || ""),
      reservedSlug: String(parsed.reservedSlug || ""),
      author: "",
      createdAt: now,
      updatedAt: now,
    };
    const next = { version: 1 as const, activeId: draft.id, drafts: [draft] };
    writeStore(storage, next);
    storage.removeItem(WRITE_DRAFT_LEGACY_KEY);
    return next;
  } catch {
    return store;
  }
}

export function listWriteDrafts(storage: DraftStorage): WriteDraft[] {
  return readStore(storage).drafts.slice().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getWriteDraft(storage: DraftStorage, id: string): WriteDraft | null {
  const want = String(id || "");
  return readStore(storage).drafts.find((d) => d.id === want) || null;
}

export function getActiveDraft(storage: DraftStorage): WriteDraft | null {
  const store = readStore(storage);
  if (!store.activeId) return store.drafts[0] || null;
  return store.drafts.find((d) => d.id === store.activeId) || store.drafts[0] || null;
}

export function setActiveWriteDraft(storage: DraftStorage, id: string): WriteDraft | null {
  const store = readStore(storage);
  const draft = store.drafts.find((d) => d.id === id);
  if (!draft) return null;
  writeStore(storage, { ...store, activeId: draft.id });
  return draft;
}

function pruneExtraEmpties(drafts: WriteDraft[], keepId?: string): WriteDraft[] {
  const keep = drafts.find((d) => d.id === keepId);
  let keptEmpty = Boolean(keep && isDraftEmpty(keep));
  const out: WriteDraft[] = [];
  for (const draft of drafts) {
    if (draft.id === keepId || !isDraftEmpty(draft)) {
      out.push(draft);
      continue;
    }
    if (keptEmpty) continue;
    keptEmpty = true;
    out.push(draft);
  }
  return out;
}

export function createWriteDraft(
  storage: DraftStorage,
  patch: Partial<Pick<WriteDraft, "title" | "body" | "reservedSlug" | "promptId" | "author">> = {},
  now = Date.now()
): WriteDraft {
  const store = readStore(storage);
  const draft: WriteDraft = {
    id: newDraftId(now),
    title: String(patch.title || ""),
    body: seedPaywallFold(patch.body != null ? String(patch.body) : ""),
    reservedSlug: String(patch.reservedSlug || ""),
    author: String(patch.author || ""),
    promptId: patch.promptId ? String(patch.promptId) : undefined,
    createdAt: now,
    updatedAt: now,
  };
  const drafts = pruneExtraEmpties([draft, ...store.drafts], draft.id);
  writeStore(storage, { version: 1, activeId: draft.id, drafts });
  return draft;
}

export function saveWriteDraft(
  storage: DraftStorage,
  id: string,
  patch: Partial<Pick<WriteDraft, "title" | "body" | "reservedSlug" | "promptId" | "author">>,
  now = Date.now()
): WriteDraft | null {
  const store = readStore(storage);
  const index = store.drafts.findIndex((d) => d.id === id);
  if (index < 0) return null;
  const prev = store.drafts[index];
  const next: WriteDraft = {
    ...prev,
    title: patch.title != null ? String(patch.title) : prev.title,
    body: patch.body != null ? String(patch.body) : prev.body,
    reservedSlug: patch.reservedSlug != null ? String(patch.reservedSlug) : prev.reservedSlug,
    author: patch.author != null ? String(patch.author) : prev.author,
    promptId: patch.promptId != null ? String(patch.promptId) || undefined : prev.promptId,
    updatedAt: now,
  };
  const drafts = store.drafts.slice();
  drafts[index] = next;
  writeStore(storage, { ...store, activeId: next.id, drafts });
  return next;
}

export function deleteWriteDraft(storage: DraftStorage, id: string): WriteDraft | null {
  const store = readStore(storage);
  const drafts = store.drafts.filter((d) => d.id !== id);
  const activeId = store.activeId === id ? drafts[0]?.id || "" : store.activeId;
  writeStore(storage, { version: 1, activeId, drafts });
  return drafts.find((d) => d.id === activeId) || null;
}

export function peekResumableDraft(storage: DraftStorage): ResumableDraft | null {
  const drafts = listWriteDrafts(storage).filter((d) => !isDraftEmpty(d));
  if (!drafts.length) return null;
  const active = getActiveDraft(storage);
  const pick = active && !isDraftEmpty(active) ? active : drafts[0];
  return {
    id: pick.id,
    label: draftLabel(pick),
    words: wordCount(pick.body),
    updatedAt: pick.updatedAt,
  };
}
