import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { originAllowed } from "./follow-core.mjs";
import { relayerConfigured } from "./relay-register.mjs";
import { secureHtmlDocument } from "./security-headers.mjs";
import {
  PROD_SUPABASE_ANON_KEY,
  PROD_SUPABASE_URL,
  assertStagingSafe,
  decorateHtmlDocument,
  publicRuntimeConfig,
  registerArticleEndpoint,
  stagingBlockers,
} from "./public-config.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEST_URL = "https://mock-staging.supabase.co";
const TEST_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1vY2tzdGFnaW5nIiwicm9sZSI6ImFub24ifQ.sig";

function stagingEnv(extra = {}) {
  return {
    APP_ENV: "staging",
    SUPABASE_URL: TEST_URL,
    SUPABASE_ANON_KEY: TEST_ANON,
    STRIPE_SECRET_KEY: "sk_test_staging",
    VITE_STRIPE_PUBLISHABLE_KEY: "pk_test_staging",
    STRIPE_PUBLISHABLE_KEY: "",
    PUBLIC_ORIGIN: "https://staging.example.test",
    ...extra,
  };
}

test("unset env resolves to the production Supabase project", () => {
  const cfg = publicRuntimeConfig({});
  assert.equal(cfg.supabaseUrl, PROD_SUPABASE_URL);
  assert.equal(cfg.supabaseAnonKey, PROD_SUPABASE_ANON_KEY);
  assert.equal(cfg.staging, false);
  assert.equal(cfg.cryptoPay, true);
  assert.equal(cfg.gasRelayer, true);
  assert.equal(cfg.appEnv, "production");
  assert.deepEqual(stagingBlockers({}), []);
  assert.doesNotThrow(() => assertStagingSafe({ STRIPE_SECRET_KEY: "sk_live_prod" }));
});

test("SUPABASE_URL overrides the project when APP_ENV is not staging", () => {
  const cfg = publicRuntimeConfig({ SUPABASE_URL: `${TEST_URL}/` });
  assert.equal(cfg.supabaseUrl, TEST_URL);
  assert.equal(cfg.staging, false);
  assert.equal(registerArticleEndpoint({ SUPABASE_URL: TEST_URL }), `${TEST_URL}/functions/v1/register-article`);
  assert.equal(
    registerArticleEndpoint({ REGISTER_ARTICLE_URL: "https://example.test/register" }),
    "https://example.test/register"
  );
});

test("staging accepts Stripe test keys and a non-production Supabase project", () => {
  assert.deepEqual(stagingBlockers(stagingEnv()), []);
  const cfg = publicRuntimeConfig(stagingEnv());
  assert.equal(cfg.staging, true);
  assert.equal(cfg.cryptoPay, false);
  assert.equal(cfg.gasRelayer, false);
  assert.equal(cfg.stripePublishableKey, "pk_test_staging");
  assert.equal(cfg.supabaseHost, "mock-staging.supabase.co");
  assert.doesNotThrow(() => assertStagingSafe(stagingEnv({ APP_ENV: "preview" })));
});

test("staging refuses live Stripe keys and the production Supabase project", () => {
  assert.ok(stagingBlockers(stagingEnv({ STRIPE_SECRET_KEY: "sk_live_abc" })).some((p) => p.includes("STRIPE_SECRET_KEY")));
  assert.ok(
    stagingBlockers(stagingEnv({ VITE_STRIPE_PUBLISHABLE_KEY: "pk_live_abc" })).some((p) =>
      p.includes("VITE_STRIPE_PUBLISHABLE_KEY")
    )
  );
  assert.ok(stagingBlockers(stagingEnv({ SUPABASE_URL: PROD_SUPABASE_URL })).some((p) => p.includes("SUPABASE_URL")));
  assert.ok(stagingBlockers(stagingEnv({ SUPABASE_URL: "" })).some((p) => p.includes("SUPABASE_URL")));
  assert.ok(
    stagingBlockers(stagingEnv({ SUPABASE_ANON_KEY: PROD_SUPABASE_ANON_KEY })).some((p) =>
      p.includes("SUPABASE_ANON_KEY")
    )
  );
  assert.throws(() => assertStagingSafe(stagingEnv({ STRIPE_SECRET_KEY: "sk_live_abc" })), /Refusing to start/);
  assert.throws(() => assertStagingSafe(stagingEnv({ SUPABASE_URL: PROD_SUPABASE_URL })), /production Supabase/);
});

test("staging HTML gets a nonceable config script, noindex, and the test banner", () => {
  const raw = "<!doctype html><html><head><title>Articles</title></head><body><p id=\"feed\">Directory</p></body></html>";
  const decorated = decorateHtmlDocument(raw, stagingEnv());
  const secured = secureHtmlDocument(decorated);
  const csp = secured.headers["Content-Security-Policy"];
  const scriptSrc = csp.split(";").map((part) => part.trim()).find((part) => part.startsWith("script-src"));
  assert.ok(scriptSrc);
  assert.match(scriptSrc, new RegExp(`'nonce-${secured.nonce}'`));
  assert.match(scriptSrc, /'wasm-unsafe-eval'/);
  assert.doesNotMatch(scriptSrc, /'unsafe-eval'/);
  assert.doesNotMatch(scriptSrc, /'unsafe-inline'/);
  assert.doesNotMatch(scriptSrc, /jsdelivr|esm\.sh/);
  assert.match(secured.body, new RegExp(`<script nonce="${secured.nonce}">window.__OPENPAYWALL_CONFIG=`));
  assert.match(secured.body, /Test site — fake payments/);
  assert.match(secured.body, /data-supabase-host="mock-staging\.supabase\.co"/);
  assert.match(secured.body, /name="robots" content="noindex, nofollow"/);
  const json = secured.body.match(/window\.__OPENPAYWALL_CONFIG=(\{.*?\})/)?.[1];
  const config = JSON.parse(json);
  assert.equal(config.supabaseUrl, TEST_URL);
  assert.equal(config.supabaseAnonKey, TEST_ANON);
  assert.equal(config.cryptoPay, false);
  assert.equal(config.stripePublishableKey, "pk_test_staging");
  assert.equal("serviceRole" in config, false);
  assert.doesNotMatch(JSON.stringify(config), /sk_test_|service_role|SUPABASE_SERVICE_ROLE/);
});

test("production HTML injects the production project and no banner", () => {
  const raw = "<!doctype html><html><head></head><body><p>Hi</p></body></html>";
  const decorated = decorateHtmlDocument(raw, {});
  assert.doesNotMatch(decorated, /openpaywall-staging-banner/);
  assert.doesNotMatch(decorated, /noindex/);
  assert.match(decorated, new RegExp(PROD_SUPABASE_URL.replace(/[.]/g, "\\.")));
  assert.match(decorated, new RegExp(PROD_SUPABASE_ANON_KEY.replace(/[.]/g, "\\.")));
});

test("follow origin allows PUBLIC_ORIGIN only while staging", () => {
  const env = stagingEnv();
  assert.equal(originAllowed("openpaywall.app", env), true);
  assert.equal(originAllowed("localhost", env), true);
  assert.equal(originAllowed("staging.example.test", env), true);
  assert.equal(originAllowed("staging.example.test", { PUBLIC_ORIGIN: "https://staging.example.test" }), false);
  assert.equal(originAllowed("evil.example", env), false);
  assert.equal(originAllowed("openpaywall.app", {}), true);
});

test("staging forces the gas relayer off even when a key is present", () => {
  const key = `0x${"ab".repeat(32)}`;
  assert.equal(relayerConfigured({ RELAYER_PRIVATE_KEY: key }), true);
  assert.equal(relayerConfigured({ APP_ENV: "staging", RELAYER_PRIVATE_KEY: key }), false);
  assert.equal(relayerConfigured({ APP_ENV: "preview", RELAYER_PRIVATE_KEY: key }), false);
});

test("cron migrations that call production are unchanged", () => {
  const indexer = fs.readFileSync(path.join(ROOT, "supabase/migrations/0005_schedule_indexer_cron.sql"), "utf8");
  const indexerSecret = fs.readFileSync(
    path.join(ROOT, "supabase/migrations/20260928143000_indexer_cron_secret.sql"),
    "utf8"
  );
  const follow = fs.readFileSync(path.join(ROOT, "supabase/migrations/0016_follow_notify_cron.sql"), "utf8");
  for (const sql of [indexer, indexerSecret]) {
    assert.match(sql, /flczjqljgntmkanipugo\.supabase\.co\/functions\/v1\/indexer/);
    assert.match(sql, new RegExp(PROD_SUPABASE_ANON_KEY.replace(/[.]/g, "\\.")));
  }
  assert.match(follow, /https:\/\/openpaywall\.app\/api\/follows\/notify\/process/);
});

test("staging seed refuses a blind run and names the production cron targets", () => {
  const sql = fs.readFileSync(path.join(ROOT, "supabase/seed/staging.sql"), "utf8");
  assert.match(sql, /seed_ack text := 'no'/);
  assert.match(sql, /flczjqljgntmkanipugo/);
  assert.match(sql, /openpaywall\.app/);
  assert.match(sql, /the-quote-was-a-trap-939i9e/);
  assert.match(sql, /staging-demo-walk/);
  assert.doesNotMatch(sql, /sk_live_|service_role|SUPABASE_SERVICE_ROLE/);
});
