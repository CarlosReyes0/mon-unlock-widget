import type { Eip1193Provider } from "./wallet.js";

export const BASE_CHAIN_ID = 8453;
const BASE_CHAIN_HEX = "0x2105";
const BASE_RPC = "https://mainnet.base.org";

export type MirosharkClientPayment = {
  chainId: number;
  amountUsd: string;
  asset: string;
  payTo: string;
  amount: string;
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: string;
  };
  types: {
    TransferWithAuthorization: Array<{ name: string; type: string }>;
  };
  primaryType: "TransferWithAuthorization";
  message: {
    to: string;
    value: string;
    validAfter: string;
    validBefore: string;
    nonce: string;
  };
};

export type MirosharkWalletPayment = {
  signature: string;
  authorization: {
    from: string;
    to: string;
    value: string;
    validAfter: string;
    validBefore: string;
    nonce: string;
  };
};

function isUserReject(err: unknown) {
  const code =
    err && typeof err === "object" && "code" in err ? Number((err as { code: number }).code) : 0;
  const msg = err instanceof Error ? err.message : String(err || "");
  return code === 4001 || /reject|denied|cancel/i.test(msg);
}

function errorText(err: unknown) {
  return err instanceof Error ? err.message : String(err || "");
}

export function shortWallet(addr: string) {
  if (!addr || addr.length < 10) return addr || "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function formatUsdc(raw: bigint) {
  const whole = raw / 1_000_000n;
  const frac = (raw % 1_000_000n).toString().padStart(6, "0").slice(0, 2);
  return `${whole}.${frac}`;
}

export function typedDataForWallet(payment: MirosharkClientPayment, from: string) {
  return {
    types: payment.types,
    domain: payment.domain,
    primaryType: payment.primaryType,
    message: {
      from,
      to: payment.message.to,
      value: payment.message.value,
      validAfter: payment.message.validAfter,
      validBefore: payment.message.validBefore,
      nonce: payment.message.nonce,
    },
  };
}

/** Read Base USDC. Returns null when the RPC cannot be reached. */
export async function baseUsdcBalance(
  address: string,
  asset: string,
  fetchImpl: typeof fetch = fetch
): Promise<bigint | null> {
  const data = `0x70a08231${address.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
  try {
    const res = await fetchImpl(BASE_RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [{ to: asset, data }, "latest"],
      }),
      signal: AbortSignal.timeout(4000),
    });
    const json = (await res.json()) as { result?: string };
    if (typeof json.result !== "string" || !json.result.startsWith("0x")) return null;
    return BigInt(json.result);
  } catch {
    return null;
  }
}

async function ensureBase(eth: Eip1193Provider) {
  const current = await eth.request({ method: "eth_chainId" });
  const id = parseInt(String(current), 16);
  if (id === BASE_CHAIN_ID) return;
  try {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: BASE_CHAIN_HEX }],
    });
  } catch (err: unknown) {
    const code =
      err && typeof err === "object" && "code" in err ? Number((err as { code: number }).code) : 0;
    if (code === 4902) {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: BASE_CHAIN_HEX,
            chainName: "Base",
            nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
            rpcUrls: ["https://mainnet.base.org"],
            blockExplorerUrls: ["https://basescan.org"],
          },
        ],
      });
      return;
    }
    throw err;
  }
}

async function requestSignature(eth: Eip1193Provider, from: string, typed: ReturnType<typeof typedDataForWallet>) {
  try {
    return (await eth.request({
      method: "eth_signTypedData_v4",
      params: [from, JSON.stringify(typed)],
    })) as string;
  } catch (err) {
    if (isUserReject(err)) throw err;
    return (await eth.request({
      method: "eth_signTypedData_v4",
      params: [from, typed],
    })) as string;
  }
}

/**
 * Ask the signed-in wallet to approve the MiroShark USDC authorization on Base.
 * Does not publish the piece.
 */
export async function signMirosharkUsdc(
  eth: Eip1193Provider,
  from: string,
  payment: MirosharkClientPayment,
  fetchImpl: typeof fetch = fetch
): Promise<MirosharkWalletPayment> {
  const balance = await baseUsdcBalance(from, payment.asset || payment.domain.verifyingContract, fetchImpl);
  if (balance != null && balance < BigInt(payment.amount)) {
    throw new Error(
      `This wallet has $${formatUsdc(balance)} USDC on Base. Send $${payment.amountUsd} to ${shortWallet(from)}, then approve again.`
    );
  }
  const typed = typedDataForWallet(payment, from);
  let signature: string;
  try {
    signature = await requestSignature(eth, from, typed);
  } catch (err) {
    if (isUserReject(err) || !/chain|network|8453/i.test(errorText(err))) throw err;
    await ensureBase(eth);
    signature = await requestSignature(eth, from, typed);
  }
  if (!signature || typeof signature !== "string") {
    throw new Error("The wallet did not return an approval.");
  }
  return { signature, authorization: typed.message };
}
