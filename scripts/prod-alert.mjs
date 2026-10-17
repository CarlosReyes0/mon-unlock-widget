/**
 * Open, update, or close one GitHub issue per production alert.
 *
 * The uptime schedule and the post-deploy smoke both use this. While a check
 * keeps failing, the same open issue (label `prod-alert`, body marker
 * `prod-alert-key:<key>`) is edited in place. A comment is added only when
 * the failure summary changes. A passing run closes that issue.
 *
 *   node scripts/prod-alert.mjs --key uptime --failing true --title "..." --body-file report.md
 *   node scripts/prod-alert.mjs --key uptime --failing false --dry-run
 *
 * Requires `gh` and GH_TOKEN (the workflow's GITHUB_TOKEN) unless --dry-run.
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PROD_ALERT_LABEL = "prod-alert";

export function summaryHash(summary) {
  return createHash("sha256").update(String(summary || "")).digest("hex").slice(0, 12);
}

export function alertMarker(key) {
  return `prod-alert-key:${key}`;
}

export function renderAlertBody({ key, detail, now = new Date().toISOString() }) {
  const summary = String(detail || "").trim();
  return [
    `<!-- ${alertMarker(key)} -->`,
    `<!-- prod-alert-summary:${summaryHash(summary)} -->`,
    "",
    summary,
    "",
    `Last checked: ${now}`,
    "",
    "This issue stays open while the check keeps failing. A later passing run closes it.",
  ].join("\n");
}

/**
 * @param {{ key: string, openIssues: { number: number, body?: string }[], failing: boolean, detail: string }} input
 */
export function alertPlan(input) {
  const marker = alertMarker(input.key);
  const existing = (input.openIssues || [])
    .filter((issue) => String(issue.body || "").includes(marker))
    .sort((a, b) => a.number - b.number)[0];
  if (input.failing) {
    if (!existing) return { action: "open" };
    const same = String(existing.body || "").includes(
      `prod-alert-summary:${summaryHash(input.detail)}`
    );
    return { action: same ? "refresh" : "update", number: existing.number };
  }
  if (existing) return { action: "close", number: existing.number };
  return { action: "noop" };
}

function parseArgs(argv) {
  const out = { failing: false, dryRun: false, key: "", title: "", body: "", bodyFile: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--failing") out.failing = argv[++i] === "true";
    else if (arg === "--key") out.key = argv[++i] || "";
    else if (arg === "--title") out.title = argv[++i] || "";
    else if (arg === "--body") out.body = argv[++i] || "";
    else if (arg === "--body-file") out.bodyFile = argv[++i] || "";
    else throw new Error(`unknown argument ${arg}`);
  }
  if (!out.key) throw new Error("--key is required");
  return out;
}

function repoSlug() {
  return process.env.GITHUB_REPOSITORY || "";
}

function gh(args, { allowFail = false } = {}) {
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFail) {
    const message = (result.stderr || result.stdout || "gh failed").trim();
    throw new Error(message.slice(0, 800));
  }
  return result.stdout || "";
}

function readDetail(args) {
  if (args.bodyFile) return fs.readFileSync(args.bodyFile, "utf8");
  return args.body;
}

function listOpenIssues(repo) {
  const result = spawnSync(
    "gh",
    [
      "issue",
      "list",
      "--repo",
      repo,
      "--label",
      PROD_ALERT_LABEL,
      "--state",
      "open",
      "--limit",
      "50",
      "--json",
      "number,title,body",
    ],
    { encoding: "utf8", env: process.env }
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const message = `${result.stderr || ""}\n${result.stdout || ""}`;
    if (/label .+ could not be found|not found/i.test(message)) return [];
    throw new Error(message.trim().slice(0, 800));
  }
  const parsed = (result.stdout || "").trim() ? JSON.parse(result.stdout) : [];
  return Array.isArray(parsed) ? parsed : [];
}

function ensureLabel(repo) {
  gh(
    [
      "label",
      "create",
      PROD_ALERT_LABEL,
      "--repo",
      repo,
      "--color",
      "B60205",
      "--description",
      "Production uptime or deploy failure",
    ],
    { allowFail: true }
  );
}

function writeBodyFile(body) {
  const path = `/tmp/prod-alert-body-${process.pid}.md`;
  fs.writeFileSync(path, body);
  return path;
}

export function applyAlert({ repo, title, key, failing, detail, openIssues, now, run = gh }) {
  const plan = alertPlan({ key, openIssues, failing, detail });
  const body = renderAlertBody({ key, detail, now });
  if (plan.action === "noop") return { plan, body };
  if (plan.action === "open") {
    ensureLabel(repo);
    const file = writeBodyFile(body);
    run([
      "issue",
      "create",
      "--repo",
      repo,
      "--title",
      title,
      "--label",
      PROD_ALERT_LABEL,
      "--body-file",
      file,
    ]);
    return { plan, body };
  }
  const file = writeBodyFile(body);
  run(["issue", "edit", String(plan.number), "--repo", repo, "--body-file", file]);
  if (plan.action === "update") {
    run([
      "issue",
      "comment",
      String(plan.number),
      "--repo",
      repo,
      "--body",
      "The failure changed. The issue body is the latest check.",
    ]);
  }
  if (plan.action === "close") {
    run([
      "issue",
      "comment",
      String(plan.number),
      "--repo",
      repo,
      "--body",
      `Recovered at ${now || new Date().toISOString()}.`,
    ]);
    run(["issue", "close", String(plan.number), "--repo", repo, "--reason", "completed"]);
  }
  return { plan, body };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const detail = readDetail(args).trim();
  if (args.failing && !detail) throw new Error("a failing alert needs --body or --body-file");
  const title = args.title || `[prod-alert] ${args.key}`;
  if (args.dryRun) {
    const plan = alertPlan({ key: args.key, openIssues: [], failing: args.failing, detail });
    process.stdout.write(`${JSON.stringify({ ...plan, title, dryRun: true })}\n`);
    return;
  }
  const repo = repoSlug();
  if (!repo) throw new Error("GITHUB_REPOSITORY is not set");
  if (!process.env.GH_TOKEN && !process.env.GITHUB_TOKEN) {
    throw new Error("GH_TOKEN is not set");
  }
  const openIssues = listOpenIssues(repo);
  const { plan } = applyAlert({
    repo,
    title,
    key: args.key,
    failing: args.failing,
    detail: detail || "Checks passed.",
    openIssues,
  });
  process.stdout.write(`${plan.action}${plan.number ? ` #${plan.number}` : ""}\n`);
}

const direct = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (direct) {
  try {
    main();
  } catch (err) {
    console.error(err?.message || err);
    process.exit(1);
  }
}
