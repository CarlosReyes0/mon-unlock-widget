import assert from "node:assert/strict";
import { test } from "node:test";
import { keccak256, toBytes } from "viem";
import { CRYPTO_PERIOD_MS } from "./access.mjs";
import {
  MONAD_CHAIN_ID,
  MONAD_USDC,
  assertUsdcSubscriptionPayment,
  usdcPaidFromReaderToWriter,
  verifyMonadUsdcPayment,
} from "./crypto-subscription-payment.mjs";

const READER = "0x2222222222222222222222222222222222222222";
const WRITER = "0x1111111111111111111111111111111111111111";
const TX = "0x" + "ab".repeat(32);
const PRICE = 5_000_000n;
const TRANSFER_TOPIC = keccak256(toBytes("Transfer(address,address,uint256)"));

function topicAddress(addr) {
  return `0x${addr.slice(2).toLowerCase().padStart(64, "0")}`;
}

function receipt({ from = READER, to = WRITER, value = PRICE, status = "0x1" } = {}) {
  return {
    transactionHash: TX,
    status,
    blockNumber: "0x10",
    logs: [
      {
        address: MONAD_USDC,
        topics: [TRANSFER_TOPIC, topicAddress(from), topicAddress(to)],
        data: `0x${value.toString(16).padStart(64, "0")}`,
      },
    ],
  };
}

test("a Monad USDC transfer to the writer for the plan price is enough", () => {
  const paid = usdcPaidFromReaderToWriter(receipt(), {
    usdc: MONAD_USDC,
    reader: READER,
    writer: WRITER,
  });
  assert.equal(paid, PRICE);
  const proof = assertUsdcSubscriptionPayment({
    chainId: MONAD_CHAIN_ID,
    receipt: receipt(),
    blockTimestamp: 1_700_000_000,
    txHash: TX,
    reader: READER,
    writer: WRITER,
    minAmount: PRICE,
  });
  assert.equal(proof.blockTimestamp, 1_700_000_000);
  assert.equal(proof.blockTimestamp * 1000 + CRYPTO_PERIOD_MS > Date.parse("2023-11-14"), true);
});

test("wrong chain, recipient, amount, or a reverted tx is rejected", () => {
  const base = {
    chainId: MONAD_CHAIN_ID,
    receipt: receipt(),
    blockTimestamp: 1_700_000_000,
    txHash: TX,
    reader: READER,
    writer: WRITER,
    minAmount: PRICE,
  };
  assert.throws(() => assertUsdcSubscriptionPayment({ ...base, chainId: 1 }), /wrong_chain/);
  assert.throws(
    () => assertUsdcSubscriptionPayment({ ...base, receipt: receipt({ to: READER }) }),
    /insufficient_payment/
  );
  assert.throws(
    () => assertUsdcSubscriptionPayment({ ...base, receipt: receipt({ value: PRICE - 1n }) }),
    /insufficient_payment/
  );
  assert.throws(
    () => assertUsdcSubscriptionPayment({ ...base, receipt: receipt({ status: "0x0" }) }),
    /tx_not_successful/
  );
  assert.throws(
    () =>
      assertUsdcSubscriptionPayment({
        ...base,
        receipt: receipt({ from: "0x3333333333333333333333333333333333333333" }),
      }),
    /insufficient_payment/
  );
});

test("verifyMonadUsdcPayment reads chain id, receipt, and block time", async () => {
  const calls = [];
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body.method);
    let result = null;
    if (body.method === "eth_chainId") result = "0x8f";
    if (body.method === "eth_getTransactionReceipt") result = receipt();
    if (body.method === "eth_getBlockByNumber") result = { timestamp: "0x6553f100" };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 });
  };
  const proof = await verifyMonadUsdcPayment(
    { txHash: TX, reader: READER, writer: WRITER, minAmount: PRICE },
    { rpcUrl: "http://127.0.0.1:1", fetchImpl }
  );
  assert.deepEqual(calls, ["eth_chainId", "eth_getTransactionReceipt", "eth_getBlockByNumber"]);
  assert.equal(proof.blockTimestamp, 0x6553f100);
  assert.equal(Number("0x8f"), MONAD_CHAIN_ID);
});
