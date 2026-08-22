// Supabase Edge Function: Indexer
// Scans ArticleRegistered / ArticleUnlocked on MON and USDC unlock contracts.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createPublicClient, http, parseAbiItem } from "https://esm.sh/viem@2";

const MON_CONTRACT = (Deno.env.get("CONTRACT_ADDRESS") || "") as `0x${string}`;
const USDC_CONTRACT = (Deno.env.get("USDC_CONTRACT_ADDRESS") || "") as `0x${string}`;
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

async function getLastIndexedBlock(contract: string): Promise<bigint> {
  const { data, error } = await supabase
    .from("indexer_state")
    .select("last_indexed_block")
    .eq("contract_address", contract.toLowerCase())
    .single();
  if (error || !data) return 0n;
  return BigInt(data.last_indexed_block as string);
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
  currentBlock: bigint
): Promise<string> {
  const lastIndexed = await getLastIndexedBlock(contract);
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

Deno.serve(async () => {
  try {
    const targets: { address: `0x${string}`; asset: PaymentAsset }[] = [];
    if (isAddress(MON_CONTRACT)) targets.push({ address: MON_CONTRACT, asset: "mon" });
    if (isAddress(USDC_CONTRACT)) targets.push({ address: USDC_CONTRACT, asset: "usdc" });
    if (targets.length === 0) {
      return new Response("No CONTRACT_ADDRESS / USDC_CONTRACT_ADDRESS configured", {
        status: 500,
      });
    }

    const currentBlock = await publicClient.getBlockNumber();
    const parts: string[] = [];
    for (const t of targets) {
      parts.push(await indexContract(t.address, t.asset, currentBlock));
    }
    return new Response(parts.join(" | "), { status: 200 });
  } catch (e: any) {
    console.error(e);
    return new Response(`Indexing failed: ${e?.message || e}`, { status: 500 });
  }
});
