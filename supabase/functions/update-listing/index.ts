// Edge Function: update-listing
// Publisher updates listing_status / external_url / title / author / embed_sig
// for an article they own. Auto-list when listOnOpenPaywall=true; hide is admin-only.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

function normalizeExternalUrl(raw: unknown): { ok: true; url: string | null } | { ok: false; error: string } {
  if (raw == null || raw === '') return { ok: true, url: null };
  if (typeof raw !== 'string') return { ok: false, error: 'invalid_external_url' };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, url: null };
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: 'invalid_external_url' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'invalid_external_url' };
  }
  return { ok: true, url: parsed.toString() };
}

Deno.serve(async (req) => {
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
    const {
      slug,
      publisher,
      listOnOpenPaywall,
      externalUrl,
      title,
      author,
      embedSig,
    } = body;

    if (!slug || !publisher) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400, headers });
    }

    const publisherNorm = String(publisher).trim().toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(publisherNorm)) {
      return new Response(JSON.stringify({ error: 'invalid_publisher' }), { status: 400, headers });
    }

    const slugNorm = String(slug).trim();
    const { data: existing, error: lookupError } = await supabase
      .from('articles')
      .select('article_id, article_id_hash, publisher, listing_status')
      .eq('article_id', slugNorm)
      .maybeSingle();

    if (lookupError) {
      return new Response(JSON.stringify({ error: lookupError.message }), { status: 500, headers });
    }
    if (!existing) {
      return new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers });
    }
    if (String(existing.publisher || '').toLowerCase() !== publisherNorm) {
      return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers });
    }

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (externalUrl !== undefined) {
      const urlResult = normalizeExternalUrl(externalUrl);
      if (!urlResult.ok) {
        return new Response(JSON.stringify({ error: urlResult.error }), { status: 400, headers });
      }
      patch.external_url = urlResult.url;
    }

    if (listOnOpenPaywall === true) {
      patch.listing_status = 'listed';
      if (existing.listing_status !== 'listed') {
        patch.listed_at = new Date().toISOString();
      }
    } else if (listOnOpenPaywall === false) {
      patch.listing_status = 'unlisted';
    }

    if (typeof title === 'string') patch.title = title.trim() || null;
    if (typeof author === 'string') patch.author = author.trim() || null;
    if (typeof embedSig === 'string' && embedSig.trim()) {
      patch.embed_sig = embedSig.trim();
    }

    const { data: updated, error: updateError } = await supabase
      .from('articles')
      .update(patch)
      .eq('article_id_hash', existing.article_id_hash)
      .select('article_id, listing_status, external_url, listed_at, title, author')
      .maybeSingle();

    if (updateError) {
      return new Response(JSON.stringify({ error: updateError.message }), { status: 500, headers });
    }

    return new Response(JSON.stringify({ success: true, article: updated }), { status: 200, headers });
  } catch (e: any) {
    console.error('update-listing error:', e);
    return new Response(JSON.stringify({ error: e?.message || 'Invalid request' }), { status: 400, headers });
  }
});
