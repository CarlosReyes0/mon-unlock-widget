/**
 * Read-only production checks for https://openpaywall.app.
 *
 * GET the homepage, the public article feed, one article page, and
 * /api/agents/health. On HTML responses, require the production CSP
 * (default-src 'self', frame-ancestors 'none', no script-src 'unsafe-eval'
 * or esm.sh). When RELAYER_ADDRESS is set, eth_getBalance that wallet on
 * Monad and fail if it is below RELAYER_LOW_BALANCE_WEI (default 1 MON,
 * the same default as server/relay-gas.mjs).
 *
 * Each check retries before it is reported as a failure. Nothing is posted
 * to the app and no transaction is sent. Stdout is check names and status
 * codes only (Actions logs on this public repo are public).
 *
 *   UPTIME_BASE_URL=https://openpaywall.app node scripts/uptime-check.mjs
 *
 * Repository variable or secret (either name works; the variable is enough
 * because the address is public):
 *   RELAYER_ADDRESS          — skip the balance check when unset
 * Optional variable:
 *   RELAYER_LOW_BALANCE_WEI  — default 1000000000000000000 (1 MON)
 *   MONAD_RPC_URL            — default https://rpc.monad.xyz
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ONE_MON_WEI = 10n ** 18n;
export const DEFAULT_RPC_URL = "https://rpc.monad.xyz";

const ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const SLUG = /^[A-Za-z0-9][A-Za-z0-9-]{0,200}$/;

export function parseLowBalanceWei(raw) {
  const text = String(raw ?? "").trim();
  if (/^[0-9]+$/.test(text)) {
    try {
      const value = BigInt(text);
      if (value > 0n) return value;
    } catch {
      /* default */
    }
  }
  return ONE_MON_WEI;
}

export function formatMon(wei) {
  const value = BigInt(wei);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / ONE_MON_WEI;
  const frac = (abs % ONE_MON_WEI).toString().padStart(18, "0").slice(0, 4);
  return `${negative ? "-" : ""}${whole}.${frac} MON`;
}

export function scriptSrcProblems(csp) {
  const problems = [];
  const directive = String(csp || "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part === "script-src" || part.startsWith("script-src "));
  if (!directive) {
    problems.push("missing script-src");
    return problems;
  }
  const tokens = directive.split(/\s+/).slice(1);
  if (tokens.includes("'unsafe-eval'")) problems.push("script-src allows 'unsafe-eval'");
  if (tokens.includes("'unsafe-inline'")) problems.push("script-src allows 'unsafe-inline'");
  if (tokens.some((token) => /esm\.sh|cdn\.jsdelivr\.net/i.test(token))) {
    problems.push("script-src allows a public CDN");
  }
  return problems;
}

/** Problems that mean the production document policy is missing or loosened. */
export function cspProblems(csp) {
  const policy = String(csp || "");
  const problems = [];
  if (!policy) problems.push("missing Content-Security-Policy");
  if (!policy.includes("default-src 'self'")) problems.push("default-src is not 'self'");
  if (!policy.includes("frame-ancestors 'none'")) problems.push("frame-ancestors is not 'none'");
  if (!policy.includes("object-src 'none'")) problems.push("object-src is not 'none'");
  problems.push(...scriptSrcProblems(policy));
  return problems;
}

function header(res, name) {
  return res.headers.get(name) || "";
}

function originOf(url) {
  return new URL(url).origin;
}

async function readResponse(res, base) {
  const text = await res.text();
  if (res.url && originOf(res.url) !== originOf(base)) {
    return {
      ok: false,
      code: "fail",
      detail: "redirected off-origin",
      text: "",
      res,
    };
  }
  return { ok: true, text, res };
}

function htmlProblems(res, text, { feed }) {
  const problems = [];
  if (res.status !== 200) problems.push(`HTTP ${res.status}`);
  const type = header(res, "content-type");
  if (!/text\/html/i.test(type)) problems.push(`content-type ${type || "missing"}`);
  if (/^\s*not found\s*$/i.test(text)) problems.push("Docker-style Not found");
  if (!text.includes("Open Paywall")) problems.push("body is missing Open Paywall");
  if (feed && !text.includes('id="feed"')) problems.push('body is missing id="feed"');
  const frame = header(res, "x-frame-options");
  if (frame.toUpperCase() !== "DENY") problems.push(`X-Frame-Options is ${frame || "missing"}`);
  problems.push(...cspProblems(header(res, "content-security-policy")));
  return problems;
}

function httpCode(status, ok) {
  if (ok) return "200";
  if (status && status !== 200) return String(status);
  return "fail";
}

async function checkHome(base, request) {
  const res = await request(`${base}/`, { method: "GET" });
  const read = await readResponse(res, base);
  if (!read.ok) return { name: "home", ok: false, code: "fail", detail: "redirected off-origin" };
  const problems = htmlProblems(read.res, read.text, { feed: true });
  const ok = problems.length === 0;
  return {
    name: "home",
    ok,
    code: httpCode(read.res.status, ok),
    detail: ok ? "200" : "fail",
  };
}

async function checkFeed(base, request) {
  const res = await request(`${base}/api/articles?limit=1`, { method: "GET" });
  const read = await readResponse(res, base);
  if (!read.ok) return { name: "feed", ok: false, code: "fail", detail: "redirected off-origin", slug: "" };
  if (read.res.status !== 200) {
    return { name: "feed", ok: false, code: String(read.res.status), detail: "http", slug: "" };
  }
  let body;
  try {
    body = JSON.parse(read.text);
  } catch {
    return { name: "feed", ok: false, code: "fail", detail: "not-json", slug: "" };
  }
  const articles = body?.articles;
  if (!Array.isArray(articles) || articles.length === 0) {
    return { name: "feed", ok: false, code: "fail", detail: "empty", slug: "" };
  }
  const slug = articles
    .map((article) => (article && typeof article.slug === "string" ? article.slug.trim() : ""))
    .find((value) => SLUG.test(value));
  if (!slug) return { name: "feed", ok: false, code: "fail", detail: "no-slug", slug: "" };
  return { name: "feed", ok: true, code: "200", detail: "200", slug };
}

async function checkArticle(base, request, slug) {
  if (!slug) {
    return { name: "article", ok: false, code: "fail", detail: "no-slug" };
  }
  const res = await request(`${base}/articles/${encodeURIComponent(slug)}`, { method: "GET" });
  const read = await readResponse(res, base);
  if (!read.ok) return { name: "article", ok: false, code: "fail", detail: "redirected off-origin" };
  const problems = htmlProblems(read.res, read.text, { feed: false });
  const ok = problems.length === 0;
  return {
    name: "article",
    ok,
    code: httpCode(read.res.status, ok),
    detail: ok ? "200" : "fail",
  };
}

async function checkHealth(base, request) {
  const res = await request(`${base}/api/agents/health`, { method: "GET" });
  const read = await readResponse(res, base);
  if (!read.ok) return { name: "health", ok: false, code: "fail", detail: "redirected off-origin" };
  if (read.res.status !== 200) {
    return { name: "health", ok: false, code: String(read.res.status), detail: "http" };
  }
  let body;
  try {
    body = JSON.parse(read.text);
  } catch {
    return { name: "health", ok: false, code: "fail", detail: "not-json" };
  }
  if (body?.ok !== true || body?.product !== "Open Paywall") {
    return { name: "health", ok: false, code: "fail", detail: "health-json" };
  }
  return { name: "health", ok: true, code: "200", detail: "200" };
}

async function checkBalance(request, { relayerAddress, rpcUrl, threshold }) {
  if (!relayerAddress) {
    return {
      name: "relayer-balance",
      ok: true,
      skipped: true,
      code: "skip",
      detail: "skip",
    };
  }
  if (!ADDRESS.test(relayerAddress)) {
    return {
      name: "relayer-balance",
      ok: false,
      code: "fail",
      detail: "address",
    };
  }
  const res = await request(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getBalance",
      params: [relayerAddress, "latest"],
    }),
  });
  const text = await res.text();
  if (res.status !== 200) {
    return { name: "relayer-balance", ok: false, code: String(res.status), detail: "http" };
  }
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    return { name: "relayer-balance", ok: false, code: "fail", detail: "not-json" };
  }
  if (payload.error) {
    return {
      name: "relayer-balance",
      ok: false,
      code: "fail",
      detail: "rpc",
    };
  }
  let balance;
  try {
    balance = BigInt(payload.result);
  } catch {
    return { name: "relayer-balance", ok: false, code: "fail", detail: "wei" };
  }
  if (balance < threshold) {
    return {
      name: "relayer-balance",
      ok: false,
      code: "low",
      detail: `${formatMon(balance)} is below ${formatMon(threshold)}`,
    };
  }
  return {
    name: "relayer-balance",
    ok: true,
    code: "200",
    detail: "200",
  };
}

async function withRetries(name, fn, { attempts, retryMs, sleep }) {
  let last = { name, ok: false, detail: "not run" };
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      last = { name, ...(await fn()) };
    } catch {
      last = { name, ok: false, code: "fail", detail: "fetch failed" };
    }
    if (last.ok || attempt === attempts) {
      return { ...last, attempts: attempt };
    }
    await sleep(retryMs);
  }
  return last;
}

/**
 * @param {{
 *   baseUrl?: string,
 *   fetchImpl?: typeof fetch,
 *   relayerAddress?: string,
 *   lowBalanceWei?: string,
 *   rpcUrl?: string,
 *   attempts?: number,
 *   retryMs?: number,
 *   timeoutMs?: number,
 *   sleep?: (ms: number) => Promise<void>,
 * }} [options]
 */
export async function runUptimeChecks(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const base = String(options.baseUrl || "https://openpaywall.app").replace(/\/$/, "");
  const attempts = options.attempts ?? 3;
  const retryMs = options.retryMs ?? 5000;
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const timeoutMs = options.timeoutMs ?? 15000;
  const relayerAddress = String(options.relayerAddress ?? "").trim();
  const threshold = parseLowBalanceWei(options.lowBalanceWei);
  const rpcUrl = String(options.rpcUrl || DEFAULT_RPC_URL).trim() || DEFAULT_RPC_URL;
  const calls = [];

  async function request(url, init = {}) {
    const method = init.method || "GET";
    calls.push({ url, method, body: init.body || "" });
    return fetchImpl(url, {
      ...init,
      method,
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "user-agent": "OpenPaywallUptime/1.0",
        ...(init.headers || {}),
      },
    });
  }

  const retry = (name, fn) => withRetries(name, fn, { attempts, retryMs, sleep });
  const home = await retry("home", () => checkHome(base, request));
  const feed = await retry("feed", () => checkFeed(base, request));
  const article = await retry("article", () => checkArticle(base, request, feed.slug || ""));
  const health = await retry("health", () => checkHealth(base, request));
  const balance = await retry("relayer-balance", () =>
    checkBalance(request, { relayerAddress, rpcUrl, threshold })
  );
  const checks = [home, feed, article, health, balance];
  const ok = checks.every((check) => check.ok);
  return { ok, checks, calls, baseUrl: base };
}

/** Public Actions log. Check name and status code only. */
export function renderReport(result) {
  const lines = result.checks.map((check) => {
    const code = check.code || (check.ok ? "ok" : "fail");
    return `${check.name} status=${code}`;
  });
  return `${lines.join("\n")}\n`;
}

async function main() {
  const result = await runUptimeChecks({
    baseUrl: process.env.UPTIME_BASE_URL,
    relayerAddress: process.env.RELAYER_ADDRESS,
    lowBalanceWei: process.env.RELAYER_LOW_BALANCE_WEI,
    rpcUrl: process.env.MONAD_RPC_URL,
    attempts: Number(process.env.UPTIME_ATTEMPTS || 3),
    retryMs: Number(process.env.UPTIME_RETRY_MS || 5000),
  });
  const report = renderReport(result);
  if (process.env.UPTIME_REPORT_PATH) {
    fs.writeFileSync(process.env.UPTIME_REPORT_PATH, report);
  }
  process.stdout.write(report);
  process.exit(result.ok ? 0 : 1);
}

const direct = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (direct) {
  main().catch(() => {
    const report = "uptime status=fail\n";
    if (process.env.UPTIME_REPORT_PATH) fs.writeFileSync(process.env.UPTIME_REPORT_PATH, report);
    process.stderr.write(report);
    process.exit(1);
  });
}
