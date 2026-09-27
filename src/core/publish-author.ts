/** Byline stored with a Write publish. Never invent a placeholder name. */

export const PUBLISH_AUTHOR_MAX = 120;

export type PrivyDisplayNameSource = {
  email?: { address?: string | null } | null;
  google?: { name?: string | null; email?: string | null } | null;
  twitter?: { name?: string | null; username?: string | null } | null;
  discord?: { username?: string | null; email?: string | null } | null;
  github?: { name?: string | null; username?: string | null; email?: string | null } | null;
  linkedin?: { name?: string | null; email?: string | null } | null;
  apple?: { email?: string | null } | null;
  farcaster?: { displayName?: string | null; username?: string | null } | null;
  telegram?: { firstName?: string | null; lastName?: string | null; username?: string | null } | null;
  spotify?: { name?: string | null; email?: string | null } | null;
  tiktok?: { name?: string | null; username?: string | null } | null;
  line?: { name?: string | null; email?: string | null } | null;
  instagram?: { username?: string | null } | null;
  twitch?: { username?: string | null } | null;
} | null | undefined;

function clean(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
}

function first(...values: string[]): string {
  for (const value of values) {
    if (value) return value;
  }
  return "";
}

/** Local-part of an email, as a byline. Apple Hide My Email stays blank. */
export function nameFromEmail(email: unknown): string {
  const raw = clean(email);
  const at = raw.lastIndexOf("@");
  if (at <= 0) return "";
  const domain = raw.slice(at + 1);
  if (/privaterelay\.appleid\.com$/i.test(domain)) return "";
  const local = (raw.slice(0, at).split("+")[0] ?? "").trim();
  if (!local) return "";
  const parts = local.split(/[._-]+/).filter(Boolean);
  const words = parts.length >= 2 && parts.every((part) => /^[A-Za-z]{2,}$/.test(part));
  if (!words) return local.slice(0, PUBLISH_AUTHOR_MAX);
  return parts
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ")
    .slice(0, PUBLISH_AUTHOR_MAX);
}

function asName(value: unknown): string {
  const text = clean(value);
  if (!text) return "";
  if (text.includes("@")) return nameFromEmail(text);
  return text;
}

function handle(value: unknown): string {
  return clean(value).replace(/^@+/, "");
}

function telegramName(
  telegram: { firstName?: string | null; lastName?: string | null } | null | undefined
): string {
  if (!telegram) return "";
  return clean([clean(telegram.firstName), clean(telegram.lastName)].filter(Boolean).join(" "));
}

/**
 * Display name from a Privy user. Profile names, then an email name, then a
 * username. Wallet-only sessions return "" so Write can ask for a name.
 */
export function displayNameFromPrivyUser(user: PrivyDisplayNameSource): string {
  if (!user) return "";
  const named = first(
    asName(user.google?.name),
    asName(user.linkedin?.name),
    asName(user.github?.name),
    asName(user.twitter?.name),
    asName(user.farcaster?.displayName),
    telegramName(user.telegram),
    asName(user.line?.name),
    asName(user.tiktok?.name),
    asName(user.spotify?.name)
  );
  const email = first(
    nameFromEmail(user.email?.address),
    nameFromEmail(user.google?.email),
    nameFromEmail(user.github?.email),
    nameFromEmail(user.linkedin?.email),
    nameFromEmail(user.discord?.email),
    nameFromEmail(user.line?.email),
    nameFromEmail(user.spotify?.email),
    nameFromEmail(user.apple?.email)
  );
  const username = first(
    handle(user.twitter?.username),
    handle(user.farcaster?.username),
    handle(user.github?.username),
    handle(user.discord?.username),
    handle(user.instagram?.username),
    handle(user.tiktok?.username),
    handle(user.twitch?.username),
    handle(user.telegram?.username)
  );
  return (named || email || username).slice(0, PUBLISH_AUTHOR_MAX);
}

/** Trim a writer-supplied byline. Blank stays blank — no placeholder. */
export function publishAuthor(name: string | null | undefined): string {
  return clean(name).slice(0, PUBLISH_AUTHOR_MAX);
}
