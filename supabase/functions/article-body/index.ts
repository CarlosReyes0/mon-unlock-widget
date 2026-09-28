// Edge Function: article-body
// Returns the full article body only if the requesting wallet has unlocked it
// OR a valid Stripe fiat_session exists.
//
// Unlock verification order:
// 1. Fiat session (Stripe) via fiat_unlocks
// 2. Supabase unlocks table (indexer backfill / dashboard)
// 3. On-chain hasUnlocked() on the MON or USDC unlock contract only.
//    A caller-supplied unlock_contract is ignored unless it is one of those.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createPublicClient, http, keccak256, toBytes } from 'https://esm.sh/viem@2';
import {
  allowedUnlockContracts,
  isAllowedUnlockContract,
} from '../../../src/core/publish-auth.ts';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

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

async function hasFiatUnlock(articleIdHash: string, fiatSession: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('fiat_unlocks')
    .select('id')
    .eq('article_id_hash', articleIdHash)
    .eq('session_token', fiatSession)
    .eq('status', 'succeeded')
    .limit(1);

  if (error) {
    console.error('Fiat unlock check failed:', error);
    return false;
  }
  return Boolean(data && data.length > 0);
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
    const articleIdHashParam = url.searchParams.get('article_id_hash');
    const reader = url.searchParams.get('reader')?.toLowerCase();
    const fiatSession = url.searchParams.get('fiat_session')?.trim();
    const extraContracts = [
      Deno.env.get('CONTRACT_ADDRESS'),
      Deno.env.get('USDC_CONTRACT_ADDRESS'),
    ];
    const requestedContract = url.searchParams.get('unlock_contract');
    // A caller-supplied contract is used only when it is one of ours.
    // Anything else is ignored and both official contracts are checked,
    // so a fake hasUnlocked() cannot unlock the paid body.
    const contractsToCheck = (
      requestedContract && isAllowedUnlockContract(requestedContract, extraContracts)
        ? [requestedContract]
        : allowedUnlockContracts(extraContracts)
    ) as `0x${string}`[];

    if (!reader && !fiatSession) {
      return new Response(
        JSON.stringify({ error: 'reader (wallet) or fiat_session is required' }),
        { status: 400, headers }
      );
    }

    const readerIsAddress = Boolean(reader && /^0x[a-f0-9]{40}$/.test(reader));
    if (reader && !readerIsAddress && !fiatSession) {
      return new Response(JSON.stringify({ error: 'invalid_reader' }), { status: 400, headers });
    }

    if (!articleId && !articleIdHashParam) {
      return new Response(JSON.stringify({ error: 'article_id or article_id_hash is required' }), {
        status: 400,
        headers,
      });
    }

    let article: { article_id_hash: string; body: string | null } | null = null;

    if (articleId) {
      const { data: bySlug, error: slugError } = await supabase
        .from('articles')
        .select('article_id_hash, body')
        .eq('article_id', articleId)
        .limit(1);

      if (slugError) {
        console.error('Article lookup failed:', slugError);
        return new Response(JSON.stringify({ error: 'Failed to load article' }), {
          status: 500,
          headers,
        });
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
          return new Response(JSON.stringify({ error: 'Failed to load article' }), {
            status: 500,
            headers,
          });
        }

        if (byHash && byHash.length > 0) {
          article = byHash[0];
          await supabase
            .from('articles')
            .update({ article_id: articleId, updated_at: new Date().toISOString() })
            .eq('article_id_hash', derivedHash)
            .is('article_id', null);
        }
      }
    } else if (articleIdHashParam) {
      const { data: byHash, error: hashError } = await supabase
        .from('articles')
        .select('article_id_hash, body')
        .eq('article_id_hash', articleIdHashParam)
        .limit(1);

      if (hashError) {
        console.error('Article hash lookup failed:', hashError);
        return new Response(JSON.stringify({ error: 'Failed to load article' }), {
          status: 500,
          headers,
        });
      }

      if (byHash && byHash.length > 0) {
        article = byHash[0];
      }
    }

    if (!article) {
      return new Response(JSON.stringify({ error: 'Article not found' }), { status: 404, headers });
    }

    let isUnlocked = false;

    if (fiatSession) {
      isUnlocked = await hasFiatUnlock(article.article_id_hash, fiatSession);
    }

    if (!isUnlocked && readerIsAddress && reader) {
      const { data: articleRow } = await supabase
        .from('articles')
        .select('publisher')
        .eq('article_id_hash', article.article_id_hash)
        .limit(1);
      const writer = articleRow?.[0]?.publisher?.toLowerCase();
      if (writer) {
        const { data: subs } = await supabase
          .from('subscriptions')
          .select('status,canceled_at,current_period_end')
          .eq('reader', reader)
          .eq('writer', writer)
          .eq('status', 'active');
        const now = Date.now();
        isUnlocked = Boolean(
          (subs || []).some(
            (s) =>
              !s.canceled_at &&
              s.current_period_end &&
              new Date(s.current_period_end).getTime() > now
          )
        );
      }
    }

    if (!isUnlocked && readerIsAddress && reader) {
      const { data: unlocks, error: unlockError } = await supabase
        .from('unlocks')
        .select('id')
        .eq('article_id_hash', article.article_id_hash)
        .eq('reader', reader)
        .limit(1);

      if (unlockError) {
        console.error('Unlock check failed:', unlockError);
        return new Response(JSON.stringify({ error: 'Failed to verify unlock' }), {
          status: 500,
          headers,
        });
      }

      isUnlocked = Boolean(unlocks && unlocks.length > 0);

      if (!isUnlocked && article.article_id_hash) {
        for (const contractAddress of contractsToCheck) {
          if (await hasUnlockedOnChain(article.article_id_hash, reader, contractAddress)) {
            isUnlocked = true;
            break;
          }
        }
      }
    }

    if (!isUnlocked) {
      return new Response(JSON.stringify({ error: 'Not unlocked' }), { status: 403, headers });
    }

    return new Response(JSON.stringify({ body: article.body || '' }), { status: 200, headers });
  } catch (e: any) {
    console.error('article-body error:', e);
    return new Response(JSON.stringify({ error: e?.message || 'Invalid request' }), {
      status: 400,
      headers,
    });
  }
});
