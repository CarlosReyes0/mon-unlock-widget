/**
 * In-memory stand-in for public.take_rate_limit. Tests share one process
 * of this server across app restarts. Not used in production.
 */
import http from "node:http";

export function startMockRateLimitDb() {
  /** @type {Map<string, number>} */
  const rows = new Map();
  let fail = false;
  /** @type {{ method: string, path: string }[]} */
  const calls = [];

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    calls.push({ method: req.method || "GET", path: url.pathname });

    if (fail) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "db down" }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/rest/v1/rpc/take_rate_limit") {
      let body = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "bad json" }));
        return;
      }
      const id = `${body.p_bucket}|${String(body.p_key || "").toLowerCase()}|${body.p_day}`;
      const next = (rows.get(id) || 0) + 1;
      rows.set(id, next);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(next));
      return;
    }

    if (req.method === "POST" && url.pathname === "/storage/v1/bucket") {
      res.writeHead(409, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "The resource already exists" }));
      return;
    }

    if (req.method === "POST" && url.pathname.startsWith("/storage/v1/object/")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ Key: "article-media/x" }));
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("no");
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        server,
        url: `http://127.0.0.1:${port}`,
        calls,
        reset() {
          rows.clear();
          calls.length = 0;
          fail = false;
        },
        setFail(next) {
          fail = Boolean(next);
        },
      });
    });
  });
}
