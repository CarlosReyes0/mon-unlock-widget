// Edge Function: article-body
// Returns the full article body only if the requesting wallet has unlocked it.
// Called by the widget after a successful on-chain payment.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

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

    if (!reader) {
      return new Response(JSON.stringify({ error: 'reader (wallet) is required' }), { status: 400, headers });
    }

    if (!articleId && !articleIdHash) {
      return new Response(JSON.stringify({ error: 'article_id or article_id_hash is required' }), { status: 400, headers });
    }

    // Find the article
    let query = supabase.from('articles').select('article_id_hash, body');
    if (articleId) {
      query = query.eq('article_id', articleId);
    } else if (articleIdHash) {
      query = query.eq('article_id_hash', articleIdHash);
    }

    const { data: articles, error: articleError } = await query.limit(1);
    if (articleError || !articles || articles.length === 0) {
      return new Response(JSON.stringify({ error: 'Article not found' }), { status: 404, headers });
    }

    const article = articles[0];

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

    if (!unlocks || unlocks.length === 0) {
      return new Response(JSON.stringify({ error: 'Not unlocked' }), { status: 403, headers });
    }

    // Reader has unlocked — return the body
    return new Response(JSON.stringify({ body: article.body || '' }), { status: 200, headers });
  } catch (e: any) {
    console.error('article-body error:', e);
    return new Response(JSON.stringify({ error: e?.message || 'Invalid request' }), { status: 400, headers });
  }
});
