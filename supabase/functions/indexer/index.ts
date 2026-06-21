// Supabase Edge Function: Indexer
// Triggered by a Cron job to scan the chain for ArticleRegistered and ArticleUnlocked events.
// This runs in Deno, so we use the native `fetch` and a simple pagination loop.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createPublicClient, http, parseAbiItem, keccak256, toBytes } from 'https://esm.sh/viem@2';

const CONTRACT_ADDRESS = Deno.env.get('CONTRACT_ADDRESS') as `0x${string}`;
const RPC_URL = Deno.env.get('RPC_URL') || 'https://rpc.monad.xyz';
const CHUNK_SIZE = 100n; // Must respect the Monad RPC limit
const MAX_BLOCKS_PER_RUN = 2000n; // Safety cap to avoid worker resource limits on large backfills

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')! // Use Service Role to bypass RLS for writes
);

const publicClient = createPublicClient({
  chain: { id: 143, name: 'Monad', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }, rpcUrls: { default: { http: [RPC_URL] } } },
  transport: http(RPC_URL),
});

async function upsertArticle(log: any) {
  const articleIdHash = log.args.articleId as string;
  const publisher = log.args.publisher.toLowerCase();
  const priceWei = log.args.priceWei.toString();

  // We need the human-readable slug. Since the event only emits the hash,
  // we assume the slug is passed in the URL or we derive it from the dashboard context.
  // For now, we store the hash. The dashboard will need to map hashes back if needed.
  // A better approach: The generator calls an Edge Function to register, which stores the slug.
  // For this MVP, we will just store the hash and the publisher.

  const { error } = await supabase
    .from('articles')
    .upsert({
      article_id: null, // we only have the hash from the event; slug is not emitted on-chain
      article_id_hash: articleIdHash,
      publisher: publisher,
      price_wei: priceWei,
      active: true,
      registered_at: new Date().toISOString(),
    }, { onConflict: 'article_id_hash' });

  if (error) {
    console.error('Upsert article failed:', error);
    // Surface in response for easier debugging
    throw new Error(`Upsert article failed: ${error.message}`);
  }
}

async function insertUnlock(log: any) {
  const { error } = await supabase
    .from('unlocks')
    .insert({
      article_id_hash: log.args.articleId,
      reader: log.args.reader.toLowerCase(),
      amount_wei: log.args.amount.toString(),
      tx_hash: log.transactionHash,
      unlocked_at: new Date().toISOString(),
    });

  if (error) {
    console.error('Insert unlock failed:', error);
    throw new Error(`Insert unlock failed: ${error.message}`);
  }
}

async function getLastIndexedBlock(contract: string): Promise<bigint> {
  const { data, error } = await supabase
    .from('indexer_state')
    .select('last_indexed_block')
    .eq('contract_address', contract.toLowerCase())
    .single();

  if (error || !data) return 0n;
  return BigInt(data.last_indexed_block as string);
}

async function setLastIndexedBlock(contract: string, block: bigint) {
  const { error } = await supabase.from('indexer_state').upsert(
    {
      contract_address: contract.toLowerCase(),
      last_indexed_block: block.toString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'contract_address' }
  );

  if (error) console.error('Failed to persist indexer_state:', error);
}

Deno.serve(async (req) => {
  try {
    const currentBlock = await publicClient.getBlockNumber();
    const lastIndexed = await getLastIndexedBlock(CONTRACT_ADDRESS);
    // Resume from the block after the last successful index; start at 0 on first run.
    const fromBlock = lastIndexed + 1n;

    if (fromBlock > currentBlock) {
      return new Response('Already up to date.', { status: 200 });
    }

    let registeredLogs: any[] = [];
    let unlockedLogs: any[] = [];
    let scannedUpTo = fromBlock - 1n;

    for (let from = fromBlock; from <= currentBlock; from += CHUNK_SIZE) {
      // Stop if we've hit the per-run safety cap.
      if (scannedUpTo - fromBlock + 1n >= MAX_BLOCKS_PER_RUN) break;

      const toCandidate = from + CHUNK_SIZE - 1n;
      const to = toCandidate > currentBlock ? currentBlock : toCandidate;

      const regChunk = await publicClient.getLogs({
        address: CONTRACT_ADDRESS,
        event: parseAbiItem('event ArticleRegistered(bytes32 indexed articleId, uint256 priceWei, address indexed publisher)'),
        fromBlock: from,
        toBlock: to,
      });
      registeredLogs.push(...regChunk);

      const unlockChunk = await publicClient.getLogs({
        address: CONTRACT_ADDRESS,
        event: parseAbiItem('event ArticleUnlocked(address indexed reader, bytes32 indexed articleId, uint256 amount, address indexed publisher)'),
        fromBlock: from,
        toBlock: to,
      });
      unlockedLogs.push(...unlockChunk);

      scannedUpTo = to;
    }

    for (const log of registeredLogs) await upsertArticle(log);
    for (const log of unlockedLogs) await insertUnlock(log);

    // Persist the highest block we actually processed this run.
    if (scannedUpTo >= fromBlock) {
      await setLastIndexedBlock(CONTRACT_ADDRESS, scannedUpTo);
    }

    const status =
      scannedUpTo < currentBlock
        ? `Indexed ${registeredLogs.length} articles, ${unlockedLogs.length} unlocks. Processed up to ${scannedUpTo}. More work remains.`
        : `Indexed ${registeredLogs.length} articles, ${unlockedLogs.length} unlocks. Caught up to ${scannedUpTo}.`;

    return new Response(status, { status: 200 });
  } catch (e: any) {
    console.error(e);
    return new Response(`Indexing failed: ${e?.message || e}`, { status: 500 });
  }
});