// Edge Function: backfill-unlock
// Manual testing tool to insert an unlock record into Supabase
// so the article-body function can return the body for a given wallet.
//
// WARNING: This is a development/testing helper. Do not expose publicly in production.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
  }

  try {
    const body = await req.json();
    const { article_id, reader, amount_wei = '1000000000000000000', tx_hash = 'backfill-manual' } = body;

    if (!article_id || !reader) {
      return new Response(JSON.stringify({ error: 'article_id and reader are required' }), { status: 400, headers });
    }

    // Find the article to get the hash
    const { data: articles, error: articleErr } = await supabase
      .from('articles')
      .select('article_id_hash')
      .eq('article_id', article_id)
      .limit(1);

    if (articleErr || !articles || articles.length === 0) {
      return new Response(JSON.stringify({ error: 'Article not found' }), { status: 404, headers });
    }

    const articleIdHash = articles[0].article_id_hash;

    // Insert the unlock. If it already exists, the insert will fail with a duplicate key error.
    // For a backfill tool this is acceptable — we just treat it as success.
    const { error: insertErr } = await supabase
      .from('unlocks')
      .insert({
        article_id_hash: articleIdHash,
        reader: reader.toLowerCase(),
        amount_wei: amount_wei,
        tx_hash: tx_hash,
        unlocked_at: new Date().toISOString(),
      });

    if (insertErr) {
      // If the row already exists, treat it as success (idempotent backfill)
      if (insertErr.code === '23505') {
        return new Response(JSON.stringify({ success: true, alreadyExisted: true, article_id, reader: reader.toLowerCase() }), { status: 200, headers });
      }
      console.error('Backfill insert failed:', insertErr);
      return new Response(JSON.stringify({ error: insertErr.message }), { status: 500, headers });
    }

    return new Response(JSON.stringify({ success: true, article_id, reader: reader.toLowerCase() }), { status: 200, headers });
  } catch (e: any) {
    console.error('backfill-unlock error:', e);
    return new Response(JSON.stringify({ error: e?.message || 'Invalid request' }), { status: 400, headers });
  }
});
