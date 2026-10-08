import type { Eip1193Provider } from "./wallet.js";
import { monadMainnet } from "./chains.js";

export const BASE_CHAIN_ID = 8453;
const BASE_CHAIN_HEX = "0x2105";
const BASE_RPC = "https://mainnet.base.org";

export type MirosharkPayNetwork = "monad" | "base";

export const DEFAULT_MIROSHARK_NETWORK: MirosharkPayNetwork = "monad";

export const PAY_NETWORK_CHOICES: Array<{ id: MirosharkPayNetwork; label: string }> = [
  { id: "monad", label: "Pay on Monad" },
  { id: "base", label: "Pay on Base" },
];

export type MirosharkClientPayment = {
  network: MirosharkPayNetwork;
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

export type MirosharkNetworkOffer = {
  id: MirosharkPayNetwork;
  label: string;
  network: string;
  chainId: number;
  asset: string;
  amountUsd: string | null;
  available: boolean;
  affiliate?: boolean;
  clientPayment: MirosharkClientPayment | null;
};

export type MirosharkNetworkOffers = Record<MirosharkPayNetwork, MirosharkNetworkOffer>;

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

export type MirosharkPayErrorCode = "wrong_chain" | "insufficient_usdc" | "user_rejected";

export class MirosharkPayError extends Error {
  code: MirosharkPayErrorCode;

  constructor(code: MirosharkPayErrorCode, message: string) {
    super(message);
    this.name = "MirosharkPayError";
    this.code = code;
  }
}

type ChainParams = {
  chainId: number;
  chainIdHex: string;
  label: string;
  rpc: string;
  add: {
    chainId: string;
    chainName: string;
    nativeCurrency: { name: string; symbol: string; decimals: number };
    rpcUrls: string[];
    blockExplorerUrls: string[];
  };
};

function isUserReject(err: unknown) {
  const code =
    err && typeof err === "object" && "code" in err ? Number((err as { code: number }).code) : 0;
  const msg = err instanceof Error ? err.message : String(err || "");
  return code === 4001 || /reject|denied|cancel/i.test(msg);
}

function errorCode(err: unknown) {
  return err && typeof err === "object" && "code" in err ? Number((err as { code: number }).code) : 0;
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

export function initialPayNetwork(
  offers?: Partial<MirosharkNetworkOffers> | null
): MirosharkPayNetwork {
  if (offers?.monad?.available && offers.monad.clientPayment) return "monad";
  if (offers?.base?.available && offers.base.clientPayment) return "base";
  return DEFAULT_MIROSHARK_NETWORK;
}

export function paymentForNetwork(
  offers: Partial<MirosharkNetworkOffers> | null | undefined,
  network: MirosharkPayNetwork
): MirosharkClientPayment | null {
  const row = offers?.[network];
  if (!row?.available || !row.clientPayment) return null;
  return row.clientPayment;
}

/** Wallet add/switch params from the repo chain config. */
export function chainParamsForPay(chainId: number): ChainParams | null {
  if (chainId === monadMainnet.id) {
    const chainIdHex = `0x${monadMainnet.id.toString(16)}`;
    return {
      chainId,
      chainIdHex,
      label: monadMainnet.name,
      rpc: monadMainnet.rpcUrls.default.http[0],
      add: {
        chainId: chainIdHex,
        chainName: monadMainnet.name,
        nativeCurrency: { ...monadMainnet.nativeCurrency },
        rpcUrls: [...monadMainnet.rpcUrls.default.http],
        blockExplorerUrls: [monadMainnet.blockExplorers.default.url],
      },
    };
  }
  if (chainId === BASE_CHAIN_ID) {
    return {
      chainId,
      chainIdHex: BASE_CHAIN_HEX,
      label: "Base",
      rpc: BASE_RPC,
      add: {
        chainId: BASE_CHAIN_HEX,
        chainName: "Base",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: [BASE_RPC],
        blockExplorerUrls: ["https://basescan.org"],
      },
    };
  }
  return null;
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

export function mirosharkPayErrorMessage(err: unknown) {
  if (err instanceof MirosharkPayError) return err.message;
  if (isUserReject(err)) return "Approval cancelled. Publish still works.";
  return err instanceof Error ? err.message : "Could not approve the payment.";
}

/** Read USDC on the payment's network. Returns null when the RPC cannot be reached. */
export async function usdcBalance(
  chainId: number,
  address: string,
  asset: string,
  fetchImpl: typeof fetch = fetch
): Promise<bigint | null> {
  const params = chainParamsForPay(chainId);
  if (!params) return null;
  const data = `0x70a08231${address.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
  try {
    const res = await fetchImpl(params.rpc, {
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

/** @deprecated use usdcBalance(8453, ...) */
export async function baseUsdcBalance(
  address: string,
  asset: string,
  fetchImpl: typeof fetch = fetch
): Promise<bigint | null> {
  return usdcBalance(BASE_CHAIN_ID, address, asset, fetchImpl);
}

async function readChainId(eth: Eip1193Provider) {
  const current = await eth.request({ method: "eth_chainId" });
  return parseInt(String(current), 16);
}

export async function ensurePayChain(eth: Eip1193Provider, chainId: number) {
  const params = chainParamsForPay(chainId);
  if (!params) {
    throw new MirosharkPayError("wrong_chain", `The wallet cannot pay on chain ${chainId}.`);
  }
  if ((await readChainId(eth)) === chainId) return;
  try {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: params.chainIdHex }],
    });
  } catch (err: unknown) {
    if (isUserReject(err)) {
      throw new MirosharkPayError("user_rejected", "Approval cancelled. Publish still works.");
    }
    if (errorCode(err) === 4902) {
      try {
        await eth.request({
          method: "wallet_addEthereumChain",
          params: [params.add],
        });
      } catch (addErr: unknown) {
        if (isUserReject(addErr)) {
          throw new MirosharkPayError("user_rejected", "Approval cancelled. Publish still works.");
        }
        throw new MirosharkPayError(
          "wrong_chain",
          `Could not add ${params.label} (chain ${chainId}) to the wallet.`
        );
      }
    } else {
      throw new MirosharkPayError(
        "wrong_chain",
        `Could not switch the wallet to ${params.label} (chain ${chainId}).`
      );
    }
  }
  if ((await readChainId(eth)) !== chainId) {
    throw new MirosharkPayError(
      "wrong_chain",
      `The wallet is on the wrong network. Switch to ${params.label} (chain ${chainId}), then approve again.`
    );
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
 * Ask the signed-in wallet to approve the MiroShark USDC authorization.
 * Checks the balance, switches or adds the payment chain, then signs.
 * Does not publish the piece and does not submit the payment.
 */
export async function signMirosharkUsdc(
  eth: Eip1193Provider,
  from: string,
  payment: MirosharkClientPayment,
  fetchImpl: typeof fetch = fetch
): Promise<MirosharkWalletPayment> {
  const chainId = Number(payment.domain?.chainId || payment.chainId);
  const params = chainParamsForPay(chainId);
  if (!params) {
    throw new MirosharkPayError("wrong_chain", `The wallet cannot pay on chain ${chainId}.`);
  }
  const asset = payment.asset || payment.domain.verifyingContract;
  const balance = await usdcBalance(chainId, from, asset, fetchImpl);
  if (balance != null && balance < BigInt(payment.amount)) {
    throw new MirosharkPayError(
      "insufficient_usdc",
      `This wallet has $${formatUsdc(balance)} USDC on ${params.label}. Send $${payment.amountUsd} to ${shortWallet(from)}, then approve again.`
    );
  }
  await ensurePayChain(eth, chainId);
  const typed = typedDataForWallet(payment, from);
  let signature: string;
  try {
    signature = await requestSignature(eth, from, typed);
  } catch (err) {
    if (isUserReject(err)) {
      throw new MirosharkPayError("user_rejected", "Approval cancelled. Publish still works.");
    }
    const text = err instanceof Error ? err.message : String(err || "");
    if (/chain|network/i.test(text)) {
      throw new MirosharkPayError(
        "wrong_chain",
        `The wallet is on the wrong network. Switch to ${params.label} (chain ${chainId}), then approve again.`
      );
    }
    throw err instanceof Error ? err : new Error("Could not approve the payment.");
  }
  if (!signature || typeof signature !== "string") {
    throw new Error("The wallet did not return an approval.");
  }
  return { signature, authorization: typed.message };
}
