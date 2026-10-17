/**
 * Wait until https://openpaywall.app answers, then run scripts/smoke.mjs.
 *
 * Railway's deployment_status success means the new container passed the
 * `/` healthcheck. This still polls GET /api/agents/health, because the
 * site does not publish a git SHA, then runs the existing smoke twice
 * before giving up. Smoke is HTTP-only (the same command as
 * `BASE_URL=https://openpaywall.app npm run smoke`).
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
  if (options.deploySha) {
    lines.push(`Railway reported success for ${options.deploySha}.`);
    lines.push(
      "The site does not publish a git SHA. Waiting until GET /api/agents/health returns ok, then running scripts/smoke.mjs."
    );
  }

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
      if (ok) {
        healthy = true;
        lines.push(`health ok on attempt ${attempt}`);
        break;
      }
      lines.push(`health attempt ${attempt}: HTTP ${res.status}`);
    } catch (err) {
      lines.push(`health attempt ${attempt}: ${err?.message || err}`);
    }
    if (attempt < healthAttempts) await sleep(healthDelayMs);
  }

  if (!healthy) {
    return { ok: false, smoked: false, log: lines.join("\n") };
  }

  let passed = false;
  for (let attempt = 1; attempt <= smokeAttempts; attempt += 1) {
    const result = await spawnImpl({ attempt, baseUrl: base });
    const output = String(result.log || "").trim();
    lines.push(`smoke attempt ${attempt} exit ${result.status}`);
    if (output) lines.push(output.slice(-8000));
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
    deploySha: process.env.DEPLOY_SHA || "",
  });
  const log = `${result.log}\n`;
  if (process.env.POST_DEPLOY_LOG) fs.writeFileSync(process.env.POST_DEPLOY_LOG, log);
  process.stdout.write(log);
  process.exit(result.ok ? 0 : 1);
}

const direct = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (direct) {
  main().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
}
