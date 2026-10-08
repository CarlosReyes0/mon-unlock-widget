/**
 * Short-lived reader sessions for paid reads.
 *
 * A reader signs "Open Paywall reader v1" once (domain, address, issued-at,
 * expiry). This module checks that EIP-191 signature and returns an HMAC
 * token plus an HttpOnly cookie. Later requests present the token in
 * X-Reader-Session, Authorization: Bearer, or the op_reader cookie.
 *
 * Keep buildReaderSessionMessage / the token payload identical to
 * src/core/reader-session.ts. The edge function verifies the same HMAC.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { recoverMessageAddress } from "viem";
import { normalizeAddress } from "./access.mjs";
import { publicOrigin } from "./article-og.mjs";

export const READER_SESSION_PREFIX = "Open Paywall reader v1";
export const READER_SESSION_TTL_SEC = 60 * 60;
export const READER_SESSION_MIN_TTL_SEC = 60;
export const READER_SESSION_SKEW_SEC = 120;
export const READER_SESSION_COOKIE = "op_reader";
export const READER_SESSION_HEADER = "x-reader-session";

const DOMAIN_RE = /^[a-z0-9.-]+(?::\d{1,5})?$/;

function httpError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function asUnix(value) {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    const n = Number(value.trim());
    return Number.isSafeInteger(n) ? n : null;
  }
  return null;
}

export function normalizeSessionDomain(value) {
  return String(value || "").trim().toLowerCase();
}

export function readerSessionPayloadJson(fields) {
  return `{"v":1,"addr":"${fields.address}","dom":"${fields.domain}","iat":${fields.issuedAt},"exp":${fields.expiresAt}}`;
}

/**
 * @param {{ domain: unknown, address: unknown, issuedAt: unknown, expiresAt: unknown }} input
 */
export function buildReaderSessionMessage(input) {
  const domain = normalizeSessionDomain(input.domain);
  const address = normalizeAddress(input.address);
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

export function sessionSecret() {
  const dedicated = String(process.env.READER_SESSION_SECRET || "").trim();
  if (dedicated) return dedicated;
  return String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
}

export function signReaderSessionToken(fields, secret) {
  const body = Buffer.from(readerSessionPayloadJson(fields), "utf8").toString("base64url");
  const mac = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${mac}`;
}

/**
 * @returns {{ address: string, domain: string, issuedAt: number, expiresAt: number } | null}
 */
export function verifyReaderSessionToken(token, secret, opts = {}) {
  const key = String(secret || "").trim();
  if (!key) return null;
  const raw = String(token || "").trim();
  const parts = raw.split(".");
  if (parts.length !== 2) return null;
  const [body, mac] = parts;
  if (!body || !mac) return null;
  const expected = createHmac("sha256", key).update(body).digest();
  let got;
  try {
    got = Buffer.from(mac, "base64url");
  } catch {
    return null;
  }
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (parsed?.v !== 1) return null;
  const address = normalizeAddress(parsed.addr);
  const domain = normalizeSessionDomain(parsed.dom);
  const issuedAt = asUnix(parsed.iat);
  const expiresAt = asUnix(parsed.exp);
  if (!address || !DOMAIN_RE.test(domain) || issuedAt == null || expiresAt == null) return null;
  const decoded = Buffer.from(body, "base64url").toString("utf8");
  if (readerSessionPayloadJson({ address, domain, issuedAt, expiresAt }) !== decoded) return null;
  const nowSec = Math.floor((opts.nowMs ?? Date.now()) / 1000);
  if (expiresAt <= nowSec) return null;
  if (expiresAt - issuedAt > READER_SESSION_TTL_SEC || expiresAt <= issuedAt) return null;
  if (opts.expectedDomain) {
    const want = normalizeSessionDomain(opts.expectedDomain);
    if (!want || want !== domain) return null;
  }
  return { address, domain, issuedAt, expiresAt };
}

export function requestDomain(req) {
  try {
    return normalizeSessionDomain(new URL(publicOrigin(req)).host);
  } catch {
    return "";
  }
}

function readCookie(req, name) {
  const raw = String(req?.headers?.cookie || "");
  for (const part of raw.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq) !== name) continue;
    try {
      return decodeURIComponent(trimmed.slice(eq + 1));
    } catch {
      return trimmed.slice(eq + 1);
    }
  }
  return "";
}

/** Header, then a one-dot Bearer token, then the HttpOnly cookie. */
export function readerSessionTokenFromRequest(req) {
  const header = String(req?.headers?.[READER_SESSION_HEADER] || "").trim();
  if (header) return header;
  const auth = String(req?.headers?.authorization || "").trim();
  const bearer = /^Bearer\s+(\S+)$/i.exec(auth);
  if (bearer && bearer[1].split(".").length === 2) return bearer[1];
  return readCookie(req, READER_SESSION_COOKIE);
}

/**
 * @returns {Promise<{ address: string, domain: string, issuedAt: number, expiresAt: number } | null>}
 */
export function resolveRequestReaderSession(req, opts = {}) {
  const token = readerSessionTokenFromRequest(req);
  if (!token) return null;
  const secret = opts.secret ?? sessionSecret();
  if (!secret) throw httpError("reader_session_not_configured", 503);
  const claims = verifyReaderSessionToken(token, secret, {
    nowMs: opts.nowMs,
    expectedDomain: opts.domain ?? requestDomain(req),
  });
  if (!claims) throw httpError("invalid_reader_session", 401);
  return claims;
}

/**
 * A query-string wallet is not proof. Fiat sessions stay valid on their own.
 * @param {{ queryReader?: unknown, session?: { address: string } | null, fiatSession?: string }} input
 * @returns {string} authenticated reader, or ""
 */
export function gateWalletReader(input) {
  const queryReader = normalizeAddress(input.queryReader);
  const sessionAddress = input.session?.address || "";
  const fiatSession = String(input.fiatSession || "").trim();
  if (queryReader && sessionAddress && queryReader !== sessionAddress) {
    throw httpError("reader_mismatch", 403);
  }
  if (queryReader && !sessionAddress && !fiatSession) {
    throw httpError("reader_session_required", 401);
  }
  return sessionAddress;
}

function canonicalFields(input, nowSec) {
  const domain = normalizeSessionDomain(input.domain);
  const address = normalizeAddress(input.address);
  const issuedAt = asUnix(input.issuedAt);
  const expiresAt = asUnix(input.expiresAt);
  if (!DOMAIN_RE.test(domain)) throw httpError("invalid_domain");
  if (!address) throw httpError("invalid_reader");
  if (issuedAt == null || expiresAt == null) throw httpError("invalid_session_window");
  if (issuedAt > nowSec + READER_SESSION_SKEW_SEC) throw httpError("invalid_session_window");
  if (expiresAt <= nowSec) throw httpError("invalid_session_window");
  if (expiresAt <= issuedAt) throw httpError("invalid_session_window");
  const ttl = expiresAt - issuedAt;
  if (ttl < READER_SESSION_MIN_TTL_SEC || ttl > READER_SESSION_TTL_SEC) {
    throw httpError("invalid_session_window");
  }
  return { domain, address, issuedAt, expiresAt };
}

export async function issueReaderSession(input, opts = {}) {
  const nowSec = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const fields = canonicalFields(input, nowSec);
  const message = buildReaderSessionMessage(fields);
  const signature = typeof input.signature === "string" ? input.signature.trim() : "";
  if (!signature) throw httpError("invalid_reader_session", 401);
  let recovered = "";
  try {
    recovered = await recoverMessageAddress({ message, signature });
  } catch {
    throw httpError("invalid_reader_session", 401);
  }
  if (String(recovered || "").toLowerCase() !== fields.address) {
    throw httpError("reader_mismatch", 403);
  }
  const secret = opts.secret ?? sessionSecret();
  if (!secret) throw httpError("reader_session_not_configured", 503);
  const token = signReaderSessionToken(fields, secret);
  return { token, ...fields };
}

export function readerSessionCookie(token, expiresAt, { secure = false, nowSec = Math.floor(Date.now() / 1000) } = {}) {
  const maxAge = Math.max(0, expiresAt - nowSec);
  const parts = [
    `${READER_SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}
