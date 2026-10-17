import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { alertSecrets, logLine, safeSummary, sendPrivateAlert } from "./private-alert.mjs";

test("email is skipped unless both secrets are set", () => {
  assert.equal(alertSecrets({}).ready, false);
  assert.equal(alertSecrets({ RESEND_API_KEY: "re_test", ALERT_EMAIL_TO: "" }).ready, false);
  assert.equal(alertSecrets({ RESEND_API_KEY: " ", ALERT_EMAIL_TO: "ops@example.com" }).ready, false);
  assert.equal(alertSecrets({ RESEND_API_KEY: "re_test", ALERT_EMAIL_TO: "ops@example.com" }).ready, true);
});

test("the summary keeps status lines and drops everything else", () => {
  const summary = safeSummary(
    ["home status=500", "article slug hello-post", "balance 1.5 MON", "relayer-balance status=low"].join("\n"),
    "uptime status=fail"
  );
  assert.equal(summary, "home status=500\nrelayer-balance status=low");
  assert.equal(safeSummary("not a status", "uptime status=fail"), "uptime status=fail");
});

test("a configured send posts to Resend and the log line hides the secret and recipient", async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, init });
    return new Response(JSON.stringify({ id: "email_123" }), { status: 202 });
  };
  const result = await sendPrivateAlert({
    key: "uptime",
    summary: "home status=500",
    env: { RESEND_API_KEY: "re_secret_key", ALERT_EMAIL_TO: "ops@example.com" },
    fetchImpl,
  });
  assert.equal(result.skipped, false);
  assert.equal(result.status, 202);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "https://api.resend.com/emails");
  assert.equal(seen[0].init.headers.Authorization, "Bearer re_secret_key");
  const body = JSON.parse(seen[0].init.body);
  assert.deepEqual(body.to, ["ops@example.com"]);
  assert.equal(body.text, "home status=500");
  const line = logLine(result);
  assert.equal(line, "resend http=202\n");
  assert.equal(line.includes("re_secret_key"), false);
  assert.equal(line.includes("ops@example.com"), false);
  assert.equal(line.includes("email_123"), false);
});

test("a Resend error still returns only the status code", async () => {
  const fetchImpl = async () => new Response("nope", { status: 403 });
  const result = await sendPrivateAlert({
    key: "post-deploy",
    summary: "smoke status=1",
    env: { RESEND_API_KEY: "re_secret_key", ALERT_EMAIL_TO: "ops@example.com" },
    fetchImpl,
  });
  assert.equal(logLine(result), "resend http=403\n");
});

test("the CLI skips when the secrets are absent and does not print the summary file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "private-alert-"));
  const file = path.join(dir, "summary.txt");
  fs.writeFileSync(file, "home status=500\nsecret re_should_not_print\nops@example.com\n");
  const result = spawnSync(process.execPath, ["scripts/private-alert.mjs"], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      ALERT_KEY: "uptime",
      ALERT_SUMMARY_FILE: file,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "resend skipped\n");
  assert.equal(result.stderr, "");
});
