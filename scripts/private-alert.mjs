/**
 * Optional private email after a confirmed production failure.
 *
 * Sends only when both of these are non-empty:
 *   RESEND_API_KEY
 *   ALERT_EMAIL_TO
 * Otherwise prints "resend skipped" and exits 0. Resend is not required.
 *
 * A send attempt prints "resend http=<status>" and exits 0. The check step
 * has already failed the job. This script never prints the API key, the
 * recipient, the From address, or the response body.
 *
 *   ALERT_KEY=uptime ALERT_SUMMARY_FILE=/tmp/uptime-report.md node scripts/private-alert.mjs
 *
 * From address is posts@mail.openpaywall.app, the same default as follow mail.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const RESEND_URL = "https://api.resend.com/emails";
export const DEFAULT_FROM = "Open Paywall <posts@mail.openpaywall.app>";

const STATUS_LINE = /^[a-z0-9-]+ status=[a-z0-9]+$/i;

export function alertKey(raw) {
  const key = String(raw || "").trim();
  return /^[a-z0-9-]{1,40}$/.test(key) ? key : "prod";
}

export function alertSecrets(env = process.env) {
  const key = String(env.RESEND_API_KEY || "").trim();
  const to = String(env.ALERT_EMAIL_TO || "").trim();
  return { key, to, ready: Boolean(key && to) };
}

export function safeSummary(text, fallback) {
  const lines = String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => STATUS_LINE.test(line));
  if (lines.length) return lines.join("\n");
  return fallback;
}

function readSummary(file) {
  if (!file) return "";
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

/**
 * @param {{ key: string, summary: string, env: NodeJS.ProcessEnv, fetchImpl?: typeof fetch }} input
 */
export async function sendPrivateAlert({ key, summary, env, fetchImpl = globalThis.fetch }) {
  const secrets = alertSecrets(env);
  if (!secrets.ready) return { skipped: true, status: null };
  const res = await fetchImpl(RESEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secrets.key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: DEFAULT_FROM,
      to: [secrets.to],
      subject: `Open Paywall ${alertKey(key)} failed`,
      text: summary,
    }),
  });
  await res.text().catch(() => "");
  return { skipped: false, status: res.status };
}

export function logLine(result) {
  if (result.skipped || result.status == null) return "resend skipped\n";
  return `resend http=${result.status}\n`;
}

async function main() {
  const key = alertKey(process.env.ALERT_KEY);
  const summary = safeSummary(readSummary(process.env.ALERT_SUMMARY_FILE || ""), `${key} status=fail`);
  try {
    const result = await sendPrivateAlert({ key, summary, env: process.env });
    process.stdout.write(logLine(result));
  } catch {
    process.stdout.write("resend status=fail\n");
  }
}

const direct = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (direct) {
  main().then(
    () => process.exit(0),
    () => {
      process.stdout.write("resend status=fail\n");
      process.exit(0);
    }
  );
}
