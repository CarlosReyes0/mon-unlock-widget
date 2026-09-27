/**
 * Inbound JSON body caps.
 *
 * Article routes (agent publish, x402 publish, Write voice drafts, MiroShark
 * preview) may include a full essay. Everything else stays on the small cap.
 */

/** Stripe intent, relay metadata, subscriptions, x402 unlock credentials. */
export const DEFAULT_JSON_BODY_LIMIT = 64_000;

/**
 * Full article markdown (teaser + body). ~10k words is 60–100KB; 512KB matches
 * the agent publish allowance.
 */
export const ARTICLE_BODY_LIMIT = 512_000;

/**
 * Read a UTF-8 body, rejecting with Error("body_too_large") above `limit`.
 * Bytes past the cap are not buffered. The socket stays up long enough for the
 * caller to send 413, then it is destroyed.
 */
export function readLimitedBody(req, limit = DEFAULT_JSON_BODY_LIMIT) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;

    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve(value);
    };

    req.on("data", (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        req.pause();
        finish(new Error("body_too_large"));
        // Let the route write 413 before the socket reset drops it.
        queueMicrotask(() => {
          req.destroy();
        });
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      finish(null, Buffer.concat(chunks).toString("utf8"));
    });

    req.on("error", (err) => {
      // destroy() after body_too_large also emits error; the promise is already settled.
      finish(err);
    });
  });
}
