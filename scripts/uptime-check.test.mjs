import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import {
  cspProblems,
  ONE_MON_WEI,
  parseLowBalanceWei,
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

function healthyFetch({ homeStatus = 200, balance = "0xde0b6b3a7640000", csp = CSP } = {}) {
  const calls = [];
  let homeHits = 0;
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method || "GET", body: init.body || "" });
    const target = new URL(url);
    if (target.hostname === "rpc.monad.xyz") {
      return jsonResponse({ jsonrpc: "2.0", id: 1, result: balance });
    }
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

test("low-balance default matches the server 1 MON threshold", () => {
  const gas = fs.readFileSync(new URL("../server/relay-gas.mjs", import.meta.url), "utf8");
  assert.match(gas, /parseEther\("1"\)/);
  assert.equal(parseLowBalanceWei(""), ONE_MON_WEI);
  assert.equal(parseLowBalanceWei("1000000000000000000"), ONE_MON_WEI);
  assert.equal(parseLowBalanceWei("0"), ONE_MON_WEI);
});

test("a healthy site passes, retries a blip, and only reads balance", async () => {
  const { fetchImpl, calls } = healthyFetch({ homeStatus: 500 });
  const result = await runUptimeChecks({
    baseUrl: "https://openpaywall.app",
    fetchImpl,
    relayerAddress: "0x1111111111111111111111111111111111111111",
    attempts: 2,
    retryMs: 0,
    sleep: noSleep,
  });
  assert.equal(result.ok, true, JSON.stringify(result.checks));
  assert.equal(result.checks.find((check) => check.name === "home").attempts, 2);
  const methods = calls.map((call) => call.method);
  assert.ok(methods.includes("GET"));
  const posts = calls.filter((call) => call.method !== "GET");
  assert.equal(posts.length, 1);
  assert.match(posts[0].body, /"method":"eth_getBalance"/);
  assert.doesNotMatch(posts[0].body, /eth_send|sendTransaction/);
});

test("missing RELAYER_ADDRESS skips the balance check instead of failing", async () => {
  const { fetchImpl, calls } = healthyFetch();
  const result = await runUptimeChecks({
    baseUrl: "https://openpaywall.app",
    fetchImpl,
    relayerAddress: "",
    attempts: 1,
    sleep: noSleep,
  });
  assert.equal(result.ok, true);
  const balance = result.checks.find((check) => check.name === "relayer-balance");
  assert.equal(balance.skipped, true);
  assert.equal(calls.some((call) => call.method === "POST"), false);
});

test("a wallet under 1 MON fails only after retries", async () => {
  const { fetchImpl } = healthyFetch({ balance: "0x1" });
  const result = await runUptimeChecks({
    baseUrl: "https://openpaywall.app",
    fetchImpl,
    relayerAddress: "0x0000000000000000000000000000000000000001",
    attempts: 2,
    retryMs: 0,
    sleep: noSleep,
  });
  assert.equal(result.ok, false);
  const balance = result.checks.find((check) => check.name === "relayer-balance");
  assert.match(balance.detail, /below 1\.0000 MON/);
  assert.equal(balance.attempts, 2);
});

test("an unusable address is not echoed back", async () => {
  const secret = `0x${"ab".repeat(32)}`;
  const { fetchImpl } = healthyFetch();
  const result = await runUptimeChecks({
    baseUrl: "https://openpaywall.app",
    fetchImpl,
    relayerAddress: secret,
    attempts: 1,
    sleep: noSleep,
  });
  const balance = result.checks.find((check) => check.name === "relayer-balance");
  assert.equal(balance.ok, false);
  assert.equal(balance.detail.includes(secret), false);
});

test("the workflow does not hardcode an address and skips prod on pull requests", () => {
  const script = fs.readFileSync(new URL("./uptime-check.mjs", import.meta.url), "utf8");
  const workflow = fs.readFileSync(new URL("../.github/workflows/uptime.yml", import.meta.url), "utf8");
  assert.doesNotMatch(script, /eth_send|sendTransaction|personal_sign/);
  assert.doesNotMatch(workflow, /0x[a-fA-F0-9]{40}/);
  assert.match(workflow, /cron: "\*\/15 \* \* \* \*"/);
  assert.match(workflow, /vars\.RELAYER_ADDRESS \|\| secrets\.RELAYER_ADDRESS/);
  assert.match(workflow, /if: github\.event_name == 'pull_request'/);
  assert.match(workflow, /if: github\.event_name != 'pull_request'/);
  assert.match(workflow, /--key uptime/);
});
