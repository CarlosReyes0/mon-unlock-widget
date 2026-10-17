import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import {
  pickRollbackTarget,
  rollbackAllowed,
  rollbackInstructions,
  runRollback,
} from "./railway-rollback.mjs";

const history = [
  { id: "new", status: "SUCCESS", createdAt: "2026-10-17T07:45:00Z", canRollback: true },
  { id: "old", status: "REMOVED", createdAt: "2026-10-17T06:40:00Z", canRollback: true },
  { id: "older", status: "REMOVED", createdAt: "2026-10-17T05:00:00Z", canRollback: false },
];

test("rollback targets the previous deployment Railway can restore", () => {
  const picked = pickRollbackTarget(history);
  assert.equal(picked.current.id, "new");
  assert.equal(picked.target.id, "old");
  assert.equal(pickRollbackTarget([history[0]]).target, null);
});

test("auto-rollback stays off unless execute, token, and opt-in are all set", () => {
  assert.equal(rollbackAllowed({ execute: true, token: "tok", optIn: "true" }), true);
  assert.equal(rollbackAllowed({ execute: true, token: "tok", optIn: "yes" }), false);
  assert.equal(rollbackAllowed({ execute: true, token: "", optIn: "true" }), false);
  assert.equal(rollbackAllowed({ execute: false, token: "tok", optIn: "true" }), false);
});

test("print mode does not call Railway, and the instructions omit the token", async () => {
  let called = 0;
  const result = await runRollback({
    execute: false,
    token: "super-secret-token",
    optIn: "true",
    fetchImpl: async () => {
      called += 1;
      throw new Error("should not be called");
    },
  });
  assert.equal(called, 0);
  assert.equal(result.executed, false);
  assert.match(result.instructions, /node scripts\/railway-rollback\.mjs --execute/);
  assert.equal(result.instructions.includes("super-secret-token"), false);
  assert.match(result.instructions, /sparkling-transformation/);
});

test("--execute with the opt-in rolls back the previous deployment", async () => {
  const calls = [];
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ query: body.query, variables: body.variables, auth: init.headers.authorization });
    if (body.query.startsWith("query")) {
      return new Response(
        JSON.stringify({
          data: { deployments: { edges: history.map((node) => ({ node })) } },
        }),
        { status: 200 }
      );
    }
    return new Response(
      JSON.stringify({ data: { deploymentRollback: { id: "rolled", status: "DEPLOYING" } } }),
      { status: 200 }
    );
  };
  const result = await runRollback({
    execute: true,
    token: "super-secret-token",
    optIn: "true",
    fetchImpl,
  });
  assert.equal(result.executed, true);
  assert.equal(result.targetId, "old");
  assert.equal(result.rollback.id, "rolled");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].variables.id, "old");
  assert.equal(calls[0].auth, "Bearer super-secret-token");
  assert.equal(result.instructions.includes("super-secret-token"), false);
});

test("the workflow gates --execute on the token and the opt-in variable", () => {
  const workflow = fs.readFileSync(new URL("../.github/workflows/post-deploy.yml", import.meta.url), "utf8");
  assert.match(workflow, /sparkling-transformation \/ production/);
  assert.match(workflow, /deployment_status\.state == 'success'/);
  assert.match(workflow, /deployment_status\.state == 'failure'/);
  assert.match(workflow, /secrets\.RAILWAY_TOKEN != ''/);
  assert.match(workflow, /vars\.PROD_AUTO_ROLLBACK == 'true'/);
  const execute = workflow.split("\n").filter((line) => line.includes("--execute"));
  assert.equal(execute.length, 1);
  const step = workflow.slice(workflow.indexOf("name: Auto-rollback"));
  assert.match(step, /secrets\.RAILWAY_TOKEN != ''/);
  assert.match(step, /PROD_AUTO_ROLLBACK/);
  assert.match(step, /--execute/);
});

test("instructions mention the dashboard when no token exists", () => {
  const text = rollbackInstructions();
  assert.match(text, /railway\.com\/project\/fb92c2a6-8d67-4530-80d7-890e53255877/);
  assert.match(text, /RAILWAY_TOKEN/);
});
