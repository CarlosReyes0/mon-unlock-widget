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
 * to the app and no transaction is sent.
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
      detail: `redirected off-origin to ${originOf(res.url)}`,
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

async function checkHome(base, request) {
  const res = await request(`${base}/`, { method: "GET" });
  const read = await readResponse(res, base);
  if (!read.ok) return { name: "home", ...read };
  const problems = htmlProblems(read.res, read.text, { feed: true });
  return {
    name: "home",
    ok: problems.length === 0,
    detail: problems.length ? problems.join("; ") : "200 HTML, feed, CSP",
  };
}

async function checkFeed(base, request) {
  const res = await request(`${base}/api/articles?limit=1`, { method: "GET" });
  const read = await readResponse(res, base);
  if (!read.ok) return { name: "feed", ...read, slug: "" };
  if (read.res.status !== 200) {
    return { name: "feed", ok: false, detail: `HTTP ${read.res.status}`, slug: "" };
  }
  let body;
  try {
    body = JSON.parse(read.text);
  } catch {
    return { name: "feed", ok: false, detail: "response is not JSON", slug: "" };
  }
  const articles = body?.articles;
  if (!Array.isArray(articles) || articles.length === 0) {
    return { name: "feed", ok: false, detail: "feed returned no articles", slug: "" };
  }
  const slug = articles
    .map((article) => (article && typeof article.slug === "string" ? article.slug.trim() : ""))
    .find((value) => SLUG.test(value));
  if (!slug) return { name: "feed", ok: false, detail: "first article has no usable slug", slug: "" };
  return { name: "feed", ok: true, detail: "200 JSON with an article slug", slug };
}

async function checkArticle(base, request, slug) {
  if (!slug) {
    return { name: "article", ok: false, detail: "no article slug from the feed" };
  }
  const res = await request(`${base}/articles/${encodeURIComponent(slug)}`, { method: "GET" });
  const read = await readResponse(res, base);
  if (!read.ok) return { name: "article", ...read };
  const problems = htmlProblems(read.res, read.text, { feed: false });
  return {
    name: "article",
    ok: problems.length === 0,
    detail: problems.length ? problems.join("; ") : `200 HTML ${slug}`,
  };
}

async function checkHealth(base, request) {
  const res = await request(`${base}/api/agents/health`, { method: "GET" });
  const read = await readResponse(res, base);
  if (!read.ok) return { name: "health", ...read };
  if (read.res.status !== 200) {
    return { name: "health", ok: false, detail: `HTTP ${read.res.status}` };
  }
  let body;
  try {
    body = JSON.parse(read.text);
  } catch {
    return { name: "health", ok: false, detail: "response is not JSON" };
  }
  if (body?.ok !== true || body?.product !== "Open Paywall") {
    return { name: "health", ok: false, detail: "health JSON is missing ok:true or product" };
  }
  return { name: "health", ok: true, detail: "200 ok" };
}

async function checkBalance(request, { relayerAddress, rpcUrl, threshold }) {
  if (!relayerAddress) {
    return {
      name: "relayer-balance",
      ok: true,
      skipped: true,
      detail: "skipped: RELAYER_ADDRESS is not set (repository variable or secret)",
    };
  }
  if (!ADDRESS.test(relayerAddress)) {
    return {
      name: "relayer-balance",
      ok: false,
      detail: "RELAYER_ADDRESS is not a 0x-prefixed 20-byte address",
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
    return { name: "relayer-balance", ok: false, detail: `RPC HTTP ${res.status}` };
  }
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    return { name: "relayer-balance", ok: false, detail: "RPC response is not JSON" };
  }
  if (payload.error) {
    return {
      name: "relayer-balance",
      ok: false,
      detail: `RPC error ${payload.error.code || ""}`.trim(),
    };
  }
  let balance;
  try {
    balance = BigInt(payload.result);
  } catch {
    return { name: "relayer-balance", ok: false, detail: "RPC result is not a wei quantity" };
  }
  if (balance < threshold) {
    return {
      name: "relayer-balance",
      ok: false,
      detail: `${formatMon(balance)} is below ${formatMon(threshold)}`,
    };
  }
  return {
    name: "relayer-balance",
    ok: true,
    detail: `${formatMon(balance)} is at or above ${formatMon(threshold)}`,
  };
}

async function withRetries(name, fn, { attempts, retryMs, sleep }) {
  let last = { name, ok: false, detail: "not run" };
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      last = { name, ...(await fn()) };
    } catch (err) {
      last = { name, ok: false, detail: err?.message || String(err) };
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

export function renderReport(result) {
  const lines = [
    `Uptime checks for ${result.baseUrl}: ${result.ok ? "passed" : "failed"}.`,
    "",
    ...result.checks.map((check) => {
      const state = check.skipped ? "skip" : check.ok ? "ok" : "fail";
      const attempts = check.attempts ? ` (attempt ${check.attempts})` : "";
      return `- ${state} ${check.name}: ${check.detail}${attempts}`;
    }),
    "",
    "Read-only: HTTP GET against the site, and eth_getBalance when a relayer address is configured. No production data is created.",
  ];
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
  main().catch((err) => {
    const report = `Uptime checks failed before completing.\n\n${err?.message || err}\n`;
    if (process.env.UPTIME_REPORT_PATH) fs.writeFileSync(process.env.UPTIME_REPORT_PATH, report);
    console.error(report);
    process.exit(1);
  });
}
