import {
  createPublicClient,
  createWalletClient,
  custom,
  erc20Abi,
  http,
  maxUint256,
  type Address,
  type Hash,
} from "viem";
import { monadMainnet } from "./chains.js";
import { MONAD_USDC } from "./swap-usdc-to-mon.js";
import type { Eip1193Provider } from "./wallet.js";

export const WRITER_SUBSCRIPTION_ABI = [
  {
    name: "setPlan",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "priceUsdc", type: "uint256" }],
    outputs: [],
  },
  {
    name: "subscribe",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "writer", type: "address" }],
    outputs: [],
  },
  {
    name: "cancel",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "writer", type: "address" }],
    outputs: [],
  },
  {
    name: "hasActiveSubscription",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "reader", type: "address" },
      { name: "writer", type: "address" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

export function resolveSubscriptionContract(): Address | "" {
  const fromEnv =
    typeof import.meta !== "undefined"
      ? (import.meta.env?.VITE_SUBSCRIPTION_CONTRACT as string | undefined)
      : undefined;
  const addr = (fromEnv || "").trim();
  return /^0x[a-fA-F0-9]{40}$/.test(addr) ? (addr as Address) : "";
}

/**
 * Approve USDC and subscribe on-chain. First month is pulled to the writer.
 */
export async function subscribeOnchain(params: {
  provider: Eip1193Provider;
  contract: Address;
  reader: Address;
  writer: Address;
  priceUsdc: bigint;
}): Promise<Hash> {
  const publicClient = createPublicClient({ chain: monadMainnet, transport: custom(params.provider) });
  const walletClient = createWalletClient({ chain: monadMainnet, transport: custom(params.provider) });

  const allowance = (await publicClient.readContract({
    address: MONAD_USDC,
    abi: erc20Abi,
    functionName: "allowance",
    args: [params.reader, params.contract],
  })) as bigint;

  if (allowance < params.priceUsdc) {
    const approveHash = (await walletClient.writeContract({
      account: params.reader,
      address: MONAD_USDC,
      abi: erc20Abi,
      functionName: "approve",
      args: [params.contract, maxUint256],
      gas: 100000n,
    })) as Hash;
    await publicClient.waitForTransactionReceipt({ hash: approveHash });
  }

  const txHash = (await walletClient.writeContract({
    account: params.reader,
    address: params.contract,
    abi: WRITER_SUBSCRIPTION_ABI,
    functionName: "subscribe",
    args: [params.writer],
    gas: 250000n,
  })) as Hash;
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return txHash;
}

/** First-month fallback when the subscription contract is not deployed: send USDC to the writer. */
export async function transferUsdcToWriter(params: {
  provider: Eip1193Provider;
  reader: Address;
  writer: Address;
  priceUsdc: bigint;
}): Promise<Hash> {
  const publicClient = createPublicClient({
    chain: monadMainnet,
    transport: custom(params.provider),
  });
  const walletClient = createWalletClient({ chain: monadMainnet, transport: custom(params.provider) });
  const txHash = (await walletClient.writeContract({
    account: params.reader,
    address: MONAD_USDC,
    abi: erc20Abi,
    functionName: "transfer",
    args: [params.writer, params.priceUsdc],
    gas: 100000n,
  })) as Hash;
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return txHash;
}

export async function cancelOnchain(params: {
  provider: Eip1193Provider;
  contract: Address;
  reader: Address;
  writer: Address;
}): Promise<Hash> {
  const publicClient = createPublicClient({ chain: monadMainnet, transport: custom(params.provider) });
  const walletClient = createWalletClient({ chain: monadMainnet, transport: custom(params.provider) });
  const txHash = (await walletClient.writeContract({
    account: params.reader,
    address: params.contract,
    abi: WRITER_SUBSCRIPTION_ABI,
    functionName: "cancel",
    args: [params.writer],
    gas: 120000n,
  })) as Hash;
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return txHash;
}

export async function setPlanOnchain(params: {
  provider: Eip1193Provider;
  contract: Address;
  writer: Address;
  priceUsdc: bigint;
}): Promise<Hash> {
  const publicClient = createPublicClient({
    chain: monadMainnet,
    transport: http(monadMainnet.rpcUrls.default.http[0]),
  });
  const walletClient = createWalletClient({ chain: monadMainnet, transport: custom(params.provider) });
  const txHash = (await walletClient.writeContract({
    account: params.writer,
    address: params.contract,
    abi: WRITER_SUBSCRIPTION_ABI,
    functionName: "setPlan",
    args: [params.priceUsdc],
    gas: 120000n,
  })) as Hash;
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return txHash;
}
