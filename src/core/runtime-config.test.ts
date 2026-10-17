import assert from "node:assert/strict";
import test from "node:test";
import { SUPABASE_ANON_KEY } from "./publish-auth.js";
import {
  PROD_SUPABASE_URL,
  readRuntimeConfig,
  widgetSupabaseTarget,
} from "./runtime-config.js";

const TEST_URL = "https://mock-staging.supabase.co";
const TEST_KEY = "test-anon-key";

test("readRuntimeConfig falls back to production when the page has no config", () => {
  const holder = globalThis as { window?: Window };
  const prev = holder.window;
  delete holder.window;
  try {
    const cfg = readRuntimeConfig();
    assert.equal(cfg.supabaseUrl, PROD_SUPABASE_URL);
    assert.equal(cfg.supabaseAnonKey, SUPABASE_ANON_KEY);
    assert.equal(cfg.staging, false);
    assert.equal(cfg.cryptoPay, true);
    assert.equal(cfg.appEnv, "production");
  } finally {
    if (prev) holder.window = prev;
  }
});

test("readRuntimeConfig uses the injected staging project and hides crypto", () => {
  const prev = globalThis.window;
  globalThis.window = {
    __OPENPAYWALL_CONFIG: {
      supabaseUrl: `${TEST_URL}/`,
      supabaseAnonKey: TEST_KEY,
      appEnv: "staging",
      staging: true,
      cryptoPay: false,
      stripePublishableKey: "pk_test_123",
    },
  } as unknown as Window & typeof globalThis;
  try {
    const cfg = readRuntimeConfig();
    assert.equal(cfg.supabaseUrl, TEST_URL);
    assert.equal(cfg.supabaseAnonKey, TEST_KEY);
    assert.equal(cfg.cryptoPay, false);
    assert.equal(cfg.stripePublishableKey, "pk_test_123");
  } finally {
    if (prev) globalThis.window = prev;
    else delete (globalThis as { window?: unknown }).window;
  }
});

test("widget on a third-party origin keeps the production project", () => {
  const target = widgetSupabaseTarget({
    pageOrigin: "https://publisher.example",
    scriptSrc: "https://openpaywall.app/dist/openpaywall.js",
    config: {
      supabaseUrl: TEST_URL,
      supabaseAnonKey: TEST_KEY,
      staging: true,
      cryptoPay: false,
    },
  });
  assert.equal(target.functionsBase, `${PROD_SUPABASE_URL}/functions/v1`);
  assert.equal(target.anonKey, SUPABASE_ANON_KEY);
  assert.equal(target.hideCrypto, false);
});

test("widget on the hosted staging origin uses the injected project and hides crypto", () => {
  const target = widgetSupabaseTarget({
    pageOrigin: "https://staging.example.test",
    scriptSrc: "https://staging.example.test/dist/openpaywall.js?v=1",
    config: {
      supabaseUrl: TEST_URL,
      supabaseAnonKey: TEST_KEY,
      appEnv: "staging",
      staging: true,
      cryptoPay: false,
    },
  });
  assert.equal(target.functionsBase, `${TEST_URL}/functions/v1`);
  assert.equal(target.anonKey, TEST_KEY);
  assert.equal(target.hideCrypto, true);
});

test("hosted production pages keep crypto pay and the production project", () => {
  const target = widgetSupabaseTarget({
    pageOrigin: "https://openpaywall.app",
    scriptSrc: "https://openpaywall.app/dist/openpaywall.js",
    config: {
      supabaseUrl: PROD_SUPABASE_URL,
      supabaseAnonKey: SUPABASE_ANON_KEY,
      appEnv: "production",
      staging: false,
      cryptoPay: true,
    },
  });
  assert.equal(target.functionsBase, `${PROD_SUPABASE_URL}/functions/v1`);
  assert.equal(target.anonKey, SUPABASE_ANON_KEY);
  assert.equal(target.hideCrypto, false);
});
