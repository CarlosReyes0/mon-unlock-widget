/**
 * Short-lived reader session.
 *
 * The reader signs one EIP-191 message (domain, address, issued-at, expiry).
 * The server checks that signature and returns an HMAC token. Read endpoints
 * accept the token; they do not trust a bare wallet address.
 *
 * Message text and the token payload must match server/reader-session.mjs.
 * The Railway server cannot import this TypeScript. The article-body edge
 * function imports this file and verifies tokens with the same secret.
 */

export const READER_SESSION_PREFIX = "Open Paywall reader v1";
export const READER_SESSION_TTL_SEC = 60 * 60;
export const READER_SESSION_HEADER = "X-Reader-Session";

const DOMAIN_RE = /^[a-z0-9.-]+(?::\d{1,5})?$/;
const ADDRESS_RE = /^0x[a-f0-9]{40}$/;

export type ReaderSessionFields = {
  domain: string;
  address: string;
  issuedAt: number;
  expiresAt: number;
};

export type ReaderSessionClaims = ReaderSessionFields & {
  token?: string;
};

function asText(value: unknown): string {
  if (value == null) return "";
  return String(value);
}

/** Host the session is good for, lowercase, optional port. */
export function normalizeSessionDomain(value: unknown): string {
  return asText(value).trim().toLowerCase();
}

export function normalizeSessionAddress(value: unknown): string {
  const address = asText(value).trim().toLowerCase();
  return ADDRESS_RE.test(address) ? address : "";
}

function asUnix(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    const n = Number(value.trim());
    return Number.isSafeInteger(n) ? n : null;
  }
  return null;
}

export function readerSessionPayloadJson(fields: ReaderSessionFields): string {
  return `{"v":1,"addr":"${fields.address}","dom":"${fields.domain}","iat":${fields.issuedAt},"exp":${fields.expiresAt}}`;
}

/** What the wallet signs. Do not reorder lines. */
export function buildReaderSessionMessage(input: {
  domain: unknown;
  address: unknown;
  issuedAt: unknown;
  expiresAt: unknown;
}): string {
  const domain = normalizeSessionDomain(input.domain);
  const address = normalizeSessionAddress(input.address);
  const issuedAt = asUnix(input.issuedAt);
  const expiresAt = asUnix(input.expiresAt);
  return [
    READER_SESSION_PREFIX,
    `domain:${domain}`,
    `address:${address}`,
    `issuedAt:${issuedAt ?? ""}`,
    `expiresAt:${expiresAt ?? ""}`,
  ].join("\n");
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array | null {
  if (!value || /[^A-Za-z0-9_-]/.test(value)) return null;
  const pad = value.length % 4 === 0 ? "" : "=".repeat(4 - (value.length % 4));
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/") + pad;
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

async function hmacSha256(secret: string, payload: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return new Uint8Array(sig);
}

export async function signReaderSessionToken(
  fields: ReaderSessionFields,
  secret: string
): Promise<string> {
  const body = bytesToBase64Url(new TextEncoder().encode(readerSessionPayloadJson(fields)));
  const mac = await hmacSha256(secret, body);
  return `${body}.${bytesToBase64Url(mac)}`;
}

export async function verifyReaderSessionToken(
  token: string,
  secret: string,
  opts: { nowMs?: number; expectedDomain?: string } = {}
): Promise<ReaderSessionFields | null> {
  const key = secret.trim();
  if (!key) return null;
  const raw = String(token || "").trim();
  const parts = raw.split(".");
  if (parts.length !== 2) return null;
  const [body, mac] = parts;
  if (!body || !mac) return null;
  const expected = await hmacSha256(key, body);
  const got = base64UrlToBytes(mac);
  if (!got || !bytesEqual(expected, got)) return null;
  const jsonBytes = base64UrlToBytes(body);
  if (!jsonBytes) return null;
  let parsed: { v?: unknown; addr?: unknown; dom?: unknown; iat?: unknown; exp?: unknown };
  try {
    parsed = JSON.parse(new TextDecoder().decode(jsonBytes));
  } catch {
    return null;
  }
  if (parsed?.v !== 1) return null;
  const address = normalizeSessionAddress(parsed.addr);
  const domain = normalizeSessionDomain(parsed.dom);
  const issuedAt = asUnix(parsed.iat);
  const expiresAt = asUnix(parsed.exp);
  if (!address || !DOMAIN_RE.test(domain) || issuedAt == null || expiresAt == null) return null;
  if (readerSessionPayloadJson({ address, domain, issuedAt, expiresAt }) !== new TextDecoder().decode(jsonBytes)) {
    return null;
  }
  const nowSec = Math.floor((opts.nowMs ?? Date.now()) / 1000);
  if (expiresAt <= nowSec) return null;
  if (expiresAt - issuedAt > READER_SESSION_TTL_SEC || expiresAt <= issuedAt) return null;
  if (opts.expectedDomain) {
    const want = normalizeSessionDomain(opts.expectedDomain);
    if (!want || want !== domain) return null;
  }
  return { address, domain, issuedAt, expiresAt };
}

const STORAGE_PREFIX = "op_reader_session:";

export function readerSessionStorageKey(domain: string, address: string): string {
  return `${STORAGE_PREFIX}${normalizeSessionDomain(domain)}:${normalizeSessionAddress(address)}`;
}

type SessionStorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export function readStoredReaderSession(
  storage: SessionStorageLike | null | undefined,
  domain: string,
  address: string,
  nowSec = Math.floor(Date.now() / 1000)
): ReaderSessionClaims | null {
  if (!storage) return null;
  const key = readerSessionStorageKey(domain, address);
  let raw = "";
  try {
    raw = storage.getItem(key) || "";
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { token?: unknown; expiresAt?: unknown; address?: unknown; domain?: unknown };
    const token = typeof parsed.token === "string" ? parsed.token : "";
    const expiresAt = asUnix(parsed.expiresAt);
    if (!token || expiresAt == null || expiresAt <= nowSec + 30) return null;
    if (normalizeSessionAddress(parsed.address) !== normalizeSessionAddress(address)) return null;
    if (normalizeSessionDomain(parsed.domain) !== normalizeSessionDomain(domain)) return null;
    return {
      token,
      address: normalizeSessionAddress(address),
      domain: normalizeSessionDomain(domain),
      issuedAt: 0,
      expiresAt,
    };
  } catch {
    return null;
  }
}

export function writeStoredReaderSession(
  storage: SessionStorageLike | null | undefined,
  session: ReaderSessionClaims & { token: string }
): void {
  if (!storage || !session.token) return;
  try {
    storage.setItem(
      readerSessionStorageKey(session.domain, session.address),
      JSON.stringify({
        token: session.token,
        address: session.address,
        domain: session.domain,
        expiresAt: session.expiresAt,
      })
    );
  } catch {
    /* private mode / quota */
  }
}

/**
 * Reuse a stored token or sign once and exchange it for a server session.
 * `signMessage` is the wallet's personal_sign. Card readers never call this.
 */
export async function establishReaderSession(input: {
  address: string;
  domain: string;
  signMessage: (message: string) => Promise<string>;
  sessionUrl: string;
  storage?: SessionStorageLike | null;
  nowSec?: number;
  fetchImpl?: typeof fetch;
}): Promise<{ token: string; address: string; expiresAt: number; domain: string }> {
  const domain = normalizeSessionDomain(input.domain);
  const address = normalizeSessionAddress(input.address);
  if (!domain || !address) throw new Error("invalid_reader_session");
  const nowSec = input.nowSec ?? Math.floor(Date.now() / 1000);
  const stored = readStoredReaderSession(input.storage, domain, address, nowSec);
  if (stored?.token) {
    return {
      token: stored.token,
      address,
      domain,
      expiresAt: stored.expiresAt,
    };
  }
  const issuedAt = nowSec;
  const expiresAt = nowSec + READER_SESSION_TTL_SEC;
  const message = buildReaderSessionMessage({ domain, address, issuedAt, expiresAt });
  const signature = await input.signMessage(message);
  const fetchImpl = input.fetchImpl ?? fetch;
  const res = await fetchImpl(input.sessionUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address, issuedAt, expiresAt, signature }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    token?: string;
    expiresAt?: number;
    error?: string;
  };
  if (!res.ok || !data.token) {
    throw new Error(data.error || "reader_session_failed");
  }
  const session = {
    token: data.token,
    address,
    domain,
    expiresAt: asUnix(data.expiresAt) ?? expiresAt,
  };
  writeStoredReaderSession(input.storage, session);
  return session;
}
