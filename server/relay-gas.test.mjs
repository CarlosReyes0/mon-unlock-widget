import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  relayGasDrip,
  claimPersistentGas,
  gasGlobalDailyCap,
  relayerLowBalanceWei,
  readRelayerBalanceStatus,
  resetRelayerStatusCacheForTests,
  uptimeHttpResult,
} from "./relay-gas.mjs";
import { buildGasAuthMessage } from "./writer-mutation-auth.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KEY = "0xac0974bec39a17e36ba4a6b4d4aad435cce0e4c9335790421507b8a191e28881";
const OTHER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const account = privateKeyToAccount(KEY);
const other = privateKeyToAccount(OTHER_KEY);
const READER = account.address;
const READER_B = other.address;
const ARTICLE = "priced-story";
const PRICED = { article_id: ARTICLE, price_cents: 100, price_wei: "0" };

function memoryClaims(cap) {
  const seen = new Set();
  let n = 0;
  return async (address) => {
    const key = String(address || "").toLowerCase();
    if (seen.has(key)) return "already_claimed";
    if (n >= cap) return "rate_limited";
    seen.add(key);
    n += 1;
    return "ok";
  };
}

async function signedBody(signer, address, overrides = {}) {
  const issuedAt = overrides.issuedAt || new Date().toISOString();
  const signedIssuedAt = overrides.signedIssuedAt || issuedAt;
  const articleId = Object.prototype.hasOwnProperty.call(overrides, "articleId")
    ? overrides.articleId
    : ARTICLE;
  const message =
    overrides.message ||
    buildGasAuthMessage({ address, articleId, issuedAt: signedIssuedAt });
  const signature = await signer.signMessage({ message });
  const body = { address, issuedAt, signature };
  if (articleId) body.articleId = articleId;
  return body;
}

function fundedDeps(extra = {}) {
  return {
    configured: () => true,
    account: () => account,
    getBalance: async () => 0n,
    getRelayerBalance: async () => parseEther("10"),
    sendNative: async () => "0xabc",
    claimGas: memoryClaims(8),
    releaseGas: async () => {},
    lookupArticle: async () => PRICED,
    ...extra,
  };
}

test("relayGasDrip rejects an unsigned address before checking the relayer", async () => {
  let sent = false;
  await assert.rejects(
    () =>
      relayGasDrip(
        { address: READER },
        {},
        fundedDeps({
          configured: () => false,
          sendNative: async () => {
            sent = true;
            return "0xno";
          },
        })
      ),
    (err) => err.status === 401 && err.message === "unauthorized"
  );
  assert.equal(sent, false);
});

test("relayGasDrip 503s when the relayer key is missing after a valid signature", async () => {
  const body = await signedBody(account, READER);
  await assert.rejects(
    () =>
      relayGasDrip(
        body,
        {},
        { configured: () => false, claimGas: memoryClaims(8), lookupArticle: async () => PRICED }
      ),
    (err) => err.status === 503 && err.message === "relayer_not_configured" && err.fallback === true
  );
});

test("relayGasDrip rejects an invalid address", async () => {
  await assert.rejects(
    () =>
      relayGasDrip(
        { address: "not-an-address" },
        {},
        { configured: () => true, account: () => account }
      ),
    (err) => err.status === 400 && err.message === "invalid_address"
  );
});

test("relayGasDrip rejects a stale or wrong-wallet signature", async () => {
  const stale = await signedBody(account, READER, {
    issuedAt: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
  });
  await assert.rejects(
    () => relayGasDrip(stale, {}, fundedDeps()),
    (err) => err.status === 401
  );
  const wrong = await signedBody(other, READER);
  await assert.rejects(
    () => relayGasDrip(wrong, {}, fundedDeps()),
    (err) => err.status === 401
  );
});

test("relayGasDrip rejects a reader session or a registration signature", async () => {
  let sent = false;
  const deps = fundedDeps({
    sendNative: async () => {
      sent = true;
      return "0xno";
    },
  });
  await assert.rejects(
    () =>
      relayGasDrip(
        { address: READER },
        { readerSession: { address: READER.toLowerCase(), issuedAt: Math.floor(Date.now() / 1000) } },
        deps
      ),
    (err) => err.status === 401 && err.message === "unauthorized"
  );
  const generic = await account.signMessage({
    message: `Open Paywall publish v1\narticle:${ARTICLE}\naddress:${READER.toLowerCase()}`,
  });
  await assert.rejects(
    () =>
      relayGasDrip(
        {
          address: READER,
          articleId: ARTICLE,
          issuedAt: new Date().toISOString(),
          signature: generic,
        },
        {},
        deps
      ),
    (err) => err.status === 401 && err.message === "unauthorized"
  );
  assert.equal(sent, false);
});

test("relayGasDrip rejects a signature for an article that does not exist", async () => {
  let sent = false;
  const body = await signedBody(account, READER, { articleId: "missing-story" });
  await assert.rejects(
    () =>
      relayGasDrip(
        body,
        {},
        fundedDeps({
          lookupArticle: async () => null,
          sendNative: async () => {
            sent = true;
            return "0xno";
          },
        })
      ),
    (err) => err.status === 403 && err.message === "article_not_found"
  );
  assert.equal(sent, false);
});

test("relayGasDrip allows a $1,000 article and rejects $1,000.01", async () => {
  const body = await signedBody(account, READER);
  const atCap = await relayGasDrip(
    body,
    {},
    fundedDeps({
      lookupArticle: async () => ({ article_id: ARTICLE, price_cents: 100_000, price_wei: "0" }),
    })
  );
  assert.equal(atCap.ok, true);
  let sent = false;
  await assert.rejects(
    () =>
      relayGasDrip(
        body,
        {},
        fundedDeps({
          lookupArticle: async () => ({ article_id: ARTICLE, price_cents: 100_001, price_wei: "0" }),
          sendNative: async () => {
            sent = true;
            return "0xno";
          },
        })
      ),
    (err) => err.status === 403 && err.message === "price_above_maximum" && err.publicMessage === "Maximum is $1,000.00."
  );
  assert.equal(sent, false);
  await assert.rejects(
    () =>
      relayGasDrip(
        body,
        {},
        fundedDeps({
          lookupArticle: async () => ({
            article_id: ARTICLE,
            payment_asset: "usdc",
            price_wei: "1000010000",
          }),
        })
      ),
    (err) => err.message === "price_above_maximum"
  );
  const mon = await relayGasDrip(
    body,
    {},
    fundedDeps({
      lookupArticle: async () => ({
        article_id: ARTICLE,
        payment_asset: "mon",
        price_wei: "1000000000000000000000",
      }),
    })
  );
  assert.equal(mon.ok, true);
  const usdcAtCap = await relayGasDrip(
    body,
    {},
    fundedDeps({
      lookupArticle: async () => ({
        article_id: ARTICLE,
        payment_asset: "usdc",
        price_wei: "1000000000",
      }),
    })
  );
  assert.equal(usdcAtCap.ok, true);
});

test("relayGasDrip rejects an article with no price and a lookup outage", async () => {
  const unpriced = await signedBody(account, READER);
  await assert.rejects(
    () =>
      relayGasDrip(
        unpriced,
        {},
        fundedDeps({
          lookupArticle: async () => ({ article_id: ARTICLE, price_cents: 0, price_wei: "0" }),
        })
      ),
    (err) => err.status === 403 && err.message === "article_unpriced"
  );
  const pricedWei = await signedBody(account, READER);
  const sent = [];
  const weiResult = await relayGasDrip(
    pricedWei,
    {},
    fundedDeps({
      lookupArticle: async () => ({ article_id: ARTICLE, price_wei: "500000" }),
      sendNative: async () => {
        sent.push(1);
        return "0xwei";
      },
    })
  );
  assert.equal(weiResult.txHash, "0xwei");
  assert.equal(sent.length, 1);
  const outage = await signedBody(account, READER);
  await assert.rejects(
    () => relayGasDrip(outage, {}, fundedDeps({ lookupArticle: undefined, env: {} })),
    (err) => err.status === 503 && err.message === "article_lookup_unavailable" && err.fallback === true
  );
});

test("relayGasDrip skips when the reader already has gas", async () => {
  const body = await signedBody(account, READER);
  const result = await relayGasDrip(
    body,
    { ip: "1.1.1.1" },
    fundedDeps({
      getBalance: async () => parseEther("0.05"),
      sendNative: async () => {
        throw new Error("should not send");
      },
      claimGas: async () => {
        throw new Error("should not claim");
      },
    })
  );
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "already_funded");
});

test("relayGasDrip sends 0.05 MON when the reader has none", async () => {
  const sent = [];
  const body = await signedBody(account, READER);
  const result = await relayGasDrip(
    body,
    { ip: "1.1.1.1" },
    fundedDeps({
      sendNative: async ({ to, value }) => {
        sent.push({ to, value });
        return "0xabc";
      },
    })
  );
  assert.equal(result.ok, true);
  assert.equal(result.skipped, false);
  assert.equal(result.txHash, "0xabc");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, READER);
  assert.equal(sent[0].value, parseEther("0.05"));
});

test("relayGasDrip refuses a repeat address and does not send again", async () => {
  const sent = [];
  const claim = memoryClaims(8);
  const deps = fundedDeps({
    claimGas: claim,
    sendNative: async () => {
      sent.push(1);
      return "0x1";
    },
  });
  const first = await signedBody(account, READER);
  const again = await signedBody(account, READER);
  const result = await relayGasDrip(first, {}, deps);
  assert.equal(result.ok, true);
  await assert.rejects(
    () => relayGasDrip(again, {}, deps),
    (err) => err.status === 409 && err.message === "already_claimed"
  );
  assert.equal(sent.length, 1);
});

test("relayGasDrip returns 429 when the global daily cap is full", async () => {
  const sent = [];
  const deps = fundedDeps({
    claimGas: memoryClaims(1),
    sendNative: async () => {
      sent.push(1);
      return "0x1";
    },
  });
  await relayGasDrip(await signedBody(account, READER), {}, deps);
  const second = await signedBody(other, READER_B);
  await assert.rejects(
    () => relayGasDrip(second, {}, deps),
    (err) => err.status === 429 && err.message === "rate_limited" && err.fallback === true
  );
  assert.equal(sent.length, 1);
});

test("relayGasDrip releases the claim when the mocked sender throws", async () => {
  const released = [];
  const seen = new Set();
  const claimGas = async (address) => {
    const key = address.toLowerCase();
    if (seen.has(key)) return "already_claimed";
    seen.add(key);
    return "ok";
  };
  const deps = fundedDeps({
    claimGas,
    releaseGas: async (address) => {
      released.push(address.toLowerCase());
      seen.delete(address.toLowerCase());
    },
    sendNative: async () => {
      throw new Error("rpc_down");
    },
  });
  const failing = await signedBody(account, READER);
  await assert.rejects(() => relayGasDrip(failing, {}, deps), /rpc_down/);
  assert.deepEqual(released, [READER.toLowerCase()]);
  deps.sendNative = async () => "0xretry";
  const result = await relayGasDrip(await signedBody(account, READER), {}, deps);
  assert.equal(result.txHash, "0xretry");
});

test("claimPersistentGas talks to the service-role RPC and never a chain", async () => {
  const calls = [];
  const seen = new Set();
  let granted = 0;
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push({ url: String(url), body, auth: opts.headers.Authorization });
    if (seen.has(body.p_address)) {
      return { ok: true, text: async () => JSON.stringify("already_claimed") };
    }
    if (granted >= body.p_cap) {
      return { ok: true, text: async () => JSON.stringify("rate_limited") };
    }
    seen.add(body.p_address);
    granted += 1;
    return { ok: true, text: async () => JSON.stringify("ok") };
  };
  const env = {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-test",
    RELAYER_GAS_GLOBAL_DAILY_CAP: "1",
  };
  assert.equal(gasGlobalDailyCap({}), 50);
  assert.equal(relayerLowBalanceWei({}).toString(), parseEther("1").toString());
  assert.equal(
    relayerLowBalanceWei({ RELAYER_LOW_BALANCE_WEI: "250000000000000000" }).toString(),
    "250000000000000000"
  );
  assert.equal(gasGlobalDailyCap(env), 1);
  const first = await claimPersistentGas(READER, { env, fetchImpl, now: Date.parse("2026-10-17T03:10:00.000Z") });
  const repeat = await claimPersistentGas(READER, { env, fetchImpl, now: Date.parse("2026-10-17T03:10:00.000Z") });
  const capped = await claimPersistentGas(READER_B, { env, fetchImpl, now: Date.parse("2026-10-17T03:10:00.000Z") });
  assert.equal(first, "ok");
  assert.equal(repeat, "already_claimed");
  assert.equal(capped, "rate_limited");
  assert.match(calls[0].url, /\/rest\/v1\/rpc\/claim_gas_drip$/);
  assert.equal(calls[0].auth, "Bearer service-role-test");
  assert.equal(calls[0].body.p_address, READER.toLowerCase());
  assert.equal(calls[0].body.p_day_start, "2026-10-17T00:00:00.000Z");
  assert.equal(calls[0].body.p_cap, 1);
});

test("gas drip migration is idempotent, RLS on, and service role only", () => {
  const sql = fs.readFileSync(
    path.join(ROOT, "supabase/migrations/20261017041000_gas_drip_claims_service_role.sql"),
    "utf8"
  );
  const code = sql.replace(/--[^\n]*/g, "");
  assert.match(sql, /create table if not exists public\.gas_drip_claims/i);
  assert.match(sql, /create index if not exists gas_drip_claims_claimed_at_idx/i);
  assert.match(sql, /alter table public\.gas_drip_claims enable row level security/i);
  assert.match(code, /revoke all on table public\.gas_drip_claims from public, anon, authenticated/i);
  assert.match(code, /grant select, insert, delete on table public\.gas_drip_claims to service_role/i);
  assert.match(code, /create or replace function public\.claim_gas_drip/i);
  assert.match(code, /security invoker/i);
  assert.match(
    code,
    /revoke all on function public\.claim_gas_drip\(text, timestamptz, integer\) from public, anon, authenticated/i
  );
  assert.match(
    code,
    /grant execute on function public\.claim_gas_drip\(text, timestamptz, integer\) to service_role/i
  );
  assert.match(sql, /create table if not exists public\.rate_limit_counters/i);
  assert.match(sql, /primary key \(bucket, key, day\)/i);
  assert.match(sql, /alter table public\.rate_limit_counters enable row level security/i);
  assert.match(code, /revoke all on table public\.rate_limit_counters from public, anon, authenticated/i);
  assert.match(code, /grant select, insert, update on table public\.rate_limit_counters to service_role/i);
  assert.match(code, /create or replace function public\.take_rate_limit/i);
  assert.match(code, /on conflict \(bucket, key, day\)/i);
  assert.match(
    code,
    /revoke all on function public\.take_rate_limit\(text, text, date\) from public, anon, authenticated/i
  );
  assert.match(
    code,
    /grant execute on function public\.take_rate_limit\(text, text, date\) to service_role/i
  );
  assert.doesNotMatch(code, /create policy/i);
  assert.doesNotMatch(code, /security definer/i);
});

test("a low relayer balance logs once and still sends when one drip fits", async () => {
  const logs = [];
  const state = { at: 0 };
  const deps = fundedDeps({
    getRelayerBalance: async () => parseEther("0.2"),
    lowBalanceState: state,
    log: (line) => logs.push(line),
    claimGas: memoryClaims(8),
  });
  const first = await relayGasDrip(await signedBody(account, READER), {}, { ...deps, now: 1_000_000 });
  const second = await relayGasDrip(await signedBody(other, READER_B), {}, { ...deps, now: 1_001_000 });
  assert.equal(first.txHash, "0xabc");
  assert.equal(second.ok, true);
  assert.equal(logs.length, 1);
  const warning = JSON.parse(logs[0]);
  assert.equal(warning.event, "relayer_low_balance");
  assert.equal(warning.balance, parseEther("0.2").toString());
  assert.equal(warning.threshold, parseEther("1").toString());

  const quiet = [];
  await relayGasDrip(
    await signedBody(account, READER),
    {},
    fundedDeps({
      now: 9_000_000,
      getRelayerBalance: async () => parseEther("10"),
      lowBalanceState: { at: 0 },
      log: (line) => quiet.push(line),
    })
  );
  assert.deepEqual(quiet, []);
});

test("an underfunded relayer logs and tells checkout to fall back", async () => {
  const logs = [];
  let sent = false;
  const body = await signedBody(account, READER);
  await assert.rejects(
    () =>
      relayGasDrip(
        body,
        {},
        fundedDeps({
          now: 50_000_000,
          getRelayerBalance: async () => parseEther("0.02"),
          lowBalanceState: { at: 0 },
          log: (line) => logs.push(line),
          sendNative: async () => {
            sent = true;
            return "0xno";
          },
        })
      ),
    (err) => err.status === 503 && err.message === "relayer_underfunded" && err.fallback === true
  );
  assert.equal(sent, false);
  assert.equal(JSON.parse(logs[0]).event, "relayer_low_balance");
});

test("public relayer status is a word and does not carry the balance", async () => {
  resetRelayerStatusCacheForTests();
  const one = 10n ** 18n;
  const deps = {
    account: () => account,
    threshold: one,
    cache: null,
    attempts: 2,
  };
  const low = await readRelayerBalanceStatus({
    ...deps,
    getBalance: async () => 1n,
  });
  const ok = await readRelayerBalanceStatus({
    ...deps,
    getBalance: async () => one,
  });
  const unset = await readRelayerBalanceStatus({
    account: () => null,
    cache: null,
  });
  const malformed = await readRelayerBalanceStatus({
    account: () => ({ address: "not-an-address" }),
    cache: null,
  });
  let reads = 0;
  const fail = await readRelayerBalanceStatus({
    ...deps,
    attempts: 2,
    getBalance: async () => {
      reads += 1;
      throw new Error("rpc down");
    },
  });
  assert.deepEqual(low, { status: "low" });
  assert.deepEqual(ok, { status: "ok" });
  assert.deepEqual(unset, { status: "unset" });
  assert.deepEqual(malformed, { status: "unset" });
  assert.deepEqual(fail, { status: "fail" });
  assert.equal(reads, 2);
  for (const result of [low, ok, unset, malformed, fail]) {
    assert.deepEqual(Object.keys(result), ["status"]);
    assert.equal(JSON.stringify(result).includes(account.address), false);
  }

  const calls = [];
  const cache = { at: 0, status: "" };
  const first = await readRelayerBalanceStatus({
    ...deps,
    cache,
    now: 1_000,
    getBalance: async () => {
      calls.push("read");
      return one;
    },
  });
  const second = await readRelayerBalanceStatus({
    ...deps,
    cache,
    now: 5_000,
    getBalance: async () => {
      calls.push("read");
      return 1n;
    },
  });
  assert.deepEqual(first, { status: "ok" });
  assert.deepEqual(second, { status: "ok" });
  assert.deepEqual(calls, ["read"]);

  for (const word of ["ok", "low", "unset", "fail"]) {
    const http = uptimeHttpResult(word);
    assert.deepEqual(Object.keys(http.body).sort(), ["ok", "relayer"]);
    assert.equal(http.body.relayer, word);
    assert.equal(http.body.ok, word === "ok");
    assert.equal(http.httpStatus, word === "ok" ? 200 : 503);
  }
  const junk = uptimeHttpResult("0xsecret");
  assert.equal(junk.httpStatus, 503);
  assert.deepEqual(junk.body, { ok: false, relayer: "fail" });
});

test("checkout falls back to card when gas is capped or unavailable", () => {
  const funding = fs.readFileSync(path.join(ROOT, "src/checkout/funding.ts"), "utf8");
  const checkout = fs.readFileSync(path.join(ROOT, "src/checkout/CheckoutApp.tsx"), "utf8");
  const crypto = fs.readFileSync(path.join(ROOT, "src/checkout/CryptoPaySection.tsx"), "utf8");
  const copy = fs.readFileSync(path.join(ROOT, "src/core/gas-drip.ts"), "utf8");
  assert.doesNotMatch(funding, /status === 429\) return true/);
  assert.match(funding, /articleId/);
  assert.match(copy, /Free network gas is used up for today/);
  assert.match(copy, /Pay with Apple Pay, Google Pay, or card/);
  assert.match(checkout, /gasDripFallbackCopy/);
  assert.match(checkout, /onGasFallback/);
  assert.match(checkout, /__OP_GAS_FALLBACK__/);
  assert.match(checkout, /gasFallback/);
  assert.match(crypto, /onGasFallback/);
  assert.match(crypto, /drip\.fallback/);
  assert.match(crypto, /requestGasDrip\(address, signGasMessage, articleId\)/);
});
