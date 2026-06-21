// Edge Function: register-article
// Called by the generator after a successful on-chain registration.
// Stores the human-readable slug so the dashboard can later produce the
// exact same embed code the generator originally created.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

Deno.serve(async (req) => {
  // CORS headers so the static generator page can call this from any origin
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
  }

  try {
    const body = await req.json();
    const { slug, articleIdHash, priceWei, publisher, teaser, body: articleBody } = body;

    if (!slug || !articleIdHash || priceWei == null || !publisher) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400, headers });
    }

    const priceWeiStr = typeof priceWei === 'string' ? priceWei : String(priceWei);

    const { error } = await supabase
      .from('articles')
      .upsert({
        article_id: slug,
        article_id_hash: articleIdHash,
        publisher: publisher.toLowerCase(),
        price_wei: priceWeiStr,
        teaser: teaser || null,
        body: articleBody || null,
        active: true,
        registered_at: new Date().toISOString(),
      }, { onConflict: 'article_id_hash' });

    if (error) {
      console.error('Upsert failed:', error);
      return new Response(JSON.stringify({ error: error.message, details: error }), { status: 500, headers });
    }

    return new Response(JSON.stringify({ success: true }), { status: 200, headers });
  } catch (e: any) {
    console.error('register-article error:', e);
    return new Response(JSON.stringify({ error: e?.message || 'Invalid request' }), { status: 400, headers });
  }
});