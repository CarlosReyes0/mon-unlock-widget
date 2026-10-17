import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { alertPlan, renderAlertBody, summaryHash } from "./prod-alert.mjs";

test("a new failure opens one issue and a repeat only refreshes it", () => {
  const detail = "feed returned HTTP 500";
  assert.deepEqual(alertPlan({ key: "uptime", openIssues: [], failing: true, detail }), {
    action: "open",
  });
  const body = renderAlertBody({ key: "uptime", detail, now: "2026-10-17T00:00:00.000Z" });
  assert.match(body, /prod-alert-key:uptime/);
  assert.match(body, new RegExp(`prod-alert-summary:${summaryHash(detail)}`));
  const open = [{ number: 12, body }];
  assert.deepEqual(alertPlan({ key: "uptime", openIssues: open, failing: true, detail }), {
    action: "refresh",
    number: 12,
  });
  assert.deepEqual(
    alertPlan({ key: "uptime", openIssues: open, failing: true, detail: "home returned HTTP 500" }),
    { action: "update", number: 12 }
  );
});

test("recovery closes only the matching alert", () => {
  const uptime = renderAlertBody({ key: "uptime", detail: "down", now: "t" });
  const deploy = renderAlertBody({ key: "post-deploy", detail: "down", now: "t" });
  const openIssues = [
    { number: 4, body: deploy },
    { number: 9, body: uptime },
  ];
  assert.deepEqual(alertPlan({ key: "uptime", openIssues, failing: false, detail: "" }), {
    action: "close",
    number: 9,
  });
  assert.deepEqual(alertPlan({ key: "uptime", openIssues: [], failing: false, detail: "" }), {
    action: "noop",
  });
});

test("dry-run prints a plan and does not need gh or a token", () => {
  const result = spawnSync(
    process.execPath,
    [
      "scripts/prod-alert.mjs",
      "--key",
      "uptime",
      "--failing",
      "true",
      "--title",
      "[prod-alert] openpaywall.app uptime",
      "--body",
      "home returned HTTP 500",
      "--dry-run",
    ],
    { encoding: "utf8" }
  );
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.action, "open");
  assert.equal(plan.dryRun, true);
});
