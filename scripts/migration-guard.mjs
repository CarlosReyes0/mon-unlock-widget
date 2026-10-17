/**
 * Fail or warn when a pull request changes Supabase migrations that are not
 * recorded on production.
 *
 * Prod rows live in supabase_migrations.schema_migrations. This repo applies
 * each file with apply_migration, which stores a new timestamp as `version`
 * and the name we pass as `name`. Those versions do not match the filename
 * prefix. Example from production:
 *
 *   file    20260916094014_restrict_articles_body.sql
 *   version 20260916094116
 *   name    restrict_articles_body
 *
 *   file    0015_writer_follows.sql
 *   version 20261008050930
 *   name    0015_writer_follows
 *
 * `supabase migration list` compares versions only, so it cannot be the
 * check. A file counts as applied when `name` equals either the filename
 * without `.sql` or the slug after the leading number. schema_migrations
 * does not store the SQL body, so a content match against prod is not
 * possible. If the PR edits a file whose name is already recorded, the new
 * bytes will not re-run; that is a failure once the token is set.
 *
 * The check only looks at migrations the PR adds, edits, or deletes. Older
 * files that were applied outside apply_migration (0006, 0008, and others
 * are missing from schema_migrations even though their tables exist) do not
 * fail unrelated PRs.
 *
 * Secret SUPABASE_ACCESS_TOKEN — personal access token for
 *   GET /v1/projects/{ref}/database/migrations
 *   When it is absent, the job still passes and posts a checklist.
 * Variable SUPABASE_PROJECT_REF — optional, default flczjqljgntmkanipugo.
 *
 * This script only GETs that list. It never calls apply_migration.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_PROJECT_REF = "flczjqljgntmkanipugo";
export const COMMENT_MARKER = "<!-- migration-guard -->";

export function migrationIdentity(filename) {
  const base = path.basename(String(filename || ""));
  const stem = base.replace(/\.sql$/i, "");
  const slug = stem.replace(/^\d+_/, "");
  const version = /^\d+/.exec(stem)?.[0] || "";
  return { filename: String(filename || ""), stem, slug, version };
}

/** True when a recorded name is the filename stem or the slug after its numeric prefix. */
export function isApplied(identity, prodRows) {
  const names = new Set((prodRows || []).map((row) => String(row?.name || "").trim()).filter(Boolean));
  return names.has(identity.stem) || names.has(identity.slug);
}

export function createdTables(sql) {
  const stripped = String(sql || "").replace(/--[^\n]*/g, "");
  const names = new Set();
  const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?/gi;
  for (const match of stripped.matchAll(re)) names.add(match[1]);
  return [...names];
}

export function tablesMentioned(codeDiff, tables) {
  const text = String(codeDiff || "");
  return tables.filter((table) => new RegExp(`\\b${table}\\b`).test(text));
}

export function parseMigrationList(payload) {
  const rows = Array.isArray(payload)
    ? payload
    : payload?.migrations || payload?.data || [];
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => ({
    version: String(row?.version || ""),
    name: String(row?.name || ""),
  }));
}

export function decide({ files = [], codeDiff = "", prod = null, hasToken = false, apiError = "" } = {}) {
  if (!files.length) {
    return { exitCode: 0, level: "ok", comment: "", pending: [], edited: [], applied: [], mentions: [] };
  }
  if (hasToken && apiError) {
    return {
      exitCode: 1,
      level: "fail",
      pending: [],
      edited: [],
      applied: [],
      mentions: [],
      comment: renderComment({
        level: "fail",
        apiError,
        files,
      }),
    };
  }

  const pending = [];
  const edited = [];
  const applied = [];
  for (const file of files) {
    const identity = migrationIdentity(file.filename);
    const recorded = hasToken && isApplied(identity, prod);
    if (file.status === "deleted") {
      pending.push({ ...identity, status: "deleted", reason: "deleted in this PR; confirm prod does not still depend on it" });
      continue;
    }
    if (recorded && file.status === "modified") {
      edited.push({
        ...identity,
        status: "modified",
        reason: "already recorded on prod, so apply_migration will not re-run this edit",
      });
      continue;
    }
    if (recorded) {
      applied.push({ ...identity, status: file.status });
      continue;
    }
    pending.push({
      ...identity,
      status: file.status,
      reason: hasToken
        ? "name is not in supabase_migrations.schema_migrations"
        : "not checked against prod (SUPABASE_ACCESS_TOKEN is unset)",
    });
  }

  const newTables = files
    .filter((file) => file.status === "added")
    .flatMap((file) => createdTables(file.head || ""));
  const mentions = tablesMentioned(codeDiff, newTables);
  const problems = pending.length + edited.length;
  if (!problems) {
    return {
      exitCode: 0,
      level: "ok",
      pending,
      edited,
      applied,
      mentions,
      comment: renderComment({ level: "ok", files, applied, mentions }),
    };
  }
  if (!hasToken) {
    return {
      exitCode: 0,
      level: "warn",
      pending,
      edited,
      applied,
      mentions,
      comment: renderComment({ level: "warn", files, pending, edited, applied, mentions }),
    };
  }
  return {
    exitCode: 1,
    level: "fail",
    pending,
    edited,
    applied,
    mentions,
    comment: renderComment({ level: "fail", files, pending, edited, applied, mentions }),
  };
}

function fileLine(item) {
  const nameHint = item.slug === item.stem ? `\`${item.stem}\`` : `\`${item.stem}\` or \`${item.slug}\``;
  return `- [ ] \`${item.filename}\` — record the name as ${nameHint}. ${item.reason || ""}`.trim();
}

export function renderComment({ level, files = [], pending = [], edited = [], applied = [], mentions = [], apiError = "" }) {
  const lines = [
    COMMENT_MARKER,
    "",
    "### Migrations must be applied before merging",
    "",
  ];
  if (apiError) {
    lines.push(
      "`SUPABASE_ACCESS_TOKEN` is set, but listing production migrations failed. This PR is blocked until the list can be read.",
      "",
      apiError,
      ""
    );
  } else if (level === "ok") {
    lines.push(
      "The migration files in this PR are already recorded on production (matched by name, not by the filename timestamp).",
      ""
    );
  } else if (level === "warn") {
    lines.push(
      "`SUPABASE_ACCESS_TOKEN` is not set, so CI cannot compare this PR to production. Apply these files before merging. The check stays green until that secret exists; after it exists, an unapplied migration fails the job.",
      ""
    );
  } else {
    lines.push(
      "Production does not yet have every migration in this PR, or a file that was already recorded was edited. Apply the new SQL before merging. Editing a recorded file does not re-run it; add a new migration instead.",
      ""
    );
  }
  const flagged = [...pending, ...edited];
  if (flagged.length) {
    lines.push(...flagged.map(fileLine), "");
  }
  if (applied.length) {
    lines.push("Already recorded:", ...applied.map((item) => `- \`${item.filename}\` (\`${item.slug}\`)`), "");
  }
  if (mentions.length) {
    lines.push(
      `Code in this PR mentions new tables from these migrations: ${mentions.map((name) => `\`${name}\``).join(", ")}.`,
      ""
    );
  }
  lines.push(
    "How the match works: `GET /v1/projects/{ref}/database/migrations` returns `version` and `name`. `version` is the timestamp from `apply_migration`, not the filename prefix (`20260916094014_restrict_articles_body.sql` is stored as version `20260916094116`, name `restrict_articles_body`). `0015_writer_follows.sql` was stored under the full stem `0015_writer_follows`. A file is applied when `name` equals the stem or the slug after the leading number. The SQL body is not stored, so content cannot be compared to prod.",
    "",
    "Record each new file with `apply_migration` (management API `POST /v1/projects/{ref}/database/migrations`) using that name. Running the SQL in the editor without recording a name will not clear this check.",
    "",
    "Secret: `SUPABASE_ACCESS_TOKEN`. Optional variable: `SUPABASE_PROJECT_REF` (default `flczjqljgntmkanipugo`)."
  );
  if (!files.length) return "";
  return `${lines.join("\n")}\n`;
}

export async function fetchProdMigrations({ token, projectRef, fetchImpl = globalThis.fetch }) {
  const ref = projectRef || DEFAULT_PROJECT_REF;
  const res = await fetchImpl(
    `https://api.supabase.com/v1/projects/${encodeURIComponent(ref)}/database/migrations`,
    {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
      },
    }
  );
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Supabase management API GET /database/migrations returned HTTP ${res.status}`);
  }
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("Supabase management API returned a body that is not JSON");
  }
  return parseMigrationList(payload);
}

function git(args) {
  const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `git ${args.join(" ")} failed`).trim());
  }
  return result.stdout;
}

function showFile(ref, file) {
  const result = spawnSync("git", ["show", `${ref}:${file}`], { cwd: ROOT, encoding: "utf8" });
  if (result.status !== 0) return "";
  return result.stdout;
}

export function readChanges(baseRef) {
  const mergeBase = git(["merge-base", baseRef, "HEAD"]).trim();
  const nameStatus = git([
    "diff",
    "--name-status",
    mergeBase,
    "HEAD",
    "--",
    "supabase/migrations",
  ]);
  const files = [];
  for (const line of nameStatus.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const flag = parts[0];
    let status = "modified";
    let filename = parts[1];
    let baseFile = parts[1];
    if (flag.startsWith("A")) status = "added";
    else if (flag.startsWith("D")) status = "deleted";
    else if (flag.startsWith("R") || flag.startsWith("C")) {
      status = "added";
      baseFile = parts[1];
      filename = parts[2];
    }
    files.push({
      filename,
      status,
      base: status === "added" && !flag.startsWith("R") && !flag.startsWith("C") ? "" : showFile(mergeBase, baseFile),
      head: status === "deleted" ? "" : showFile("HEAD", filename),
    });
  }
  const codeDiff = git([
    "diff",
    "-U0",
    mergeBase,
    "HEAD",
    "--",
    ".",
    ":(exclude)supabase/migrations",
  ]);
  return { files, codeDiff: codeDiff.slice(0, 500_000) };
}

function parseArgs(argv) {
  const out = { base: "", commentFile: "", postComment: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--base") out.base = argv[++i] || "";
    else if (arg === "--comment-file") out.commentFile = argv[++i] || "";
    else if (arg === "--post-comment") out.postComment = argv[++i] || "";
    else throw new Error(`unknown argument ${arg}`);
  }
  return out;
}

function gh(args) {
  const result = spawnSync("gh", args, { encoding: "utf8", env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "gh failed").trim().slice(0, 800));
  }
  return result.stdout || "";
}

export function postCommentFile(file) {
  if (!file || !fs.existsSync(file)) {
    console.log("no migration checklist to post");
    return;
  }
  const body = fs.readFileSync(file, "utf8");
  if (!body.trim()) return;
  const repo = process.env.GITHUB_REPOSITORY || "";
  const pr = process.env.PR_NUMBER || "";
  if (!repo || !pr || (!process.env.GH_TOKEN && !process.env.GITHUB_TOKEN)) {
    process.stdout.write(body);
    return;
  }
  const raw = gh(["api", `repos/${repo}/issues/${pr}/comments?per_page=100`]);
  const comments = JSON.parse(raw);
  const existing = (Array.isArray(comments) ? comments : []).find((comment) =>
    String(comment.body || "").includes(COMMENT_MARKER)
  );
  const payload = path.join("/tmp", `migration-guard-${process.pid}.json`);
  fs.writeFileSync(payload, JSON.stringify({ body }));
  if (existing) {
    gh(["api", "--method", "PATCH", `repos/${repo}/issues/comments/${existing.id}`, "--input", payload]);
    console.log(`updated checklist comment ${existing.id}`);
  } else {
    gh(["api", "--method", "POST", `repos/${repo}/issues/${pr}/comments`, "--input", payload]);
    console.log("posted checklist comment");
  }
}

function annotate(result) {
  const severity = result.level === "fail" ? "error" : result.level === "warn" ? "warning" : "";
  if (!severity) return;
  for (const item of [...result.pending, ...result.edited]) {
    const reason = String(item.reason || "migration needs attention").replace(/\n/g, " ");
    console.log(`::${severity} file=${item.filename},line=1::${reason}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.postComment) {
    try {
      postCommentFile(args.postComment);
    } catch (err) {
      console.log(`could not post the checklist comment: ${err?.message || err}`);
    }
    return;
  }
  const base = args.base || (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : "HEAD");
  const { files, codeDiff } = readChanges(base);
  const token = String(process.env.SUPABASE_ACCESS_TOKEN || "").trim();
  const projectRef = String(process.env.SUPABASE_PROJECT_REF || "").trim() || DEFAULT_PROJECT_REF;
  let prod = null;
  let apiError = "";
  if (token && files.length) {
    try {
      prod = await fetchProdMigrations({ token, projectRef });
    } catch (err) {
      apiError = err?.message || String(err);
    }
  }
  const result = decide({ files, codeDiff, prod, hasToken: Boolean(token), apiError });
  if (result.comment && args.commentFile) fs.writeFileSync(args.commentFile, result.comment);
  annotate(result);
  if (result.level === "ok" && !files.length) {
    console.log("no supabase migration changes");
  } else {
    console.log(result.comment || "migration guard passed");
  }
  process.exit(result.exitCode);
}

const direct = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (direct) {
  main().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
}
