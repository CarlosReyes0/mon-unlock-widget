/**
 * Last-resort guard for the HTTP request listener.
 * An async route that rejects must answer 500 instead of becoming an
 * unhandled rejection (Node exits, and the host restarts into 502s).
 * This does not install a process-level handler.
 */

export function respondRouteError(res, err) {
  console.error("[server] unhandled route error:", err?.stack || err?.message || err);
  if (!res || res.writableEnded || res.headersSent) return;
  const payload = JSON.stringify({ error: "internal_error" });
  try {
    res.writeHead(500, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Length": Buffer.byteLength(payload),
    });
    res.end(payload);
  } catch (writeErr) {
    console.error("[server] error response failed:", writeErr?.stack || writeErr?.message || writeErr);
    try {
      res.destroy();
    } catch {
      /* socket already closed */
    }
  }
}

export function guardRequest(handler) {
  return function guardedRequest(req, res) {
    Promise.resolve()
      .then(() => handler(req, res))
      .catch((err) => respondRouteError(res, err));
  };
}
