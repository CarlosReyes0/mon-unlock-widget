/**
 * Wait until https://openpaywall.app answers, then run scripts/smoke.mjs.
 *
 * Railway's deployment_status success means the new container passed the
 * `/` healthcheck. This still polls GET /api/agents/health, because the
 * site does not publish a git SHA, then runs the existing smoke twice
 * before giving up. Smoke is HTTP-only (the same command as
 * `BASE_URL=https://openpaywall.app npm run smoke`). Stdout is check names
 * and status codes only. The smoke process output is discarded.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function defaultSmokeSpawn({ baseUrl }) {
  const result = spawnSync(process.execPath, ["--test", "scripts/smoke.mjs"], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, BASE_URL: baseUrl },
  });
  return {
    status: result.status == null ? 1 : result.status,
    log: `${result.stdout || ""}${result.stderr || ""}`,
  };
}

export async function runPostDeploy(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const spawnImpl = options.spawnImpl || defaultSmokeSpawn;
  const base = String(options.baseUrl || process.env.BASE_URL || "https://openpaywall.app").replace(
    /\/$/,
    ""
  );
  const healthAttempts = options.healthAttempts ?? 6;
  const smokeAttempts = options.smokeAttempts ?? 2;
  const healthDelayMs = options.healthDelayMs ?? 10_000;
  const smokeDelayMs = options.smokeDelayMs ?? 20_000;
  const lines = [];

  let healthy = false;
  for (let attempt = 1; attempt <= healthAttempts; attempt += 1) {
    try {
      const res = await fetchImpl(`${base}/api/agents/health`, { method: "GET" });
      const text = await res.text();
      let ok = false;
      try {
        ok = res.status === 200 && JSON.parse(text).ok === true;
      } catch {
        ok = false;
      }
      const code = ok ? "200" : res.status && res.status !== 200 ? res.status : "fail";
      lines.push(`health status=${code}`);
      if (ok) {
        healthy = true;
        break;
      }
    } catch {
      lines.push("health status=fail");
    }
    if (attempt < healthAttempts) await sleep(healthDelayMs);
  }

  if (!healthy) {
    return { ok: false, smoked: false, log: lines.join("\n") };
  }

  let passed = false;
  for (let attempt = 1; attempt <= smokeAttempts; attempt += 1) {
    const result = await spawnImpl({ attempt, baseUrl: base });
    const status = result.status == null ? "fail" : result.status;
    lines.push(`smoke status=${status}`);
    if (result.status === 0) {
      passed = true;
      break;
    }
    if (attempt < smokeAttempts) await sleep(smokeDelayMs);
  }
  return { ok: passed, smoked: true, log: lines.join("\n") };
}

async function main() {
  const result = await runPostDeploy({
    baseUrl: process.env.BASE_URL,
  });
  const log = `${result.log}\n`;
  if (process.env.POST_DEPLOY_LOG) fs.writeFileSync(process.env.POST_DEPLOY_LOG, log);
  process.stdout.write(log);
  process.exit(result.ok ? 0 : 1);
}

const direct = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (direct) {
  main().catch(() => {
    const log = "post-deploy status=fail\n";
    if (process.env.POST_DEPLOY_LOG) fs.writeFileSync(process.env.POST_DEPLOY_LOG, log);
    process.stderr.write(log);
    process.exit(1);
  });
}
