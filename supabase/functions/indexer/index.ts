// Supabase Edge Function: Indexer
// Scans ArticleRegistered / ArticleUnlocked on MON and USDC unlock contracts.
// Caller must send x-indexer-secret matching INDEXER_SECRET.
// Authorization stays the public anon JWT so verify_jwt can stay enabled.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createPublicClient, http, parseAbiItem } from "https://esm.sh/viem@2.57.7";
import { requestHasSecret } from "../../../src/core/publish-auth.ts";

const MON_CONTRACT = (Deno.env.get("CONTRACT_ADDRESS") || "") as `0x${string}`;
const USDC_CONTRACT = (Deno.env.get("USDC_CONTRACT_ADDRESS") ||
  "0xa27bb0c25D12DE778bA135162ebAE665593786b2") as `0x${string}`;
const LEGACY_MON_CONTRACT = (Deno.env.get("LEGACY_CONTRACT_ADDRESS") || "") as `0x${string}`;
const LEGACY_USDC_CONTRACT = (Deno.env.get("LEGACY_USDC_CONTRACT_ADDRESS") || "") as `0x${string}`;
const RPC_URL = Deno.env.get("RPC_URL") || "https://rpc.monad.xyz";
const CHUNK_SIZE = 100n;
const MAX_BLOCKS_PER_RUN = 2000n;

type PaymentAsset = "mon" | "usdc";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const publicClient = createPublicClient({
  chain: {
    id: 143,
    name: "Monad",
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [RPC_URL] } },
  },
  transport: http(RPC_URL),
});

const registeredEvent = parseAbiItem(
  "event ArticleRegistered(bytes32 indexed articleId, uint256 priceWei, address indexed publisher)"
);
const unlockedEvent = parseAbiItem(
  "event ArticleUnlocked(address indexed reader, bytes32 indexed articleId, uint256 amount, address indexed publisher)"
);

function isAddress(value: string): value is `0x${string}` {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

async function upsertArticle(log: any, paymentAsset: PaymentAsset) {
  const articleIdHash = log.args.articleId as string;
  const publisher = (log.args.publisher as string).toLowerCase();
  const priceWei = log.args.priceWei.toString();

  const { data: existing } = await supabase
    .from("articles")
    .select("id")
    .eq("article_id_hash", articleIdHash)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("articles")
      .update({
        publisher,
        price_wei: priceWei,
        payment_asset: paymentAsset,
        active: true,
        registration_status: "registered",
        updated_at: new Date().toISOString(),
      })
      .eq("article_id_hash", articleIdHash);
    if (error) throw new Error(`Update article failed: ${error.message}`);
    return;
  }

  const { error } = await supabase.from("articles").insert({
    article_id: null,
    article_id_hash: articleIdHash,
    publisher,
    price_wei: priceWei,
    payment_asset: paymentAsset,
    active: true,
    registration_status: "registered",
    registered_at: new Date().toISOString(),
  });
  if (error) throw new Error(`Insert article failed: ${error.message}`);
}

async function insertUnlock(log: any, paymentAsset: PaymentAsset) {
  const { error } = await supabase.from("unlocks").insert({
    article_id_hash: log.args.articleId,
    reader: (log.args.reader as string).toLowerCase(),
    amount_wei: log.args.amount.toString(),
    payment_asset: paymentAsset,
    tx_hash: log.transactionHash,
    unlocked_at: new Date().toISOString(),
  });
  if (error) throw new Error(`Insert unlock failed: ${error.message}`);
}

function configuredStartBlock(): bigint | null {
  const raw = (Deno.env.get("INDEXER_START_BLOCK") || "").trim();
  if (!/^\d+$/.test(raw)) return null;
  const n = BigInt(raw);
  return n > 0n ? n : null;
}

async function getLastIndexedBlock(contract: string, useStartBlock: boolean): Promise<bigint> {
  const { data, error } = await supabase
    .from("indexer_state")
    .select("last_indexed_block")
    .eq("contract_address", contract.toLowerCase())
    .single();
  if (!error && data) return BigInt(data.last_indexed_block as string);
  // A missing row on a newly deployed contract can start at INDEXER_START_BLOCK.
  // Legacy contracts ignore that value so a cutover cannot skip their history.
  if (useStartBlock) {
    const start = configuredStartBlock();
    if (start) return start - 1n;
  }
  return 0n;
}

async function setLastIndexedBlock(contract: string, block: bigint) {
  const { error } = await supabase.from("indexer_state").upsert(
    {
      contract_address: contract.toLowerCase(),
      last_indexed_block: block.toString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "contract_address" }
  );
  if (error) console.error("Failed to persist indexer_state:", error);
}

async function indexContract(
  contract: `0x${string}`,
  paymentAsset: PaymentAsset,
  currentBlock: bigint,
  useStartBlock: boolean
): Promise<string> {
  const lastIndexed = await getLastIndexedBlock(contract, useStartBlock);
  const fromBlock = lastIndexed + 1n;
  if (fromBlock > currentBlock) {
    return `${paymentAsset}: up to date`;
  }

  const registeredLogs: any[] = [];
  const unlockedLogs: any[] = [];
  let scannedUpTo = fromBlock - 1n;

  for (let from = fromBlock; from <= currentBlock; from += CHUNK_SIZE) {
    if (scannedUpTo - fromBlock + 1n >= MAX_BLOCKS_PER_RUN) break;
    const toCandidate = from + CHUNK_SIZE - 1n;
    const to = toCandidate > currentBlock ? currentBlock : toCandidate;

    const regChunk = await publicClient.getLogs({
      address: contract,
      event: registeredEvent,
      fromBlock: from,
      toBlock: to,
    });
    registeredLogs.push(...regChunk);

    const unlockChunk = await publicClient.getLogs({
      address: contract,
      event: unlockedEvent,
      fromBlock: from,
      toBlock: to,
    });
    unlockedLogs.push(...unlockChunk);
    scannedUpTo = to;
  }

  for (const log of registeredLogs) await upsertArticle(log, paymentAsset);
  for (const log of unlockedLogs) await insertUnlock(log, paymentAsset);

  if (scannedUpTo >= fromBlock) {
    await setLastIndexedBlock(contract, scannedUpTo);
  }

  return `${paymentAsset}: ${registeredLogs.length} articles, ${unlockedLogs.length} unlocks through ${scannedUpTo}`;
}

Deno.serve(async (req) => {
  const indexerSecret = Deno.env.get("INDEXER_SECRET") || "";
  if (!indexerSecret.trim()) {
    return new Response("indexer_auth_not_configured", { status: 503 });
  }
  if (!requestHasSecret(req.headers, indexerSecret, "x-indexer-secret")) {
    return new Response("unauthorized", { status: 401 });
  }

  try {
    const targets: { address: `0x${string}`; asset: PaymentAsset; useStartBlock: boolean }[] = [];
    const pushTarget = (address: string, asset: PaymentAsset, useStartBlock: boolean) => {
      if (!isAddress(address)) return;
      const key = address.toLowerCase();
      if (targets.some((t) => t.address.toLowerCase() === key)) return;
      targets.push({ address, asset, useStartBlock });
    };
    // Primary addresses may use INDEXER_START_BLOCK when they have no cursor yet.
    pushTarget(MON_CONTRACT, "mon", true);
    pushTarget(USDC_CONTRACT, "usdc", true);
    // Legacy addresses keep their own cursor. A missing cursor scans from block 0.
    pushTarget(LEGACY_MON_CONTRACT, "mon", false);
    pushTarget(LEGACY_USDC_CONTRACT, "usdc", false);
    if (targets.length === 0) {
      return new Response("No CONTRACT_ADDRESS / USDC_CONTRACT_ADDRESS configured", {
        status: 500,
      });
    }

    const currentBlock = await publicClient.getBlockNumber();
    const parts: string[] = [];
    for (const t of targets) {
      parts.push(await indexContract(t.address, t.asset, currentBlock, t.useStartBlock));
    }
    return new Response(parts.join(" | "), { status: 200 });
  } catch (e: any) {
    console.error(e);
    return new Response(`Indexing failed: ${e?.message || e}`, { status: 500 });
  }
});
