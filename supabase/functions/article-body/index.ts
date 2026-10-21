// Edge Function: article-body
// Returns the full article body only if the requesting wallet has a valid
// reader session (HMAC token from POST /api/reader/session) OR a Stripe
// fiat_session. A bare reader= address is not proof of ownership.
//
// Unlock verification order:
// 1. Fiat session (Stripe) via fiat_unlocks
// 2. Supabase unlocks table (indexer backfill / dashboard). Rows from the
//    previous unlock contracts stay valid.
// 3. On-chain hasUnlocked() for this article's asset, on the current contract
//    and the legacy contract. A caller-supplied unlock_contract is added only
//    when it is one of ours. Anything else is ignored, so a fake hasUnlocked()
//    cannot unlock the paid body.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createPublicClient, http, keccak256, toBytes } from 'https://esm.sh/viem@2.57.7';
import {
  allowedUnlockContracts,
  isAllowedUnlockContract,
  monReadContracts,
  readContractsForAsset,
  usdcReadContracts,
} from '../../../src/core/publish-auth.ts';
import { verifyReaderSessionToken } from '../../../src/core/reader-session.ts';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const DEFAULT_RPC = 'https://rpc.monad.xyz';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, X-Reader-Session',
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
    const queryReader = url.searchParams.get('reader')?.trim().toLowerCase() || '';
    const fiatSession = url.searchParams.get('fiat_session')?.trim();
    const sessionToken = req.headers.get('x-reader-session')?.trim() || '';
    const sessionSecret = (
      Deno.env.get('READER_SESSION_SECRET') ||
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ||
      ''
    ).trim();

    let reader = '';
    if (sessionToken) {
      if (!sessionSecret) {
        return new Response(JSON.stringify({ error: 'reader_session_not_configured' }), {
          status: 503,
          headers,
        });
      }
      const claims = await verifyReaderSessionToken(sessionToken, sessionSecret, { nowMs: Date.now() });
      if (!claims) {
        return new Response(JSON.stringify({ error: 'invalid_reader_session' }), {
          status: 401,
          headers,
        });
      }
      reader = claims.address;
    }
    if (queryReader && reader && queryReader !== reader) {
      return new Response(JSON.stringify({ error: 'reader_mismatch' }), { status: 403, headers });
    }
    if (queryReader && !reader && !fiatSession) {
      return new Response(JSON.stringify({ error: 'reader_session_required' }), {
        status: 401,
        headers,
      });
    }
    const monExtras = [
      Deno.env.get('CONTRACT_ADDRESS'),
      Deno.env.get('LEGACY_CONTRACT_ADDRESS'),
    ];
    const usdcExtras = [
      Deno.env.get('USDC_CONTRACT_ADDRESS'),
      Deno.env.get('LEGACY_USDC_CONTRACT_ADDRESS'),
    ];
    const allowExtras = [...monExtras, ...usdcExtras];
    const requestedContract = url.searchParams.get('unlock_contract');
    // A caller-supplied contract is added only when it is one of ours and it
    // belongs to this article's asset. Anything else is ignored, so a fake
    // hasUnlocked() cannot unlock the paid body. The read set still includes
    // the current contract and the legacy contract for that asset.
    const knownContracts = allowedUnlockContracts(allowExtras);

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

    let article: {
      article_id_hash: string;
      body: string | null;
      payment_asset?: string | null;
    } | null = null;

    if (articleId) {
      const { data: bySlug, error: slugError } = await supabase
        .from('articles')
        .select('article_id_hash, body, payment_asset')
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
          .select('article_id_hash, body, payment_asset')
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
        .select('article_id_hash, body, payment_asset')
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

    const asset = String(article.payment_asset || '').trim().toLowerCase();
    const readExtras =
      asset === 'mon' ? [...monExtras] : asset === 'usdc' ? [...usdcExtras] : [...allowExtras];
    if (requestedContract && isAllowedUnlockContract(requestedContract, allowExtras)) {
      const req = requestedContract.toLowerCase();
      const inMon = monReadContracts(monExtras).some((c) => c.toLowerCase() === req);
      const inUsdc = usdcReadContracts(usdcExtras).some((c) => c.toLowerCase() === req);
      const sameAsset =
        (asset === 'mon' && inMon) ||
        (asset === 'usdc' && inUsdc) ||
        (asset !== 'mon' && asset !== 'usdc' && (inMon || inUsdc));
      if (sameAsset && knownContracts.some((c) => c.toLowerCase() === req)) {
        readExtras.push(requestedContract);
      }
    }
    const contractsToCheck = readContractsForAsset(asset, readExtras) as `0x${string}`[];

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
