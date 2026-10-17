/**
 * Persistent daily counters in public.rate_limit_counters.
 * The server calls take_rate_limit with the service role. A missing database
 * or a failed RPC is an error the caller turns into HTTP 503 — it does not
 * fall open.
 */
const UNAVAILABLE = "rate_limit_unavailable";

function unavailable() {
  const err = new Error(UNAVAILABLE);
  err.status = 503;
  return err;
}

export function utcRateLimitDay(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * Increment (bucket, key, UTC day) and return the new count.
 * @param {{ bucket: string, key: string, env?: NodeJS.ProcessEnv, fetchImpl?: typeof fetch, now?: number }} input
 * @returns {Promise<number>}
 */
export async function takePersistentRateLimit(input) {
  const env = input.env || process.env;
  const url = String(env.SUPABASE_URL || "").trim().replace(/\/$/, "");
  const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !serviceKey) throw unavailable();

  const bucket = String(input.bucket || "").trim();
  const key = String(input.key || "").trim().toLowerCase();
  if (!bucket || !key) throw unavailable();

  const fetchImpl = input.fetchImpl || globalThis.fetch;
  let res;
  try {
    res = await fetchImpl(`${url}/rest/v1/rpc/take_rate_limit`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_bucket: bucket,
        p_key: key,
        p_day: utcRateLimitDay(input.now ?? Date.now()),
      }),
    });
  } catch {
    throw unavailable();
  }

  const text = await res.text();
  if (!res.ok) throw unavailable();
  let data = text;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  const count = typeof data === "number" ? data : Number(data);
  if (!Number.isInteger(count) || count < 1) throw unavailable();
  return count;
}
