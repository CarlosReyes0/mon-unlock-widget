/** Turn one document into a free preview + paid body. Writers do not fill two boxes. */

const TEASER_SOFT_MAX = 280;

export function slugFromTitle(title: string): string {
  let slug = String(title || "")
    .trim()
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

function firstChunk(text: string): string {
  const t = text.trim();
  if (t.length <= TEASER_SOFT_MAX) return t;
  const cut = t.lastIndexOf(" ", TEASER_SOFT_MAX);
  return t.slice(0, cut > 80 ? cut : TEASER_SOFT_MAX).trim();
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

  const sep = text.search(/^---\s*$/m);
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
