import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { runPostDeploy } from "./post-deploy-smoke.mjs";

const noSleep = async () => {};

function healthThenSmoke({ healthFailures, smokeFailures }) {
  let healthHits = 0;
  let smokeHits = 0;
  const fetchImpl = async (url, init) => {
    assert.equal(init.method, "GET");
    assert.match(url, /\/api\/agents\/health$/);
    healthHits += 1;
    if (healthHits <= healthFailures) return new Response("nope", { status: 503 });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const spawnImpl = async () => {
    smokeHits += 1;
    return { status: smokeHits <= smokeFailures ? 1 : 0, log: `smoke ${smokeHits}` };
  };
  return {
    fetchImpl,
    spawnImpl,
    healthHits: () => healthHits,
    smokeHits: () => smokeHits,
  };
}

test("health and smoke are retried before the deploy is called a failure", async () => {
  const fake = healthThenSmoke({ healthFailures: 1, smokeFailures: 1 });
  const result = await runPostDeploy({
    baseUrl: "https://openpaywall.app",
    fetchImpl: fake.fetchImpl,
    spawnImpl: fake.spawnImpl,
    sleep: noSleep,
    healthAttempts: 3,
    smokeAttempts: 2,
  });
  assert.equal(result.ok, true);
  assert.equal(fake.healthHits(), 2);
  assert.equal(fake.smokeHits(), 2);
  assert.match(result.log, /health status=503/);
  assert.match(result.log, /health status=200/);
  assert.match(result.log, /smoke status=1/);
  assert.match(result.log, /smoke status=0/);
  assert.equal(result.log.includes("smoke 1"), false);
  assert.equal(result.log.includes("smoke 2"), false);
});

test("smoke does not run when the public health endpoint stays down", async () => {
  const fake = healthThenSmoke({ healthFailures: 5, smokeFailures: 0 });
  const result = await runPostDeploy({
    baseUrl: "https://openpaywall.app",
    fetchImpl: fake.fetchImpl,
    spawnImpl: fake.spawnImpl,
    sleep: noSleep,
    healthAttempts: 3,
    smokeAttempts: 2,
  });
  assert.equal(result.ok, false);
  assert.equal(result.smoked, false);
  assert.equal(fake.smokeHits(), 0);
});

test("two smoke failures fail the check", async () => {
  const fake = healthThenSmoke({ healthFailures: 0, smokeFailures: 5 });
  const result = await runPostDeploy({
    baseUrl: "https://openpaywall.app",
    fetchImpl: fake.fetchImpl,
    spawnImpl: fake.spawnImpl,
    sleep: noSleep,
    healthAttempts: 1,
    smokeAttempts: 2,
  });
  assert.equal(result.ok, false);
  assert.equal(result.smoked, true);
  assert.equal(fake.smokeHits(), 2);
});

test("the runner shells out to the existing smoke file", () => {
  const source = fs.readFileSync(new URL("./post-deploy-smoke.mjs", import.meta.url), "utf8");
  assert.match(source, /scripts\/smoke\.mjs/);
  assert.doesNotMatch(source, /eth_send|method:\s*"POST"/);
  assert.doesNotMatch(source, /output\.slice|lines\.push\(output|lines\.push\(.*result\.log/);
});

test("public log omits the deploy sha, smoke output, and error text", async () => {
  const result = await runPostDeploy({
    baseUrl: "https://openpaywall.app",
    deploySha: "0123456789abcdef",
    fetchImpl: async () => {
      throw new Error("https://user:secret@example.invalid/private");
    },
    spawnImpl: async () => ({ status: 1, log: "article slug hello-post body" }),
    sleep: noSleep,
    healthAttempts: 1,
    smokeAttempts: 1,
  });
  assert.equal(result.ok, false);
  assert.equal(result.smoked, false);
  assert.match(result.log, /health status=fail/);
  assert.equal(result.log.includes("0123456789abcdef"), false);
  assert.equal(result.log.includes("secret"), false);
  assert.equal(result.log.includes("hello-post"), false);
});
