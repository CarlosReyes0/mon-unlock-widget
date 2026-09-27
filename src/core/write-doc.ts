/**
 * The Write draft as blocks: paragraphs, pictures, players, and an optional paywall line.
 * Serialized text stays compatible with splitPost (blank line = new paragraph, `---` = the fold).
 */
import { trustedEmbedSrc } from "./body-content.js";
import { buildMediaSnippet, normalizeUrl, type MediaKind } from "./media-url.js";
import { findPaywallFolds } from "./split-post.js";

export type WriteTextBlock = { id: string; type: "text"; text: string };
export type WriteMediaBlock = {
  id: string;
  type: "media";
  kind: MediaKind;
  url: string;
  alt: string;
};
export type WriteFoldBlock = { id: string; type: "fold" };
export type WriteBlock = WriteTextBlock | WriteMediaBlock | WriteFoldBlock;

const TAG_RE =
  /<img\b[^>]*>|<video\b[^>]*>[\s\S]*?<\/video>|<audio\b[^>]*>[\s\S]*?<\/audio>|<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi;

let idSeq = 0;

export function newWriteBlockId(): string {
  idSeq += 1;
  return `w${idSeq.toString(36)}${Math.floor(Math.random() * 36 ** 3)
    .toString(36)
    .padStart(3, "0")}`;
}

function unescapeAttr(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function attr(tag: string, name: string): string {
  const re = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i");
  const match = re.exec(tag);
  return unescapeAttr(match?.[1] ?? match?.[2] ?? "");
}

function kindFromTag(tag: string): MediaKind {
  const name = tag.trim().slice(1, 6).toLowerCase();
  if (name.startsWith("video")) return "video";
  if (name.startsWith("audio")) return "audio";
  if (name.startsWith("ifram")) return "embed";
  return "image";
}

export function captionFromAlt(alt: string): string {
  const text = alt.trim();
  if (!text || text === "Describe image" || text === "Photo") return "";
  return text;
}

export function mediaBlockFromTag(tag: string, id: string): WriteMediaBlock | null {
  const url = normalizeUrl(attr(tag, "src"));
  if (!url) return null;
  const kind = kindFromTag(tag);
  if (kind === "embed" && !trustedEmbedSrc(url)) return null;
  return {
    id,
    type: "media",
    kind,
    url,
    alt: kind === "image" ? captionFromAlt(attr(tag, "alt")) : "",
  };
}

function pushText(blocks: WriteBlock[], raw: string, nextId: () => string) {
  const trimmed = raw.replace(/^\n+|\n+$/g, "");
  if (!trimmed.trim()) return;
  const parts = trimmed.split(/\n[ \t]*\n/);
  for (const part of parts) {
    const text = part.replace(/^\n+|\n+$/g, "");
    if (!text.trim()) continue;
    blocks.push({ id: nextId(), type: "text", text });
  }
}

export function parseWriteDoc(raw: string): WriteBlock[] {
  const text = String(raw ?? "").replace(/\r\n/g, "\n");
  const marks: { index: number; length: number; fold: boolean; raw: string }[] = [];
  for (const match of text.matchAll(TAG_RE)) {
    marks.push({
      index: match.index ?? 0,
      length: match[0].length,
      fold: false,
      raw: match[0],
    });
  }
  for (const match of findPaywallFolds(text)) {
    marks.push({
      index: match.index,
      length: match.length,
      fold: true,
      raw: text.slice(match.index, match.index + match.length),
    });
  }
  marks.sort((a, b) => a.index - b.index || a.length - b.length);

  const blocks: WriteBlock[] = [];
  let n = 0;
  const nextId = () => {
    n += 1;
    return `p${n}`;
  };
  let cursor = 0;
  for (const mark of marks) {
    if (mark.index < cursor) continue;
    pushText(blocks, text.slice(cursor, mark.index), nextId);
    if (mark.fold) {
      blocks.push({ id: nextId(), type: "fold" });
    } else {
      const media = mediaBlockFromTag(mark.raw, nextId());
      if (media) blocks.push(media);
      else pushText(blocks, mark.raw, nextId);
    }
    cursor = mark.index + mark.length;
  }
  pushText(blocks, text.slice(cursor), nextId);
  const foldAt = blocks.findIndex((block) => block.type === "fold");
  if (foldAt >= 0) {
    const hasTextBefore = blocks.slice(0, foldAt).some((block) => block.type === "text");
    const hasTextAfter = blocks.slice(foldAt + 1).some((block) => block.type === "text");
    if (!hasTextBefore) blocks.splice(foldAt, 0, { id: nextId(), type: "text", text: "" });
    if (!hasTextAfter) blocks.push({ id: nextId(), type: "text", text: "" });
  } else if (!blocks.some((block) => block.type === "text")) {
    blocks.push({ id: nextId(), type: "text", text: "" });
  }
  return blocks;
}

export function contentBlocks(blocks: WriteBlock[]): WriteBlock[] {
  return blocks.filter((block) => block.type !== "fold");
}

/** Index in the content list (fold omitted) where an explicit `---` sits. */
export function explicitFoldIndex(blocks: WriteBlock[]): number | null {
  const at = blocks.findIndex((block) => block.type === "fold");
  if (at < 0) return null;
  return blocks.slice(0, at).filter((block) => block.type !== "fold").length;
}

function isFilled(block: WriteBlock): boolean {
  return block.type !== "text" || block.text.trim().length > 0;
}

/**
 * Where to draw the line. An explicit `---` wins. Otherwise it sits before the
 * second paragraph or player, matching splitPost's first-paragraph rule.
 */
export function visibleFoldIndex(blocks: WriteBlock[]): number | null {
  const explicit = explicitFoldIndex(blocks);
  if (explicit != null) {
    const content = contentBlocks(blocks);
    if (explicit <= 0 || explicit >= content.length) return null;
    return explicit;
  }
  const content = contentBlocks(blocks);
  let seen = 0;
  for (let i = 0; i < content.length; i += 1) {
    if (!isFilled(content[i])) continue;
    seen += 1;
    if (seen === 2) return i;
  }
  return null;
}

export function serializeWriteDoc(blocks: WriteBlock[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.type === "text") {
      const text = block.text.replace(/^\n+|\n+$/g, "").trim();
      if (text) parts.push(text);
      continue;
    }
    if (block.type === "fold") {
      parts.push("---");
      continue;
    }
    const snippet = buildMediaSnippet(block.url, block.kind, block.alt || undefined).trim();
    if (snippet) parts.push(snippet);
  }
  return parts.join("\n\n");
}

export type PaywallCaret = { id: string; cursor: number };

function withTextAroundFold(blocks: WriteBlock[]): WriteBlock[] {
  const next = blocks.slice();
  const foldAt = next.findIndex((block) => block.type === "fold");
  if (foldAt < 0) return next;
  if (!next.slice(0, foldAt).some((block) => block.type === "text")) {
    next.splice(foldAt, 0, { id: newWriteBlockId(), type: "text", text: "" });
  }
  const at = next.findIndex((block) => block.type === "fold");
  if (!next.slice(at + 1).some((block) => block.type === "text")) {
    next.push({ id: newWriteBlockId(), type: "text", text: "" });
  }
  return next;
}

/** Put one `---` at a content index, including the ends, and keep a text block on each side. */
function insertFoldAtContentIndex(blocks: WriteBlock[], contentIndex: number): WriteBlock[] {
  const content = contentBlocks(blocks);
  const index = Math.max(0, Math.min(contentIndex, content.length));
  const next = content.slice();
  next.splice(index, 0, { id: newWriteBlockId(), type: "fold" });
  return withTextAroundFold(next);
}

/**
 * Insert one paywall fold. A cursor in the middle of a paragraph splits there.
 * A cursor between paragraphs uses that boundary. Otherwise the fold sits where
 * the editor already draws the free/paid line, or after the only paragraph.
 * A second call does nothing.
 */
export function insertPaywallFold(
  blocks: WriteBlock[],
  caret: PaywallCaret | null
): { blocks: WriteBlock[]; focusId: string | null; cursor: number } {
  if (blocks.some((block) => block.type === "fold")) {
    return { blocks, focusId: null, cursor: 0 };
  }
  const content = contentBlocks(blocks);
  if (!content.some(isFilled)) {
    const next = parseWriteDoc("---");
    const first = next.find((block) => block.type === "text");
    return { blocks: next, focusId: first?.id ?? null, cursor: 0 };
  }

  if (caret) {
    const block = blocks.find((item) => item.id === caret.id);
    if (block?.type === "text") {
      const cursor = Math.max(0, Math.min(caret.cursor, block.text.length));
      const contentIndex = content.findIndex((item) => item.id === block.id);
      // A caret in the middle of a paragraph is an explicit "fold goes here".
      if (cursor > 0 && cursor < block.text.length) {
        const split = splitTextBlock(blocks, block.id, cursor);
        const at = split.blocks.findIndex((item) => item.id === split.focusId);
        const next = split.blocks.slice();
        next.splice(at, 0, { id: newWriteBlockId(), type: "fold" });
        return { blocks: withTextAroundFold(next), focusId: split.focusId, cursor: 0 };
      }
      // Caret on a boundary between blocks (start of a later paragraph, or end of one that
      // still has writing after it). The end of the last paragraph is not a placement:
      // that is just where typing stopped, so the free/paid line below wins.
      const betweenBlocks =
        contentIndex > 0 && cursor === 0
          ? contentIndex
          : contentIndex >= 0 && cursor === block.text.length && contentIndex < content.length - 1
            ? contentIndex + 1
            : null;
      if (betweenBlocks != null) {
        const next = insertFoldAtContentIndex(blocks, betweenBlocks);
        const foldAt = next.findIndex((item) => item.type === "fold");
        const focus = next.slice(foldAt + 1).find((item) => item.type === "text");
        return { blocks: next, focusId: focus?.id ?? null, cursor: 0 };
      }
    }
  }

  const auto = visibleFoldIndex(blocks);
  if (auto != null) {
    const placed = placeFold(blocks, auto);
    if (placed.some((block) => block.type === "fold")) {
      const foldAt = placed.findIndex((item) => item.type === "fold");
      const focus = placed.slice(foldAt + 1).find((item) => item.type === "text");
      return { blocks: withTextAroundFold(placed), focusId: focus?.id ?? null, cursor: 0 };
    }
  }

  const next = insertFoldAtContentIndex(blocks, content.length);
  const foldAt = next.findIndex((item) => item.type === "fold");
  const focus = next.slice(foldAt + 1).find((item) => item.type === "text");
  return { blocks: next, focusId: focus?.id ?? null, cursor: 0 };
}

export function removeFold(blocks: WriteBlock[]): WriteBlock[] {
  const next: WriteBlock[] = [];
  for (const block of blocks) {
    if (block.type === "fold") continue;
    next.push(block);
  }
  while (next.length > 1 && next[0].type === "text" && !next[0].text.trim()) next.shift();
  while (next.length > 1) {
    const last = next[next.length - 1];
    if (last.type !== "text" || last.text.trim()) break;
    next.pop();
  }
  if (!next.some((block) => block.type === "text")) {
    next.push({ id: newWriteBlockId(), type: "text", text: "" });
  }
  return next;
}

export function placeFold(blocks: WriteBlock[], contentIndex: number): WriteBlock[] {
  const content = contentBlocks(blocks);
  if (contentIndex <= 0 || contentIndex >= content.length) return blocks;
  const before = content.slice(0, contentIndex).some(isFilled);
  const after = content.slice(contentIndex).some(isFilled);
  if (!before || !after) return blocks;
  const next = content.slice();
  next.splice(contentIndex, 0, { id: newWriteBlockId(), type: "fold" });
  return next;
}

export function insertBlockBefore(
  blocks: WriteBlock[],
  block: WriteBlock,
  beforeId: string | null
): WriteBlock[] {
  if (!beforeId) return [...blocks, block];
  const at = blocks.findIndex((item) => item.id === beforeId);
  if (at < 0) return [...blocks, block];
  const next = blocks.slice();
  next.splice(at, 0, block);
  return next;
}

export function moveBlockBefore(
  blocks: WriteBlock[],
  id: string,
  beforeId: string | null
): WriteBlock[] {
  const from = blocks.findIndex((block) => block.id === id);
  if (from < 0 || blocks[from].type !== "media" || id === beforeId) return blocks;
  const next = blocks.slice();
  const [item] = next.splice(from, 1);
  if (!beforeId) {
    next.push(item);
    return next;
  }
  const to = next.findIndex((block) => block.id === beforeId);
  if (to < 0) next.push(item);
  else next.splice(to, 0, item);
  return next;
}

export function removeBlock(blocks: WriteBlock[], id: string): WriteBlock[] {
  const next = blocks.filter((block) => block.id !== id);
  if (!next.some((block) => block.type === "text")) {
    next.push({ id: newWriteBlockId(), type: "text", text: "" });
  }
  return next;
}

export function updateText(blocks: WriteBlock[], id: string, text: string): WriteBlock[] {
  return blocks.map((block) => (block.id === id && block.type === "text" ? { ...block, text } : block));
}

export function updateCaption(blocks: WriteBlock[], id: string, alt: string): WriteBlock[] {
  return blocks.map((block) => (block.id === id && block.type === "media" ? { ...block, alt } : block));
}

export function splitTextBlock(
  blocks: WriteBlock[],
  id: string,
  at: number
): { blocks: WriteBlock[]; focusId: string } {
  const index = blocks.findIndex((block) => block.id === id);
  const block = blocks[index];
  if (!block || block.type !== "text") return { blocks, focusId: id };
  const focusId = newWriteBlockId();
  const next = blocks.slice();
  next.splice(
    index,
    1,
    { ...block, text: block.text.slice(0, at) },
    { id: focusId, type: "text", text: block.text.slice(at) }
  );
  return { blocks: next, focusId };
}

export function mergeBackward(
  blocks: WriteBlock[],
  id: string
): { blocks: WriteBlock[]; focusId: string; cursor: number } | null {
  const index = blocks.findIndex((block) => block.id === id);
  if (index <= 0) return null;
  const current = blocks[index];
  if (!current || current.type !== "text") return null;
  const previous = blocks[index - 1];
  if (previous.type === "text") {
    const cursor = previous.text.length;
    const next = blocks.slice();
    next.splice(index - 1, 2, { ...previous, text: previous.text + current.text });
    return { blocks: next, focusId: previous.id, cursor };
  }
  const next = blocks.slice();
  next.splice(index - 1, 1);
  return { blocks: next, focusId: current.id, cursor: 0 };
}
