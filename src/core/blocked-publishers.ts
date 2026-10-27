/**
 * Publisher denylist shared by Supabase edge functions.
 * The list is BLOCKED_PUBLISHERS in the function env (comma-separated).
 * Empty or unset blocks nobody. The server copy is server/blocked-publishers.mjs.
 * Keep the parse rules identical.
 */

const ADDRESS = /^0x[a-f0-9]{40}$/;

/** Lowercased 0x addresses. Blank entries and anything that is not an address are ignored. */
export function parseBlockedPublishers(raw: string | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of String(raw ?? "").split(",")) {
    const addr = part.trim().toLowerCase();
    if (!ADDRESS.test(addr) || seen.has(addr)) continue;
    seen.add(addr);
    out.push(addr);
  }
  return out;
}

export function isBlockedPublisher(address: unknown, raw: string | null | undefined): boolean {
  const norm = String(address ?? "").trim().toLowerCase();
  if (!ADDRESS.test(norm)) return false;
  return parseBlockedPublishers(raw).includes(norm);
}
