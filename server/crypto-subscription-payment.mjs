/**
 * On-chain check for POST /api/subscriptions/crypto/confirm.
 *
 * A confirm is a successful Monad (chain 143) transaction whose Circle USDC
 * Transfer log pays the writer at least the plan price, from the reader.
 * Direct transfer() and WriterSubscription.subscribe() both emit that log
 * (subscribe uses transferFrom(reader, writer)).
 */
import { decodeEventLog } from "viem";
import { MONAD_USDC_TOKEN } from "./publish.mjs";

export const MONAD_CHAIN_ID = 143;
export const MONAD_USDC = MONAD_USDC_TOKEN;

const TRANSFER_EVENT = {
  type: "event",
  name: "Transfer",
  inputs: [
    { name: "from", type: "address", indexed: true },
    { name: "to", type: "address", indexed: true },
    { name: "value", type: "uint256", indexed: false },
  ],
};

function httpError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

export function monadRpcUrl() {
  return (process.env.MONAD_RPC_URL || "https://rpc.monad.xyz").trim() || "https://rpc.monad.xyz";
}

async function rpcCall(rpcUrl, method, params, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
  } catch (e) {
    const err = httpError("rpc_failed", 502);
    err.cause = e;
    throw err;
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.error) {
    throw httpError("rpc_failed", 502);
  }
  return data.result;
}

function receiptSucceeded(status) {
  return status === "0x1" || status === 1 || status === "success";
}

/**
 * Sum USDC transferred from reader to writer in this receipt.
 * @param {{ logs?: Array<{ address?: string, topics?: string[], data?: string }> }} receipt
 */
export function usdcPaidFromReaderToWriter(receipt, { usdc, reader, writer }) {
  const token = String(usdc || "").toLowerCase();
  const from = String(reader || "").toLowerCase();
  const to = String(writer || "").toLowerCase();
  let total = 0n;
  for (const log of receipt?.logs || []) {
    if (String(log.address || "").toLowerCase() !== token) continue;
    let decoded;
    try {
      decoded = decodeEventLog({
        abi: [TRANSFER_EVENT],
        data: log.data,
        topics: log.topics,
      });
    } catch {
      continue;
    }
    if (decoded.eventName !== "Transfer") continue;
    if (String(decoded.args.from || "").toLowerCase() !== from) continue;
    if (String(decoded.args.to || "").toLowerCase() !== to) continue;
    total += BigInt(decoded.args.value);
  }
  return total;
}

/**
 * Pure check used by tests and by the RPC loader.
 * `blockTimestamp` is unix seconds.
 */
export function assertUsdcSubscriptionPayment(input) {
  const txHash = String(input.txHash || "").toLowerCase();
  if (Number(input.chainId) !== MONAD_CHAIN_ID) throw httpError("wrong_chain");
  if (!input.receipt) throw httpError("tx_not_found");
  if (!receiptSucceeded(input.receipt.status)) throw httpError("tx_not_successful");
  const onReceipt = String(input.receipt.transactionHash || "").toLowerCase();
  if (onReceipt && onReceipt !== txHash) throw httpError("tx_hash_mismatch");
  const paid = usdcPaidFromReaderToWriter(input.receipt, {
    usdc: input.usdc || MONAD_USDC,
    reader: input.reader,
    writer: input.writer,
  });
  const minAmount = BigInt(input.minAmount);
  if (paid < minAmount) throw httpError("insufficient_payment");
  const blockTimestamp = Number(input.blockTimestamp);
  if (!Number.isFinite(blockTimestamp) || blockTimestamp <= 0) throw httpError("tx_not_found");
  return { paid, blockTimestamp };
}

/**
 * Read the receipt from Monad and apply assertUsdcSubscriptionPayment.
 */
export async function verifyMonadUsdcPayment(input, deps = {}) {
  const txHash = String(input.txHash || "").trim().toLowerCase();
  if (!/^0x[a-f0-9]{64}$/.test(txHash)) throw httpError("invalid_tx_hash");
  const fetchImpl = deps.fetchImpl || fetch;
  const rpcUrl = deps.rpcUrl || monadRpcUrl();
  const chainIdHex = await rpcCall(rpcUrl, "eth_chainId", [], fetchImpl);
  const receipt = await rpcCall(rpcUrl, "eth_getTransactionReceipt", [txHash], fetchImpl);
  if (!receipt) throw httpError("tx_not_found");
  const block = await rpcCall(
    rpcUrl,
    "eth_getBlockByNumber",
    [receipt.blockNumber, false],
    fetchImpl
  );
  const blockTimestamp = block?.timestamp != null ? Number(block.timestamp) : NaN;
  return assertUsdcSubscriptionPayment({
    chainId: Number(chainIdHex),
    receipt,
    blockTimestamp,
    txHash,
    reader: input.reader,
    writer: input.writer,
    minAmount: input.minAmount,
    usdc: input.usdc || MONAD_USDC,
  });
}
