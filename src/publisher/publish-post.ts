import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  keccak256,
  parseUnits,
  toBytes,
  type Address,
  type Hash,
} from "viem";
import { buildEmbedSignMessage } from "../core/embed-signature.js";
import { MAINNET_USDC_UNLOCK_CONTRACT } from "../core/payment-asset.js";
import { monadMainnet } from "../core/chains.js";
import { splitPost, uniqueSlugFromTitle } from "../core/split-post.js";
import type { Eip1193Provider } from "../core/wallet.js";

const REGISTER_ARTICLE_URL =
  "https://flczjqljgntmkanipugo.supabase.co/functions/v1/register-article";
const PRICE_USDC = "0.50";
const ZERO = "0x0000000000000000000000000000000000000000";

function relayRegisterUrl(): string {
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}/api/relay/register`;
  }
  return "/api/relay/register";
}

const GET_ARTICLE_ABI = [
  {
    name: "getArticle",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "articleId", type: "bytes32" }],
    outputs: [
      { name: "priceWei", type: "uint256" },
      { name: "publisher", type: "address" },
      { name: "active", type: "bool" },
    ],
  },
] as const;

const REGISTER_ABI = [
  {
    name: "registerArticle",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "articleId", type: "bytes32" },
      { name: "priceWei", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

export type PublishPostInput = {
  title: string;
  rawBody: string;
  author?: string;
  provider: Eip1193Provider;
  publisher: Address;
  onStatus?: (msg: string) => void;
};

type ReserveResult =
  | { ok: true }
  | { ok: false; error: string; taken?: boolean };

type RelayResult =
  | { ok: true; alreadyRegistered?: boolean; txHash?: string | null }
  | { ok: false; fallback: boolean; error: string; taken?: boolean };

async function ensureMonad(eth: Eip1193Provider, onStatus?: (msg: string) => void) {
  const current = await eth.request({ method: "eth_chainId" });
  const id = parseInt(String(current), 16);
  if (id === monadMainnet.id) return;
  onStatus?.("Switching to Monad…");
  try {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x8f" }],
    });
  } catch (err: unknown) {
    const code = err && typeof err === "object" && "code" in err ? Number((err as { code: number }).code) : 0;
    if (code === 4902) {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: "0x8f",
            chainName: "Monad",
            nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
            rpcUrls: ["https://rpc.monad.xyz"],
            blockExplorerUrls: ["https://monadvision.com"],
          },
        ],
      });
      return;
    }
    throw err;
  }
}

async function syncMetadata(payload: Record<string, unknown>): Promise<ReserveResult> {
  const res = await fetch(REGISTER_ARTICLE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (res.ok) return { ok: true };
  const err = (await res.json().catch(() => ({}))) as { error?: string };
  return { ok: false, error: err.error || `HTTP ${res.status}`, taken: err.error === "slug_taken" };
}

export async function tryRelayRegister(input: {
  slug: string;
  articleIdHash: `0x${string}`;
  priceWei: bigint;
  publisher: Address;
  embedSig: `0x${string}`;
  contract: Address;
}): Promise<RelayResult> {
  try {
    const res = await fetch(relayRegisterUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug: input.slug,
        articleIdHash: input.articleIdHash,
        priceWei: input.priceWei.toString(),
        publisher: input.publisher,
        embedSig: input.embedSig,
        paymentAsset: "usdc",
        contract: input.contract,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      fallback?: boolean;
      txHash?: string | null;
      alreadyRegistered?: boolean;
    };
    if (res.ok) {
      return {
        ok: true,
        alreadyRegistered: Boolean(body.alreadyRegistered),
        txHash: body.txHash,
      };
    }
    if (res.status === 404 || res.status === 405) {
      return { ok: false, fallback: true, error: "relayer_unavailable" };
    }
    if (res.status === 409 || body.error === "slug_taken") {
      return { ok: false, fallback: false, taken: true, error: "slug_taken" };
    }
    if (res.status === 503 || body.fallback) {
      return { ok: false, fallback: true, error: body.error || "relayer_not_configured" };
    }
    return { ok: false, fallback: false, error: body.error || `HTTP ${res.status}` };
  } catch {
    return { ok: false, fallback: true, error: "relayer_unavailable" };
  }
}

export async function publishPost(input: PublishPostInput): Promise<{ slug: string }> {
  const title = input.title.trim();
  const { teaser, body } = splitPost(input.rawBody);
  if (!title) throw new Error("Add a title.");
  if (!teaser || !body) throw new Error("Write, or paste, the piece.");

  const priceWei = parseUnits(PRICE_USDC, 6);
  const contract = MAINNET_USDC_UNLOCK_CONTRACT as Address;
  const publisher = input.publisher.toLowerCase() as Address;
  const author = (input.author || "Author").trim() || "Author";
  const eth = input.provider;
  const status = input.onStatus;

  const publicClient = createPublicClient({
    chain: monadMainnet,
    transport: http("https://rpc.monad.xyz"),
  });

  let lastTaken = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    const slug = uniqueSlugFromTitle(title);
    const articleIdHash = keccak256(toBytes(slug));
    status?.("Reserving…");
    const reserved = await syncMetadata({
      slug,
      articleIdHash,
      priceWei: priceWei.toString(),
      publisher,
      teaser,
      body,
      title,
      author,
      paymentAsset: "usdc",
      listOnOpenPaywall: true,
    });
    if (!reserved.ok && reserved.taken) {
      lastTaken = slug;
      continue;
    }
    if (!reserved.ok) {
      throw new Error(reserved.error || "Could not save the post.");
    }

    let alreadyOurs = false;
    try {
      const existing = (await publicClient.readContract({
        address: contract,
        abi: GET_ARTICLE_ABI,
        functionName: "getArticle",
        args: [articleIdHash],
      })) as readonly [bigint, Address, boolean];
      const owner = existing[1] ? String(existing[1]).toLowerCase() : "";
      if (owner && owner !== ZERO) {
        if (owner === publisher) alreadyOurs = true;
        else {
          lastTaken = slug;
          continue;
        }
      }
    } catch {
      /* unknown article — register */
    }

    status?.("Signing…");
    const message = buildEmbedSignMessage({
      chainId: monadMainnet.id,
      contract,
      articleId: slug,
      priceWei,
    });
    const walletClient = createWalletClient({
      account: publisher,
      chain: monadMainnet,
      transport: custom(eth),
    });
    const embedSig = await walletClient.signMessage({ account: publisher, message });

    if (!alreadyOurs) {
      status?.("Registering on Monad…");
      const relayed = await tryRelayRegister({
        slug,
        articleIdHash,
        priceWei,
        publisher,
        embedSig,
        contract,
      });
      if (relayed.ok) {
        alreadyOurs = true;
      } else if (relayed.taken) {
        lastTaken = slug;
        continue;
      } else if (relayed.fallback) {
        await ensureMonad(eth, status);
        const hash = (await walletClient.writeContract({
          address: contract,
          abi: REGISTER_ABI,
          functionName: "registerArticle",
          args: [articleIdHash, priceWei],
        })) as Hash;
        await publicClient.waitForTransactionReceipt({ hash });
      } else {
        throw new Error(relayed.error || "Could not register on Monad.");
      }
    }

    status?.("Saving…");
    const saved = await syncMetadata({
      slug,
      articleIdHash,
      priceWei: priceWei.toString(),
      publisher,
      teaser,
      body,
      title,
      author,
      paymentAsset: "usdc",
      listOnOpenPaywall: true,
      confirmRegistered: true,
      embedSig,
    });
    if (!saved.ok && saved.taken) {
      lastTaken = slug;
      continue;
    }
    if (!saved.ok) {
      throw new Error(saved.error || "Registered, but saving the listing failed. Try Publish again.");
    }
    return { slug };
  }

  throw new Error(
    lastTaken
      ? `Could not get a free link (last try ${lastTaken}). Publish again.`
      : "Could not publish. Try again."
  );
}
