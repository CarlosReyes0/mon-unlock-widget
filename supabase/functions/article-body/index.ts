// Edge Function: article-body
// Returns the full article body only if the requesting wallet has unlocked it.
// Called by the widget after a successful on-chain payment.
//
// Unlock verification order:
// 1. Supabase unlocks table (indexer backfill / dashboard)
// 2. On-chain hasUnlocked() — instant after payment, no indexer wait

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createPublicClient, http, keccak256, toBytes } from 'https://esm.sh/viem@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const DEFAULT_CONTRACT = '0x038446b1F736e254cC0E256B20D74823c41EeADB';
const DEFAULT_RPC = 'https://rpc.monad.xyz';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
  'Content-Type': 'application/json',
};

async function hasUnlockedOnChain(
  articleIdHash: string,
  reader: string,
  contractAddress: `0x${string}`
): Promise<boolean> {
  const rpcUrl = Deno.env.get('RPC_URL') || DEFAULT_RPC;

  const publicClient = createPublicClient({
    chain: {
      id: 143,
      name: 'Monad',
      nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    },
    transport: http(rpcUrl),
  });

  try {
    return (await publicClient.readContract({
      address: contractAddress,
      abi: [
        {
          name: 'hasUnlocked',
          type: 'function',
          stateMutability: 'view',
          inputs: [
            { name: 'reader', type: 'address' },
            { name: 'articleId', type: 'bytes32' },
          ],
          outputs: [{ type: 'bool' }],
        },
      ],
      functionName: 'hasUnlocked',
      args: [reader as `0x${string}`, articleIdHash as `0x${string}`],
    })) as boolean;
  } catch (e) {
    console.warn('On-chain unlock check failed:', e);
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
  }

  try {
    const url = new URL(req.url);
    const articleId = url.searchParams.get('article_id'); // human-readable slug
    const articleIdHash = url.searchParams.get('article_id_hash');
    const reader = url.searchParams.get('reader')?.toLowerCase();
    const unlockContract =
      (url.searchParams.get('unlock_contract') ||
        Deno.env.get('CONTRACT_ADDRESS') ||
        DEFAULT_CONTRACT) as `0x${string}`;

    if (!reader) {
      return new Response(JSON.stringify({ error: 'reader (wallet) is required' }), { status: 400, headers });
    }

    if (!articleId && !articleIdHash) {
      return new Response(JSON.stringify({ error: 'article_id or article_id_hash is required' }), { status: 400, headers });
    }

    // Find the article by slug, then by on-chain hash derived from the slug.
    // Indexer rows often have article_id=null (chain events only emit the hash).
    let article: { article_id_hash: string; body: string | null } | null = null;

    if (articleId) {
      const { data: bySlug, error: slugError } = await supabase
        .from('articles')
        .select('article_id_hash, body')
        .eq('article_id', articleId)
        .limit(1);

      if (slugError) {
        console.error('Article lookup failed:', slugError);
        return new Response(JSON.stringify({ error: 'Failed to load article' }), { status: 500, headers });
      }

      if (bySlug && bySlug.length > 0) {
        article = bySlug[0];
      } else {
        const derivedHash = keccak256(toBytes(articleId));
        const { data: byHash, error: hashError } = await supabase
          .from('articles')
          .select('article_id_hash, body')
          .eq('article_id_hash', derivedHash)
          .limit(1);

        if (hashError) {
          console.error('Article hash lookup failed:', hashError);
          return new Response(JSON.stringify({ error: 'Failed to load article' }), { status: 500, headers });
        }

        if (byHash && byHash.length > 0) {
          article = byHash[0];
          // Backfill slug so future lookups and the dashboard resolve the human-readable id.
          await supabase
            .from('articles')
            .update({ article_id: articleId, updated_at: new Date().toISOString() })
            .eq('article_id_hash', derivedHash)
            .is('article_id', null);
        }
      }
    } else if (articleIdHash) {
      const { data: byHash, error: hashError } = await supabase
        .from('articles')
        .select('article_id_hash, body')
        .eq('article_id_hash', articleIdHash)
        .limit(1);

      if (hashError) {
        console.error('Article hash lookup failed:', hashError);
        return new Response(JSON.stringify({ error: 'Failed to load article' }), { status: 500, headers });
      }

      if (byHash && byHash.length > 0) {
        article = byHash[0];
      }
    }

    if (!article) {
      return new Response(JSON.stringify({ error: 'Article not found' }), { status: 404, headers });
    }

    // Check if this reader has unlocked it
    const { data: unlocks, error: unlockError } = await supabase
      .from('unlocks')
      .select('id')
      .eq('article_id_hash', article.article_id_hash)
      .eq('reader', reader)
      .limit(1);

    if (unlockError) {
      console.error('Unlock check failed:', unlockError);
      return new Response(JSON.stringify({ error: 'Failed to verify unlock' }), { status: 500, headers });
    }

    let isUnlocked = Boolean(unlocks && unlocks.length > 0);

    // Fall back to on-chain truth so body appears immediately after payment.
    if (!isUnlocked && article.article_id_hash) {
      isUnlocked = await hasUnlockedOnChain(article.article_id_hash, reader, unlockContract);
    }

    if (!isUnlocked) {
      return new Response(JSON.stringify({ error: 'Not unlocked' }), { status: 403, headers });
    }

    return new Response(JSON.stringify({ body: article.body || '' }), { status: 200, headers });
  } catch (e: any) {
    console.error('article-body error:', e);
    return new Response(JSON.stringify({ error: e?.message || 'Invalid request' }), { status: 400, headers });
  }
});
