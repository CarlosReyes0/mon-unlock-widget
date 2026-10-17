/**
 * Paid unlocks per UTC week, from rows that already exist.
 *
 * public.unlocks          — on-chain MON (18 decimals) or USDC (6 decimals)
 * public.fiat_unlocks     — succeeded Stripe charges, amount_cents in USD
 *
 * Card vs Apple Pay vs Google Pay is not a column. x402 agent payments are
 * not inserted into either table. This module does not record new events.
 *
 * GET /api/usage/paid-unlocks uses LISTING_ADMIN_SECRET (Bearer), the same
 * secret as /admin-listings.html. USAGE_STATS_EXAMPLE=1 returns invented
 * numbers for local screenshots and is ignored when NODE_ENV=production.
 */
import { timingSafeEqual } from "node:crypto";

const METHODS = [
  { method: "crypto_mon", label: "Crypto (MON)" },
  { method: "crypto_usdc", label: "Crypto (USDC)" },
  { method: "stripe", label: "Stripe" },
];

export const USAGE_NOTES = [
  "Counted from public.unlocks and succeeded public.fiat_unlocks. No separate analytics table.",
  "Crypto revenue is amount_wei (MON has 18 decimals, USDC has 6). Stripe revenue is amount_cents in USD.",
  "Stripe is not split into card, Apple Pay, and Google Pay — fiat_unlocks does not store the wallet type.",
  "x402 agent payments are not rows in these tables, so they are not included.",
];

const ROW_LIMIT = 10000;

function httpError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

export function usageExampleEnabled(env = process.env) {
  if (String(env.NODE_ENV || "") === "production") return false;
  const flag = String(env.USAGE_STATS_EXAMPLE || "").trim().toLowerCase();
  return flag === "1" || flag === "true";
}

function secretMatches(provided, expected) {
  const a = Buffer.from(String(provided || ""));
  const b = Buffer.from(String(expected || ""));
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function assertUsageAdmin(authorization, env = process.env) {
  const expected = String(env.LISTING_ADMIN_SECRET || "").trim();
  if (!expected) throw httpError("listing_admin_not_configured", 503);
  const header = String(authorization || "").trim();
  const token = /^bearer\s+/i.test(header) ? header.replace(/^bearer\s+/i, "").trim() : "";
  if (!secretMatches(token, expected)) throw httpError("unauthorized", 401);
}

/** Monday 00:00 UTC of the week containing `input`. Matches Postgres date_trunc('week'). */
export function utcWeekStart(input) {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return null;
  const day = date.getUTCDay();
  const mondayOffset = day === 0 ? 6 : day - 1;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - mondayOffset));
}

export function utcWeekKey(input) {
  const monday = utcWeekStart(input);
  return monday ? monday.toISOString().slice(0, 10) : null;
}

export function atomicAmount(value) {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
      throw httpError("inexact_revenue", 502);
    }
    return BigInt(value);
  }
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) return 0n;
  return BigInt(text);
}

function formatScaled(value, decimals) {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const digits = abs.toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, -decimals);
  const frac = digits.slice(-decimals).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

export function formatMethodRevenue(method, amount) {
  if (method === "crypto_mon") return `${formatScaled(amount, 18)} MON`;
  if (method === "crypto_usdc") return `${formatScaled(amount, 6)} USDC`;
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const digits = abs.toString().padStart(3, "0");
  return `${negative ? "-" : ""}$${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

function emptyMethods() {
  return new Map(METHODS.map((item) => [item.method, { unlocks: 0, revenue: 0n }]));
}

function shapeMethods(map) {
  return METHODS.map((item) => {
    const row = map.get(item.method) || { unlocks: 0, revenue: 0n };
    return {
      method: item.method,
      label: item.label,
      unlocks: row.unlocks,
      revenue: formatMethodRevenue(item.method, row.revenue),
      revenueAtomic: row.revenue.toString(),
    };
  });
}

function shapeWeek(week, map) {
  const byMethod = shapeMethods(map);
  return {
    week,
    unlocks: byMethod.reduce((sum, row) => sum + row.unlocks, 0),
    byMethod,
  };
}

function addRow(buckets, week, method, revenue) {
  if (!week) return;
  if (!buckets.has(week)) buckets.set(week, emptyMethods());
  const slot = buckets.get(week).get(method);
  slot.unlocks += 1;
  slot.revenue += revenue;
}

/**
 * @param {{ unlocks?: object[], fiatUnlocks?: object[], now?: Date }} input
 */
export function weeklyPaidUnlocks(input = {}) {
  const buckets = new Map();
  for (const row of input.unlocks || []) {
    const method = row?.payment_asset === "usdc" ? "crypto_usdc" : "crypto_mon";
    addRow(buckets, utcWeekKey(row?.unlocked_at), method, atomicAmount(row?.amount_wei));
  }
  for (const row of input.fiatUnlocks || []) {
    if (row?.status && row.status !== "succeeded") continue;
    const cents = row?.currency && String(row.currency).toLowerCase() !== "usd" ? 0n : atomicAmount(row?.amount_cents);
    addRow(buckets, utcWeekKey(row?.unlocked_at), "stripe", cents);
  }

  const current = utcWeekKey(input.now || new Date());
  if (current && !buckets.has(current)) buckets.set(current, emptyMethods());

  const weeks = [...buckets.keys()].sort().reverse().map((week) => shapeWeek(week, buckets.get(week)));
  const totals = emptyMethods();
  for (const map of buckets.values()) {
    for (const [method, row] of map) {
      const dest = totals.get(method);
      dest.unlocks += row.unlocks;
      dest.revenue += row.revenue;
    }
  }

  return {
    example: false,
    label: null,
    generatedAt: new Date().toISOString(),
    timezone: "utc",
    weekStartsOn: "monday",
    thisWeek: weeks.find((week) => week.week === current) || shapeWeek(current, emptyMethods()),
    weeks,
    allTime: shapeWeek(null, totals),
    truncated: false,
    notes: USAGE_NOTES,
  };
}

export function examplePaidUnlocks() {
  const report = weeklyPaidUnlocks({
    now: new Date("2026-10-17T15:00:00.000Z"),
    unlocks: [
      { unlocked_at: "2026-10-13T12:00:00.000Z", amount_wei: "5000000000000000000", payment_asset: "mon" },
      { unlocked_at: "2026-10-14T12:00:00.000Z", amount_wei: "2000000000000000000", payment_asset: "mon" },
    ],
    fiatUnlocks: [
      { unlocked_at: "2026-10-15T12:00:00.000Z", amount_cents: 200, currency: "usd", status: "succeeded" },
      { unlocked_at: "2026-10-16T12:00:00.000Z", amount_cents: 100, currency: "usd", status: "succeeded" },
      { unlocked_at: "2026-10-06T12:00:00.000Z", amount_cents: 50, currency: "usd", status: "succeeded" },
    ],
  });
  report.example = true;
  report.label = "Example / test data — not production";
  return report;
}

function supabaseConfig(env) {
  const url = String(env.SUPABASE_URL || "").trim().replace(/\/$/, "");
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) throw httpError("supabase_not_configured", 503);
  return { url, key };
}

async function supabaseGet(path, env, fetchImpl) {
  const { url, key } = supabaseConfig(env);
  let res;
  try {
    res = await fetchImpl(`${url}/rest/v1/${path}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
  } catch {
    throw httpError("supabase_unavailable", 503);
  }
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok || !Array.isArray(data)) throw httpError("supabase_unavailable", 503);
  return data;
}

export async function loadPaidUnlockReport(env = process.env, fetchImpl = globalThis.fetch, now = new Date()) {
  const unlocks = await supabaseGet(
    `unlocks?select=unlocked_at,amount_wei,payment_asset&order=unlocked_at.desc&limit=${ROW_LIMIT}`,
    env,
    fetchImpl
  );
  const fiatUnlocks = await supabaseGet(
    `fiat_unlocks?select=unlocked_at,amount_cents,currency,status&status=eq.succeeded&order=unlocked_at.desc&limit=${ROW_LIMIT}`,
    env,
    fetchImpl
  );
  const report = weeklyPaidUnlocks({ unlocks, fiatUnlocks, now });
  report.truncated = unlocks.length >= ROW_LIMIT || fiatUnlocks.length >= ROW_LIMIT;
  return report;
}

export async function paidUnlocksResponse({ authorization, env = process.env, fetchImpl, now } = {}) {
  assertUsageAdmin(authorization, env);
  if (usageExampleEnabled(env)) return examplePaidUnlocks();
  return loadPaidUnlockReport(env, fetchImpl || globalThis.fetch, now || new Date());
}
