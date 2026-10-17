/**
 * Print the one-command rollback for the public Open Paywall service, and
 * optionally perform it.
 *
 * openpaywall.app is Railway project sparkling-transformation, service
 * "mon widget dashboard". Those ids are public on the GitHub deployment
 * for environment "sparkling-transformation / production". Override them
 * with RAILWAY_PROJECT_ID, RAILWAY_SERVICE_ID, and RAILWAY_ENVIRONMENT_ID.
 *
 * Default (no flags) only prints instructions. --execute calls Railway's
 * deploymentRollback mutation for the previous deployment that can roll
 * back, and only when both of these are set:
 *
 *   Secret   RAILWAY_TOKEN           account or project token
 *   Variable PROD_AUTO_ROLLBACK=true
 *
 * The Railway CLI cannot target an older deployment. The dashboard and
 * this GraphQL mutation can. Nothing here runs unless --execute is passed
 * and the opt-in variable is exactly "true".
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

export const RAILWAY_GRAPHQL = "https://backboard.railway.com/graphql/v2";

export const DEFAULT_RAILWAY_IDS = {
  projectId: "fb92c2a6-8d67-4530-80d7-890e53255877",
  serviceId: "b3c4f319-501d-4cb4-b697-7b013a342b5a",
  environmentId: "afc48f89-6d17-4824-a26b-e3096bd3214a",
};

const LIST_QUERY = `query deployments($input: DeploymentListInput!, $first: Int) {
  deployments(input: $input, first: $first) {
    edges { node { id status createdAt canRollback } }
  }
}`;

const ROLLBACK_MUTATION = `mutation deploymentRollback($id: String!) {
  deploymentRollback(id: $id) { id status }
}`;

export function railwayIds(env = process.env) {
  return {
    projectId: String(env.RAILWAY_PROJECT_ID || "").trim() || DEFAULT_RAILWAY_IDS.projectId,
    serviceId: String(env.RAILWAY_SERVICE_ID || "").trim() || DEFAULT_RAILWAY_IDS.serviceId,
    environmentId:
      String(env.RAILWAY_ENVIRONMENT_ID || "").trim() || DEFAULT_RAILWAY_IDS.environmentId,
  };
}

export function dashboardUrl(ids) {
  return `https://railway.com/project/${ids.projectId}/service/${ids.serviceId}?environmentId=${ids.environmentId}`;
}

export function rollbackAllowed({ execute, token, optIn }) {
  return Boolean(execute && String(token || "").trim() && String(optIn || "") === "true");
}

/** Newest deployment is current. The target is the next older one Railway can restore. */
export function pickRollbackTarget(deployments) {
  const sorted = [...(deployments || [])]
    .filter((item) => item && item.id)
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  const current = sorted[0] || null;
  const target = sorted.slice(1).find((item) => item.canRollback === true) || null;
  return { current, target };
}

export function rollbackInstructions(ids = DEFAULT_RAILWAY_IDS) {
  return [
    "Rollback the public site (openpaywall.app).",
    'Railway service: "mon widget dashboard" in project sparkling-transformation.',
    "empowering-surprise also deploys this repo and is not the public site, so it is left alone.",
    "",
    "Dashboard (no token):",
    dashboardUrl(ids),
    "Deployments → last known-good deployment → ⋯ → Rollback.",
    "That restores the previous image and its variables. There is no rebuild.",
    "",
    "One command, once Actions secret RAILWAY_TOKEN is set",
    "(Railway account token, or a project token for sparkling-transformation).",
    "It refuses to run unless repository variable PROD_AUTO_ROLLBACK is exactly true:",
    "",
    "RAILWAY_TOKEN=... PROD_AUTO_ROLLBACK=true node scripts/railway-rollback.mjs --execute",
    "",
    "Optional variables if the service is recreated: RAILWAY_PROJECT_ID, RAILWAY_SERVICE_ID, RAILWAY_ENVIRONMENT_ID.",
  ].join("\n");
}

async function graphql(fetchImpl, token, query, variables) {
  const res = await fetchImpl(RAILWAY_GRAPHQL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  const text = await res.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`Railway GraphQL HTTP ${res.status} was not JSON`);
  }
  if (!res.ok || payload.errors?.length) {
    const message = payload.errors?.map((error) => error.message).filter(Boolean).join("; ");
    throw new Error(message || `Railway GraphQL HTTP ${res.status}`);
  }
  return payload.data || {};
}

export async function runRollback(options = {}) {
  const env = options.env || process.env;
  const ids = options.ids || railwayIds(env);
  const execute = Boolean(options.execute);
  const token = options.token ?? env.RAILWAY_TOKEN ?? "";
  const optIn = options.optIn ?? env.PROD_AUTO_ROLLBACK ?? "";
  const instructions = rollbackInstructions(ids);
  if (!rollbackAllowed({ execute, token, optIn })) {
    return {
      ok: true,
      executed: false,
      instructions,
      reason: "auto-rollback is off (needs --execute, RAILWAY_TOKEN, and PROD_AUTO_ROLLBACK=true)",
    };
  }
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const listed = await graphql(fetchImpl, token, LIST_QUERY, {
    input: {
      projectId: ids.projectId,
      serviceId: ids.serviceId,
      environmentId: ids.environmentId,
    },
    first: 10,
  });
  const nodes = (listed.deployments?.edges || []).map((edge) => edge?.node).filter(Boolean);
  const { current, target } = pickRollbackTarget(nodes);
  if (!target) {
    return {
      ok: false,
      executed: false,
      instructions,
      reason: "no previous deployment can be rolled back",
      currentId: current?.id || "",
    };
  }
  const rolled = await graphql(fetchImpl, token, ROLLBACK_MUTATION, { id: target.id });
  return {
    ok: true,
    executed: true,
    instructions,
    targetId: target.id,
    currentId: current?.id || "",
    rollback: rolled.deploymentRollback || null,
  };
}

async function main() {
  const execute = process.argv.includes("--execute");
  const result = await runRollback({ execute });
  process.stdout.write(`${result.instructions}\n`);
  if (!execute) return;
  if (!result.executed) {
    process.stdout.write(`\nAuto-rollback did not run: ${result.reason}\n`);
    if (!result.ok) process.exit(1);
    return;
  }
  const next = result.rollback || {};
  process.stdout.write(
    `\nRolled back to ${result.targetId}. Railway returned ${next.id || "(no id)"} ${next.status || ""}.\n`
  );
}

const direct = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (direct) {
  main().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
}
