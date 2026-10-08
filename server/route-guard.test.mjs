/**
 * An async route rejection must answer 500. It must not take the process down.
 */
import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { guardRequest } from "./route-guard.mjs";

function listen(handler) {
  const server = http.createServer(guardRequest(handler));
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, origin: `http://127.0.0.1:${port}` });
    });
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

test("a rejected route returns 500 and the next request still succeeds", async () => {
  const rejections = [];
  const onRejection = (reason) => {
    rejections.push(reason);
  };
  process.on("unhandledRejection", onRejection);
  const { server, origin } = await listen(async (req, res) => {
    if (req.url === "/boom") throw new Error("Could not find the table 'public.follows'");
    if (req.url === "/reject") return Promise.reject(new Error("store rejected"));
    if (req.url === "/late") {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end("partial");
      throw new Error("after headers");
    }
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end("ok");
  });
  try {
    const boom = await fetch(`${origin}/boom`);
    assert.equal(boom.status, 500);
    assert.equal(boom.headers.get("cache-control"), "no-store");
    assert.deepEqual(await boom.json(), { error: "internal_error" });

    const rejected = await fetch(`${origin}/reject`);
    assert.equal(rejected.status, 500);
    assert.deepEqual(await rejected.json(), { error: "internal_error" });

    const late = await fetch(`${origin}/late`);
    assert.equal(late.status, 200);
    assert.equal(await late.text(), "partial");

    const ok = await fetch(`${origin}/next`);
    assert.equal(ok.status, 200);
    assert.equal(await ok.text(), "ok");
    assert.equal(rejections.length, 0);
  } finally {
    process.off("unhandledRejection", onRejection);
    await close(server);
  }
});
