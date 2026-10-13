/**
 * Unpaid probe classification, secret gate, and migration shape.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { validatePublishInput } from "./publish.mjs";
import { encodeJsonB64 } from "./x402.mjs";
import {
  HARMLESS_VALIDATE_BODY,
  PROBE_ARTICLE,
  PROBE_PUBLISH,
  PROBE_VALIDATE,
  acceptsNetworksFrom,
  buildProbeCall,
  classifyProbeResponse,
  handleX402ReportProbe,
  isValidX402Challenge,
  runUnpaidProbe,
} from "./x402-report-probe.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const v1Challenge = {
  x402Version: 1,
  error: "X-PAYMENT header is required",
  accepts: [
    {
      scheme: "exact",
      network: "base",
      maxAmountRequired: "50000",
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    },
  ],
};

test("classifyProbeResponse maps 402 challenge, 200, and everything else", () => {
  assert.equal(
    classifyProbeResponse({ httpStatus: 402, body: v1Challenge }),
    "live_402_challenge"
  );
  const headerOnly = encodeJsonB64({
    x402Version: 2,
    accepts: [{ scheme: "exact", network: "eip155:8453", amount: "50000" }],
    error: "X-PAYMENT header is required",
  });
  assert.equal(isValidX402Challenge(null, headerOnly), true);
  assert.equal(
    classifyProbeResponse({ httpStatus: 402, body: null, paymentRequiredHeader: headerOnly }),
    "live_402_challenge"
  );
  assert.deepEqual(acceptsNetworksFrom(v1Challenge, headerOnly), ["base", "eip155:8453"]);
  assert.equal(classifyProbeResponse({ httpStatus: 200, body: { ok: true } }), "live_200_free");
  assert.equal(
    classifyProbeResponse({ httpStatus: 402, body: { x402Version: 1, accepts: [] } }),
    "failing"
  );
  assert.equal(classifyProbeResponse({ httpStatus: 402, body: { error: "nope" } }), "failing");
  assert.equal(classifyProbeResponse({ httpStatus: 400, body: { error: "invalid_json" } }), "failing");
  assert.equal(classifyProbeResponse({ httpStatus: 500, body: null }), "failing");
  assert.equal(classifyProbeResponse({ httpStatus: 404, body: { error: "article_not_found" } }), "failing");
});

test("probe calls are unpaid and the validate body does not publish", () => {
  const validated = validatePublishInput({ ...HARMLESS_VALIDATE_BODY });
  assert.equal(validated.ok, true);
  const publish = buildProbeCall({
    origin: "http://127.0.0.1:8080",
    method: "POST",
    path: "/api/x402/publish",
    body: {},
  });
  const validate = buildProbeCall({
    origin: "http://127.0.0.1:8080",
    method: "POST",
    path: "/api/agents/publish/validate",
    body: { ...HARMLESS_VALIDATE_BODY },
  });
  const article = buildProbeCall({
    origin: "http://127.0.0.1:8080",
    method: "GET",
    path: "/api/x402/articles/demo-slug",
  });
  for (const call of [publish, validate, article]) {
    const names = Object.keys(call.init.headers).map((name) => name.toLowerCase());
    assert.equal(names.includes("x-payment"), false);
    assert.equal(names.includes("payment-signature"), false);
    assert.equal(names.includes("authorization"), false);
    assert.equal(call.init.redirect, "manual");
  }
  assert.equal(publish.init.body, "{}");
  assert.match(validate.init.body, /x402-report-probe/);
  assert.equal(article.init.body, undefined);
});

test("runUnpaidProbe classifies three unpaid responses and skips payment", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (String(url).endsWith("/api/x402/publish")) {
      return new Response(JSON.stringify(v1Challenge), {
        status: 402,
        headers: { "content-type": "application/json" },
      });
    }
    if (String(url).includes("/api/x402/articles/")) {
      return new Response(JSON.stringify({ error: "nope" }), { status: 500 });
    }
    return new Response(JSON.stringify({ ok: true, valid: true }), { status: 200 });
  };
  const checks = await runUnpaidProbe({
    origin: "http://127.0.0.1:9",
    slug: "demo slug",
    fetchImpl,
  });
  assert.equal(calls.length, 3);
  assert.equal(checks[0].endpoint, PROBE_PUBLISH);
  assert.equal(checks[0].status, "live_402_challenge");
  assert.deepEqual(checks[0].details.acceptsNetworks, ["base"]);
  assert.equal(typeof checks[0].details.latencyMs, "number");
  assert.equal(checks[0].details.httpStatus, 402);
  assert.equal(checks[1].endpoint, PROBE_ARTICLE);
  assert.equal(checks[1].article_id, "demo slug");
  assert.equal(checks[1].status, "failing");
  assert.match(calls[1].url, /\/api\/x402\/articles\/demo%20slug$/);
  assert.equal(checks[2].endpoint, PROBE_VALIDATE);
  assert.equal(checks[2].status, "live_200_free");
  for (const call of calls) {
    assert.equal(call.init.headers["x-payment"], undefined);
    assert.equal(call.init.headers["payment-signature"], undefined);
    assert.equal(call.init.headers.authorization, undefined);
  }
});

test("missing probe slug is failing and does not request an article", async () => {
  const urls = [];
  const checks = await runUnpaidProbe({
    origin: "http://127.0.0.1:9",
    slug: "  ",
    fetchImpl: async (url) => {
      urls.push(String(url));
      return new Response("{}", { status: 200 });
    },
  });
  assert.equal(urls.some((url) => url.includes("/api/x402/articles/")), false);
  assert.equal(checks[1].status, "failing");
  assert.equal(checks[1].details.error, "X402_REPORT_PROBE_SLUG unset");
});

test("probe route rejects a missing secret before it fetches or writes", async () => {
  let called = false;
  const result = await new Promise((resolve) => {
    const res = {
      status: 0,
      body: null,
      end(payload) {
        this.body = JSON.parse(payload);
        resolve(this);
      },
    };
    handleX402ReportProbe(
      { headers: {} },
      res,
      {
        env: { X402_REPORT_PROBE_SECRET: "probe-secret", SUPABASE_URL: "http://127.0.0.1", SUPABASE_SERVICE_ROLE_KEY: "k" },
        fetchImpl: async () => {
          called = true;
          return new Response("{}", { status: 200 });
        },
        sendJson(_res, status, body) {
          res.status = status;
          res.end(JSON.stringify(body));
        },
      }
    );
  });
  assert.equal(result.status, 401);
  assert.equal(called, false);
});

test("authorized probe upserts report_checks and does not call a facilitator", async () => {
  const writes = [];
  const fetches = [];
  const supabase = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      writes.push({
        url: req.url,
        body: Buffer.concat(chunks).toString("utf8"),
        prefer: req.headers.prefer,
      });
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end("");
    });
  });
  await new Promise((resolve) => supabase.listen(0, "127.0.0.1", resolve));
  const sbPort = supabase.address().port;
  const fetchImpl = async (url, init) => {
    fetches.push(String(url));
    if (String(url).includes("/rest/v1/")) {
      return fetch(url, init);
    }
    if (String(url).endsWith("/api/agents/publish/validate")) {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response(JSON.stringify(v1Challenge), { status: 402 });
  };
  try {
    const result = await new Promise((resolve) => {
      const res = {
        end(payload) {
          resolve(JSON.parse(payload));
        },
      };
      handleX402ReportProbe(
        {
          headers: {
            host: "127.0.0.1:8080",
            "x-forwarded-proto": "http",
            "x-x402-report-probe-secret": "probe-secret",
          },
        },
        res,
        {
          env: {
            X402_REPORT_PROBE_SECRET: "probe-secret",
            X402_REPORT_PROBE_SLUG: "bankr-demo",
            SUPABASE_URL: `http://127.0.0.1:${sbPort}`,
            SUPABASE_SERVICE_ROLE_KEY: "test-role-key",
          },
          fetchImpl,
          sendJson(_res, status, body) {
            assert.equal(status, 200);
            res.end(JSON.stringify(body));
          },
        }
      );
    });
    assert.equal(result.ok, true);
    assert.equal(result.checks.length, 3);
    assert.equal(writes.length, 1);
    assert.match(writes[0].url, /report_checks\?on_conflict=endpoint/);
    assert.match(writes[0].prefer, /resolution=merge-duplicates/);
    const rows = JSON.parse(writes[0].body);
    assert.deepEqual(
      rows.map((row) => row.endpoint),
      [PROBE_PUBLISH, PROBE_ARTICLE, PROBE_VALIDATE]
    );
    assert.equal(rows[1].article_id, "bankr-demo");
    assert.equal(rows[1].status, "live_402_challenge");
    assert.equal(rows[2].status, "live_200_free");
    assert.equal(fetches.some((url) => /facilitator|settle|verify/.test(url)), false);
    assert.equal(fetches.some((url) => url.includes("/rest/v1/x402_payments")), false);
  } finally {
    supabase.close();
  }
});

test("x402 report migration is service-role only and does not commit the probe secret", () => {
  const sql = fs.readFileSync(
    path.join(ROOT, "supabase/migrations/0017_x402_payments_report_checks.sql"),
    "utf8"
  );
  const code = sql.replace(/--[^\n]*/g, "");
  assert.match(sql, /create table if not exists public\.x402_payments/);
  assert.match(sql, /id uuid primary key default gen_random_uuid\(\)/);
  assert.match(sql, /kind text not null check \(kind in \('publish', 'unlock'\)\)/);
  assert.match(sql, /article_id bigint references public\.articles \(id\) on delete set null/);
  assert.match(sql, /x402_payments_article_id_kind_idx/);
  assert.match(sql, /x402_payments_payer_idx/);
  assert.match(code, /alter table public\.x402_payments enable row level security/i);
  assert.match(code, /alter table public\.report_checks enable row level security/i);
  assert.doesNotMatch(code, /create policy/i);
  assert.match(sql, /security_invoker = true/);
  assert.match(sql, /unique_payers/);
  assert.match(sql, /total_unlocks/);
  assert.match(sql, /count\(\*\) filter \(where kind = 'unlock'\)/);
  assert.match(sql, /revoke all on public\.x402_article_stats from public, anon, authenticated/i);
  assert.match(sql, /open-paywall-x402-report-probe/);
  assert.match(sql, /x402_report_probe_secret/);
  assert.match(sql, /x-x402-report-probe-secret/);
  assert.match(sql, /https:\/\/openpaywall\.app\/api\/x402\/report\/probe/);
  assert.match(sql, /'\*\/15 \* \* \* \*'/);
  assert.match(sql, /X402_REPORT_PROBE_SECRET/);
  assert.match(sql, /do not commit/i);
  assert.doesNotMatch(sql, /X402_REPORT_PROBE_SECRET\s*=\s*['"][^'"]+['"]/);
  assert.match(sql, /check \(status in \('live_402_challenge', 'live_200_free', 'failing'\)\)/);
});
