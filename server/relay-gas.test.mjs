import assert from "node:assert/strict";
import { test, beforeEach } from "node:test";
import { parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { resetRelayRateLimits } from "./relay-register.mjs";
import { relayGasDrip } from "./relay-gas.mjs";

const KEY = "0xac0974bec39a17e36ba4a6b4d4aad435cce0e4c9335790421507b8a191e28881";
const account = privateKeyToAccount(KEY);
const READER = "0x1111111111111111111111111111111111111111";

beforeEach(() => {
  resetRelayRateLimits();
});

test("relayGasDrip 503s when the relayer key is missing", async () => {
  await assert.rejects(
    () => relayGasDrip({ address: READER }, {}, { configured: () => false }),
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

test("relayGasDrip skips when the reader already has gas", async () => {
  const result = await relayGasDrip(
    { address: READER },
    { ip: "1.1.1.1" },
    {
      configured: () => true,
      account: () => account,
      getBalance: async () => parseEther("0.05"),
      getRelayerBalance: async () => parseEther("10"),
      sendNative: async () => {
        throw new Error("should not send");
      },
    }
  );
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "already_funded");
});

test("relayGasDrip sends 0.05 MON when the reader has none", async () => {
  const sent = [];
  const result = await relayGasDrip(
    { address: READER },
    { ip: "1.1.1.1" },
    {
      configured: () => true,
      account: () => account,
      getBalance: async () => 0n,
      getRelayerBalance: async () => parseEther("10"),
      sendNative: async ({ to, value }) => {
        sent.push({ to, value });
        return "0xabc";
      },
    }
  );
  assert.equal(result.ok, true);
  assert.equal(result.skipped, false);
  assert.equal(result.txHash, "0xabc");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, READER);
  assert.equal(sent[0].value, parseEther("0.05"));
});

test("relayGasDrip rate-limits a reader after the daily cap", async () => {
  const deps = {
    configured: () => true,
    account: () => account,
    getBalance: async () => 0n,
    getRelayerBalance: async () => parseEther("10"),
    sendNative: async () => "0x1",
  };
  await relayGasDrip({ address: READER }, { ip: "2.2.2.2" }, deps);
  await relayGasDrip({ address: READER }, { ip: "2.2.2.2" }, deps);
  await assert.rejects(
    () => relayGasDrip({ address: READER }, { ip: "2.2.2.2" }, deps),
    (err) => err.status === 429 && err.message === "rate_limited"
  );
});
