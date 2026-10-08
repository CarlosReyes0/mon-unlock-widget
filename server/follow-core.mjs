/**
 * Pure helpers for free per-writer follow.
 * Message text matches src/core/publish-auth.ts — do not reorder lines.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { normalizeListingTitle } from "./listings.mjs";
import { plainText } from "./article-og.mjs";

export const FOLLOWER_AUTH_PREFIX = "Open Paywall follower v1";
export const FOLLOWERS_EXPORT_AUTH_PREFIX = "Open Paywall followers export v1";
export const MONAD_CHAIN_ID = 143;
export const CONSENT_VERSION = "follow-v1";
export const CONFIRM_TTL_MS = 48 * 60 * 60 * 1000;
export const FOLLOWER_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const ISSUED_AT_WINDOW_MS = 10 * 60 * 1000;
export const TITLE_DEDUPE_MS = 7 * 24 * 60 * 60 * 1000;
export const CONFIRM_RESEND_MS = 10 * 60 * 1000;
export const CONFIRM_DAILY_LIMIT = 3;
export const DAY_MS = 24 * 60 * 60 * 1000;
export const HOUR_MS = 60 * 60 * 1000;

const VIA = new Set(["feed", "article", "post_unlock", "writer_page"]);
const FOLLOW_ORIGINS = new Set([
  "openpaywall.app",
  "www.openpaywall.app",
  "localhost",
  "127.0.0.1",
]);

export function normalizeWallet(value) {
  if (typeof value !== "string") return "";
  const wallet = value.trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(wallet) ? wallet : "";
}

export function normalizeEmail(value) {
  if (typeof value !== "string") return "";
  const email = value.trim().toLowerCase();
  if (email.length > 254) return "";
  if (!/^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/.test(email)) return "";
  return email;
}

export function normalizeVia(value) {
  const via = String(value || "").trim();
  return VIA.has(via) ? via : null;
}

export function shortWallet(wallet) {
  const w = normalizeWallet(wallet);
  if (!w) return "";
  return `${w.slice(0, 6)}…${w.slice(-4)}`;
}

export function followerCountLabel(count) {
  const n = Number(count) || 0;
  return n === 1 ? "1 follower" : `${n} followers`;
}

export function buildFollowerAuthMessage({ wallet, origin, issuedAt }) {
  return [
    FOLLOWER_AUTH_PREFIX,
    `chain:${MONAD_CHAIN_ID}`,
    `wallet:${String(wallet || "").trim().toLowerCase()}`,
    `origin:${String(origin || "").trim().toLowerCase()}`,
    `issuedAt:${String(issuedAt || "").trim()}`,
  ].join("\n");
}

export function buildFollowersExportAuthMessage({ writer, issuedAt }) {
  return [
    FOLLOWERS_EXPORT_AUTH_PREFIX,
    `chain:${MONAD_CHAIN_ID}`,
    `writer:${String(writer || "").trim().toLowerCase()}`,
    `issuedAt:${String(issuedAt || "").trim()}`,
  ].join("\n");
}

export function issuedAtFresh(value, now = Date.now()) {
  const raw = String(value || "").trim();
  if (!raw) return false;
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return false;
  return Math.abs(now - t) <= ISSUED_AT_WINDOW_MS;
}

export function originAllowed(origin) {
  return FOLLOW_ORIGINS.has(String(origin || "").trim().toLowerCase());
}

export function sha256Hex(text) {
  return createHash("sha256").update(String(text)).digest("hex");
}

export function hashIp(ip, secret) {
  return sha256Hex(`${String(ip || "")}${String(secret || "")}`);
}

/** Constant-time compare. Empty values never match. Same rule as publish-auth. */
export function secretsMatch(provided, expected) {
  const a = String(provided || "").trim();
  const b = String(expected || "").trim();
  if (!a || !b) return false;
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  const len = Math.max(aa.length, bb.length);
  let diff = aa.length ^ bb.length;
  for (let i = 0; i < len; i++) {
    diff |= (aa[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

export function headerSecret(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") return String(headers.get(name) || "");
  const lower = String(name || "").toLowerCase();
  const value = headers[lower] ?? headers[name];
  if (Array.isArray(value)) return String(value[0] || "");
  return String(value || "");
}

export function requestHasHeaderSecret(headers, expectedSecret, headerName) {
  return secretsMatch(headerSecret(headers, headerName), expectedSecret);
}

export function newConfirmToken() {
  return randomBytes(32).toString("base64url");
}

export function unsubscribeToken(followId, secret) {
  const id = String(followId);
  const idPart = Buffer.from(id, "utf8").toString("base64url");
  const mac = createHmac("sha256", String(secret)).update(`unsub:${id}`).digest("base64url");
  return `${idPart}.${mac}`;
}

export function readUnsubscribeToken(token, secret) {
  const raw = String(token || "");
  const dot = raw.indexOf(".");
  if (dot <= 0) return null;
  const idPart = raw.slice(0, dot);
  const mac = raw.slice(dot + 1);
  let id = "";
  try {
    id = Buffer.from(idPart, "base64url").toString("utf8");
  } catch {
    return null;
  }
  if (!/^\d+$/.test(id) || !mac) return null;
  const expected = createHmac("sha256", String(secret)).update(`unsub:${id}`).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;
  return Number(id);
}

export function followerToken({ kind, id, secret, now = Date.now(), ttlMs = FOLLOWER_TOKEN_TTL_MS }) {
  const exp = now + ttlMs;
  const payload = Buffer.from(JSON.stringify({ v: 1, kind, id, exp }), "utf8").toString("base64url");
  const mac = createHmac("sha256", String(secret)).update(`fw:${kind}:${id}:${exp}`).digest("base64url");
  return `${payload}.${mac}`;
}

export function readFollowerToken(token, secret, now = Date.now()) {
  const raw = String(token || "");
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = raw.slice(0, dot);
  const mac = raw.slice(dot + 1);
  let data;
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!data || (data.kind !== "wallet" && data.kind !== "email")) return null;
  if (typeof data.id !== "string" || !data.id) return null;
  if (!Number.isFinite(data.exp)) return null;
  const expected = createHmac("sha256", String(secret))
    .update(`fw:${data.kind}:${data.id}:${data.exp}`)
    .digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (data.exp <= now) return null;
  if (data.kind === "wallet" && !normalizeWallet(data.id)) return null;
  if (data.kind === "email" && !normalizeEmail(data.id)) return null;
  return { kind: data.kind, id: data.kind === "wallet" ? normalizeWallet(data.id) : normalizeEmail(data.id), exp: data.exp };
}

export function bearerToken(headers) {
  const auth = headerSecret(headers, "authorization");
  const match = /^Bearer\s+(\S+)/i.exec(auth.trim());
  return match ? match[1] : "";
}

export function envFlag(env, name) {
  const value = String(env?.[name] || "").trim().toLowerCase();
  return value === "true" || value === "1" || value === "yes";
}

export function postalAddress(env = process.env) {
  return String(env?.POSTAL_ADDRESS || env?.OPENPAYWALL_POSTAL_ADDRESS || "").trim();
}

export function resendConfigured(env = process.env) {
  return Boolean(String(env?.RESEND_API_KEY || "").trim());
}

export function tokenSecret(env = process.env) {
  return String(env?.FOLLOW_TOKEN_SECRET || "").trim();
}

export function emailFromAddress(env = process.env) {
  const from = String(env?.FOLLOW_EMAIL_FROM || "posts@mail.openpaywall.app").trim();
  return from || "posts@mail.openpaywall.app";
}

export function publicOrigin(env = process.env) {
  return String(env?.PUBLIC_ORIGIN || env?.CDN_BASE || "https://openpaywall.app").replace(/\/$/, "");
}

/**
 * New-post mail stays off unless the flag is on AND a real postal address is configured.
 * Confirm mail is separate and only needs RESEND_API_KEY.
 */
export function newPostEmailsAllowed(env = process.env) {
  if (!envFlag(env, "FOLLOW_EMAILS_ENABLED")) {
    return { ok: false, reason: "emails_disabled" };
  }
  if (!postalAddress(env)) {
    return { ok: false, reason: "postal_address_missing" };
  }
  if (!resendConfigured(env)) {
    return { ok: false, reason: "email_not_configured" };
  }
  if (!tokenSecret(env)) {
    return { ok: false, reason: "follow_not_configured" };
  }
  return { ok: true, reason: null };
}

export function emailFollowAvailable(env = process.env) {
  return resendConfigured(env) && Boolean(tokenSecret(env));
}

export function formatUsdFromCents(cents) {
  const n = Math.trunc(Number(cents) || 0);
  const whole = Math.floor(Math.abs(n) / 100);
  const frac = Math.abs(n) % 100;
  if (frac === 0) return `$${whole}`;
  return `$${whole}.${String(frac).padStart(2, "0")}`;
}

/**
 * Dollar price for emails and writer pages. Never returns a MON amount.
 * USDC listings use price_wei. MON listings use price_cents, else the $0.50 floor.
 */
export function usdPriceParts(article) {
  let cents = null;
  const rawCents = article?.price_cents ?? article?.priceCents;
  if (rawCents != null && rawCents !== "") {
    const n = Number(rawCents);
    if (Number.isInteger(n) && n >= 50) cents = n;
  }
  const asset = String(article?.payment_asset || article?.paymentAsset || "").toLowerCase();
  const wei = article?.price_wei ?? article?.priceWei;
  if (cents == null && asset === "usdc" && wei != null && wei !== "") {
    try {
      const n = BigInt(wei);
      const asCents = n / 10000n;
      if (asCents >= 50n && asCents <= BigInt(Number.MAX_SAFE_INTEGER)) cents = Number(asCents);
    } catch {
      cents = null;
    }
  }
  if (cents == null) cents = 50;
  const label = formatUsdFromCents(cents);
  return {
    cents,
    label,
    line: `${label} to read`,
    button: `Read for ${label} →`,
  };
}

export function safeHeaderName(value, fallback = "A writer") {
  const cleaned = String(value || "")
    .replace(/[\r\n"<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned || fallback;
}

export function articleTitleKey(title) {
  return normalizeListingTitle(title || "").toLowerCase();
}

export function titlesMatch(a, b) {
  const left = articleTitleKey(a);
  const right = articleTitleKey(b);
  return Boolean(left) && left === right;
}

export function teaserForEmail(teaser) {
  return plainText(teaser || "", 280);
}

export function recentConfirmSends(rows, now) {
  let n = 0;
  for (const row of rows || []) {
    const last = Date.parse(row?.last_confirm_sent_at || "");
    if (!Number.isFinite(last) || now - last >= DAY_MS) continue;
    n += Number(row.confirm_sent_count) || 1;
  }
  return n;
}

export function confirmSendAllowed(row, emailRows, now) {
  if (row?.last_confirm_sent_at) {
    const last = Date.parse(row.last_confirm_sent_at);
    if (Number.isFinite(last) && now - last < CONFIRM_RESEND_MS) return false;
  }
  if (recentConfirmSends(emailRows, now) >= CONFIRM_DAILY_LIMIT) return false;
  return true;
}

export function nextConfirmCount(row, now) {
  const last = Date.parse(row?.last_confirm_sent_at || "");
  if (!Number.isFinite(last) || now - last >= DAY_MS) return 1;
  return (Number(row.confirm_sent_count) || 0) + 1;
}

export function nextUtcMidnight(now) {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString();
}

export function isQuotaError(error) {
  return /daily_quota_exceeded/i.test(String(error || ""));
}

export function csvCell(value) {
  const raw = value == null ? "" : String(value);
  const guarded = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  if (/[",\n\r]/.test(guarded)) return `"${guarded.replace(/"/g, '""')}"`;
  return guarded;
}

export function followersToCsv(rows) {
  const lines = ["email,wallet,source,followed_at,via"];
  for (const row of rows) {
    lines.push(
      [
        csvCell(row.follower_email || ""),
        csvCell(row.follower_wallet || ""),
        csvCell(row.source || ""),
        csvCell(row.verified_at || row.created_at || ""),
        csvCell(row.via || ""),
      ].join(",")
    );
  }
  return `${lines.join("\n")}\n`;
}

export function activeFollow(row) {
  return Boolean(row?.verified_at) && !row?.unsubscribed_at;
}

export function limitFromEnv(env, name, fallback) {
  const n = Number(env?.[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}
