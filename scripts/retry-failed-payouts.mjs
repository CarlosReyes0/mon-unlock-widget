#!/usr/bin/env node
/**
 * Manually retry failed writer-card payouts.
 * The scheduled job never calls this, and this script never runs unless
 * someone passes --confirm and --url.
 *
 *   PAYOUT_RETRY_SECRET=... node scripts/retry-failed-payouts.mjs --confirm --url https://example.test
 *
 * Prints row counts and statuses only.
 */
const confirm = process.argv.includes("--confirm");
const urlFlag = process.argv.indexOf("--url");
const base = urlFlag >= 0 ? process.argv[urlFlag + 1] : "";
const secret = (process.env.PAYOUT_RETRY_SECRET || "").trim();

if (!confirm || !base || !secret) {
  console.error("[stripe] payouts status=refused");
  process.exit(1);
}

let parsed;
try {
  const endpoint = new URL("/api/stripe/payouts/retry", base);
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ confirm: true }),
  });
  const text = await res.text();
  parsed = text ? JSON.parse(text) : {};
  if (!res.ok) {
    console.error("[stripe] payouts status=error");
    process.exit(1);
  }
} catch {
  console.error("[stripe] payouts status=error");
  process.exit(1);
}

const keys = ["paid", "failed", "pending", "skipped", "not_claimed", "reversed"];
const parts = ["status=ran"];
for (const key of keys) {
  const value = Number(parsed[key]);
  parts.push(`${key}=${Number.isFinite(value) ? value : 0}`);
}
console.log(`[stripe] payouts ${parts.join(" ")}`);
