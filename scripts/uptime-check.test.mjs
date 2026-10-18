import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import {
  cspProblems,
  renderReport,
  runUptimeChecks,
} from "./uptime-check.mjs";

const CSP =
  "default-src 'self'; script-src 'self' 'nonce-abc' 'wasm-unsafe-eval' https://js.stripe.com; object-src 'none'; frame-ancestors 'none'";

function htmlResponse(body, { status = 200, csp = CSP, frame = "DENY" } = {}) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": csp,
      "x-frame-options": frame,
    },
  });
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function healthyFetch({ homeStatus = 200, relayer = "ok", uptimeStatus = 200, csp = CSP, uptimeBody } = {}) {
  const calls = [];
  let homeHits = 0;
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method || "GET", body: init.body || "" });
    const target = new URL(url);
    if (target.pathname === "/") {
      homeHits += 1;
      const status = homeHits === 1 ? homeStatus : 200;
      return htmlResponse('<html>Open Paywall<div id="feed"></div></html>', { status, csp });
    }
    if (target.pathname === "/api/articles") {
      return jsonResponse({ articles: [{ slug: "hello-post" }] });
    }
    if (target.pathname === "/articles/hello-post") {
      return htmlResponse("<html>Open Paywall article</html>", { csp });
    }
    if (target.pathname === "/api/agents/health") {
      return jsonResponse({ ok: true, product: "Open Paywall" });
    }
    if (target.pathname === "/api/uptime") {
      const body = uptimeBody ?? { ok: relayer === "ok", relayer };
      return jsonResponse(body, uptimeStatus);
    }
    return new Response("missing", { status: 404 });
  };
  return { fetchImpl, calls };
}

const noSleep = async () => {};

test("csp accepts wasm-unsafe-eval and rejects a real unsafe-eval token", () => {
  assert.deepEqual(cspProblems(CSP), []);
  const loosened = CSP.replace("'wasm-unsafe-eval'", "'wasm-unsafe-eval' 'unsafe-eval' https://esm.sh");
  const problems = cspProblems(loosened);
  assert.ok(problems.some((problem) => problem.includes("unsafe-eval")));
  assert.ok(problems.some((problem) => problem.includes("CDN")));
});

test("the server still defaults the relayer alert line to 1 MON", () => {
  const gas = fs.readFileSync(new URL("../server/relay-gas.mjs", import.meta.url), "utf8");
  assert.match(gas, /parseEther\("1"\)/);
  assert.match(gas, /RELAYER_LOW_BALANCE_WEI/);
  assert.match(gas, /export async function readRelayerBalanceStatus/);
  assert.match(gas, /export function uptimeHttpResult/);
});

test("a healthy site passes, retries a blip, and only GETs the status endpoint", async () => {
  const { fetchImpl, calls } = healthyFetch({ homeStatus: 500 });
  const result = await runUptimeChecks({
    baseUrl: "https://openpaywall.app",
    fetchImpl,
    attempts: 2,
    retryMs: 0,
    sleep: noSleep,
  });
  assert.equal(result.ok, true);
  assert.equal(result.checks.find((check) => check.name === "home").attempts, 2);
  const report = renderReport(result);
  assert.match(report, /home status=200/);
  assert.match(report, /feed status=200/);
  assert.match(report, /article status=200/);
  assert.match(report, /relayer-balance status=200/);
  assert.doesNotMatch(report, /hello-post|MON|0x/);
  assert.ok(calls.every((call) => call.method === "GET"));
  assert.ok(calls.some((call) => new URL(call.url).pathname === "/api/uptime"));
  assert.equal(calls.some((call) => call.method === "POST"), false);
});

test("an unset relayer fails with status=unset instead of being skipped", async () => {
  const { fetchImpl, calls } = healthyFetch({ relayer: "unset", uptimeStatus: 503 });
  const result = await runUptimeChecks({
    baseUrl: "https://openpaywall.app",
    fetchImpl,
    attempts: 1,
    sleep: noSleep,
  });
  assert.equal(result.ok, false);
  const balance = result.checks.find((check) => check.name === "relayer-balance");
  assert.equal(balance.ok, false);
  assert.equal(balance.code, "unset");
  assert.equal(balance.skipped, undefined);
  const report = renderReport(result);
  assert.match(report, /relayer-balance status=unset/);
  assert.doesNotMatch(report, /0x|\bwei\b|MON/);
  assert.equal(calls.some((call) => call.method === "POST"), false);
});

test("a low relayer fails only after retries and the report stays a status word", async () => {
  const { fetchImpl } = healthyFetch({ relayer: "low", uptimeStatus: 503 });
  const result = await runUptimeChecks({
    baseUrl: "https://openpaywall.app",
    fetchImpl,
    attempts: 2,
    retryMs: 0,
    sleep: noSleep,
  });
  assert.equal(result.ok, false);
  const balance = result.checks.find((check) => check.name === "relayer-balance");
  assert.equal(balance.code, "low");
  assert.equal(balance.detail, "low");
  assert.equal(balance.attempts, 2);
  const report = renderReport(result);
  assert.match(report, /relayer-balance status=low/);
  assert.doesNotMatch(report, /MON|0x|below|wei/);
});

test("a missing status endpoint fails closed", async () => {
  const { fetchImpl } = healthyFetch();
  const result = await runUptimeChecks({
    baseUrl: "https://openpaywall.app",
    fetchImpl: async (url, init) => {
      const target = new URL(url);
      if (target.pathname === "/api/uptime") return new Response("missing", { status: 404 });
      return fetchImpl(url, init);
    },
    attempts: 1,
    sleep: noSleep,
  });
  assert.equal(result.ok, false);
  const balance = result.checks.find((check) => check.name === "relayer-balance");
  assert.equal(balance.code, "fail");
  assert.match(renderReport(result), /relayer-balance status=fail/);
  assert.doesNotMatch(renderReport(result), /missing/);
});

test("a connection error keeps the check name after retries", async () => {
  const result = await runUptimeChecks({
    baseUrl: "http://127.0.0.1:9",
    fetchImpl: async () => {
      throw new Error("fetch failed");
    },
    attempts: 2,
    retryMs: 0,
    sleep: noSleep,
  });
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.checks.map((check) => check.name),
    ["home", "feed", "article", "health", "relayer-balance"]
  );
  assert.match(result.checks[0].detail, /fetch failed/);
  assert.equal(result.checks[0].attempts, 2);
  const report = renderReport(result);
  assert.match(report, /home status=fail/);
  assert.doesNotMatch(report, /fetch failed|127\.0\.0\.1/);
});

test("extra fields on the status payload are not echoed", async () => {
  const leaked = `0x${"ab".repeat(20)}`;
  const { fetchImpl } = healthyFetch({
    uptimeStatus: 503,
    uptimeBody: { ok: false, relayer: "fail", address: leaked, balance: "999" },
  });
  const result = await runUptimeChecks({
    baseUrl: "https://openpaywall.app",
    fetchImpl,
    attempts: 1,
    sleep: noSleep,
  });
  const balance = result.checks.find((check) => check.name === "relayer-balance");
  assert.equal(balance.ok, false);
  assert.equal(balance.code, "fail");
  const report = renderReport(result);
  assert.equal(report.includes(leaked), false);
  assert.equal(report.includes("999"), false);
  assert.match(report, /relayer-balance status=fail/);
});

test("the workflow does not hardcode an address and skips prod on pull requests", () => {
  const script = fs.readFileSync(new URL("./uptime-check.mjs", import.meta.url), "utf8");
  const workflow = fs.readFileSync(new URL("../.github/workflows/uptime.yml", import.meta.url), "utf8");
  assert.doesNotMatch(script, /eth_send|sendTransaction|personal_sign|eth_getBalance/);
  assert.doesNotMatch(script, /RELAYER_ADDRESS/);
  assert.doesNotMatch(workflow, /0x[a-fA-F0-9]{40}/);
  assert.match(workflow, /cron: "\*\/15 \* \* \* \*"/);
  assert.match(workflow, /\/api\/uptime/);
  assert.match(workflow, /uptimerobot\.com/);
  assert.match(workflow, /RELAYER_LOW_BALANCE_WEI/);
  assert.doesNotMatch(workflow, /vars\.RELAYER_ADDRESS|secrets\.RELAYER_ADDRESS/);
  assert.doesNotMatch(workflow, /UPTIME_DISPATCH|github_pat_|ghp_/);
  assert.match(workflow, /if: github\.event_name == 'pull_request'/);
  assert.match(workflow, /if: github\.event_name != 'pull_request'/);
  assert.match(workflow, /UPTIME_ATTEMPTS: "3"/);
  assert.match(workflow, /scripts\/private-alert\.mjs/);
  assert.match(workflow, /secrets\.RESEND_API_KEY/);
  assert.match(workflow, /secrets\.ALERT_EMAIL_TO/);
  assert.match(workflow, /settings\/notifications/);
  assert.doesNotMatch(workflow, /prod-alert/);
  assert.doesNotMatch(workflow, /issues:\s*write/);
  assert.doesNotMatch(workflow, /issue create|issue close/);
});
