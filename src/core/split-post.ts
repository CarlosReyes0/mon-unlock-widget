/** Turn one document into a free preview + paid body. Writers do not fill two boxes. */

const TEASER_SOFT_MAX = 280;

/** Invisible format chars that LLMs / paste often append; they make titles look identical. */
const INVISIBLE_TITLE_CHARS = /[\u200B-\u200D\uFEFF\u2060]/g;

export function cleanTitle(title: string): string {
  return String(title || "")
    .replace(INVISIBLE_TITLE_CHARS, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function slugFromTitle(title: string): string {
  let slug = cleanTitle(title)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) return "";
  if (slug.length < 3) slug = `${slug}-post`.replace(/^-+/, "");
  if (slug.length > 64) slug = slug.slice(0, 64).replace(/-+$/, "");
  if (!/^[a-z0-9]/.test(slug)) slug = `a-${slug}`;
  if (!/[a-z0-9]$/.test(slug)) slug = `${slug.replace(/-+$/, "")}0`;
  return slug.slice(0, 64);
}

export function uniqueSlugSuffix(): string {
  const time = Date.now().toString(36);
  const rand = Math.floor(Math.random() * 36 ** 2)
    .toString(36)
    .padStart(2, "0");
  return `${time.slice(-4)}${rand}`.toLowerCase().replace(/[^a-z0-9]/g, "0");
}

/** Title-based slug with a unique suffix so writers never type an article id. */
export function uniqueSlugFromTitle(title: string): string {
  const base = slugFromTitle(title);
  const suffix = uniqueSlugSuffix();
  if (!base) return `post-${suffix}`.slice(0, 64);
  const combined = `${base}-${suffix}`;
  if (combined.length <= 64) return combined;
  const trimBase = base.slice(0, 64 - suffix.length - 1).replace(/-+$/, "");
  return `${trimBase}-${suffix}`;
}

/**
 * Reuse a reserved slug on Publish retry so a failed wallet/sign step
 * does not mint a second listed copy of the same piece.
 */
export function nextPublishSlug(input: {
  title: string;
  preferredSlug?: string | null;
  attempt?: number;
}): string {
  const attempt = input.attempt ?? 0;
  const preferred = String(input.preferredSlug || "").trim();
  if (attempt === 0 && preferred) return preferred;
  return uniqueSlugFromTitle(input.title);
}

/**
 * Do not cut a 280-char preview in the middle of an HTML tag (or leave an
 * unclosed <iframe>/<video>). Broken teaser markup would leak mid-tag URLs
 * and fail to render the free media.
 */
function adjustChunkForHtml(text: string, end: number): number {
  if (end <= 0 || end >= text.length) return end;
  const before = text.slice(0, end);
  const lastLt = before.lastIndexOf("<");
  const lastGt = before.lastIndexOf(">");
  if (lastLt <= lastGt) return end;

  const close = text.indexOf(">", lastLt);
  if (close < 0) return lastLt > 0 ? lastLt : end;

  let next = close + 1;
  const tagMatch = /^<([a-zA-Z][\w:-]*)\b/.exec(text.slice(lastLt));
  const tag = tagMatch?.[1]?.toLowerCase();
  const voidTags = new Set(["img", "br", "hr", "source", "input", "meta", "link"]);
  if (tag && !voidTags.has(tag) && !text.slice(lastLt, close + 1).endsWith("/>")) {
    const closer = `</${tag}>`;
    const closeIdx = text.toLowerCase().indexOf(closer, close);
    if (closeIdx >= 0 && closeIdx - lastLt < 2500) {
      next = closeIdx + closer.length;
    }
  }
  return next;
}

function firstChunk(text: string): string {
  const t = text.trim();
  if (t.length <= TEASER_SOFT_MAX) return t;
  const cut = t.lastIndexOf(" ", TEASER_SOFT_MAX);
  const end = adjustChunkForHtml(t, cut > 80 ? cut : TEASER_SOFT_MAX);
  return t.slice(0, Math.max(end, 1)).trim();
}

function firstChunkEnd(core: string): number {
  if (core.length <= TEASER_SOFT_MAX) return core.length;
  const cut = core.lastIndexOf(" ", TEASER_SOFT_MAX);
  let end = cut > 80 ? cut : TEASER_SOFT_MAX;
  end = adjustChunkForHtml(core, end);
  if (end <= 0) end = cut > 80 ? cut : TEASER_SOFT_MAX;
  return Math.min(end, core.length);
}

export type PaywallLocation = {
  /** Exclusive end of the free preview in newline-normalized source. */
  freeEnd: number;
  /** Inclusive start of paid text. */
  paidStart: number;
  hasFold: boolean;
};

/**
 * A line that is only `---` (trailing whitespace ignored).
 * `--` and `----` are not a fold — same rule splitPost uses to cut free vs paid.
 */
export function findPaywallFolds(raw: string): { index: number; length: number }[] {
  const text = String(raw ?? "").replace(/\r\n/g, "\n");
  return [...text.matchAll(/^---\s*$/gm)].map((match) => ({
    index: match.index ?? 0,
    length: match[0].length,
  }));
}

/** Index of the first paywall fold, or -1 when the body has no `---` line. */
export function paywallFoldAt(raw: string): number {
  return findPaywallFolds(raw)[0]?.index ?? -1;
}

export function hasPaywallFold(raw: string): boolean {
  return paywallFoldAt(raw) >= 0;
}

/** No writer prose — empty, or only a `---` line. */
export function isPaywallOnlyBody(raw: string): boolean {
  return !String(raw ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .some((line) => {
      const trimmed = line.trim();
      return trimmed.length > 0 && !/^---\s*$/.test(trimmed);
    });
}

/**
 * New and empty Write sessions start with one fold.
 * Drafts that already have writing are left alone so the free/paid cut does not move.
 */
export function seedPaywallFold(raw: string): string {
  const text = String(raw ?? "");
  if (hasPaywallFold(text) || text.trim()) return text;
  return "---";
}

/** Insert one `---` when missing. Existing folds are kept as-is. */
export function ensurePaywallFold(raw: string): string {
  const text = String(raw ?? "").replace(/\r\n/g, "\n");
  if (hasPaywallFold(text)) return text;
  if (!text.trim()) return "---";
  return `${text.replace(/\n+$/, "")}\n\n---\n`;
}

/** Where the Write editor should draw the paywall line — same rules as splitPost. */
export function locatePaywall(raw: string): PaywallLocation {
  const text = String(raw ?? "").replace(/\r\n/g, "\n");
  if (!text.trim()) return { freeEnd: 0, paidStart: 0, hasFold: false };

  const sep = paywallFoldAt(text);
  if (sep >= 0) {
    const nl = text.indexOf("\n", sep);
    const after = nl < 0 ? text.length : nl + 1;
    const teaser = text.slice(0, sep).trim();
    const body = text.slice(after).trim();
    if (teaser && body) return { freeEnd: sep, paidStart: after, hasFold: true };
    if (body) {
      const leading = (text.slice(after).match(/^\s*/) || [""])[0].length;
      const chunk = firstChunkEnd(body);
      const freeEnd = after + leading + chunk;
      return { freeEnd, paidStart: freeEnd, hasFold: chunk < body.length };
    }
    return { freeEnd: text.length, paidStart: text.length, hasFold: false };
  }

  const breakMatch = /\n\s*\n/.exec(text);
  if (breakMatch) {
    const freeEnd = breakMatch.index;
    const gap = text.slice(freeEnd).match(/^\n\s*\n+/);
    const paidStart = freeEnd + (gap ? gap[0].length : 0);
    if (text.slice(paidStart).trim()) return { freeEnd, paidStart, hasFold: true };
  }

  const leading = (text.match(/^\s*/) || [""])[0].length;
  const core = text.trim();
  const chunk = firstChunkEnd(core);
  if (chunk >= core.length) return { freeEnd: text.length, paidStart: text.length, hasFold: false };
  const freeEnd = leading + chunk;
  return { freeEnd, paidStart: freeEnd, hasFold: true };
}

/**
 * One piece → teaser (free) + body (paid).
 * A line that is only `---` is the fold. Otherwise the first paragraph is free.
 */
export function splitPost(raw: string): { teaser: string; body: string } {
  const text = String(raw ?? "")
    .replace(/\r\n/g, "\n")
    .trim();
  if (!text) return { teaser: "", body: "" };

  const sep = paywallFoldAt(text);
  if (sep >= 0) {
    const teaser = text.slice(0, sep).trim();
    const body = text
      .slice(sep)
      .replace(/^---\s*\n?/, "")
      .trim();
    if (teaser && body) return { teaser, body };
    if (body) return { teaser: firstChunk(body), body };
    return { teaser, body: teaser };
  }

  const paras = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paras.length >= 2) {
    return { teaser: paras[0], body: paras.slice(1).join("\n\n") };
  }

  const only = paras[0] || text;
  return { teaser: firstChunk(only), body: only };
}
