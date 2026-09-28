// Edge Function: register-article
// Requires REGISTER_PUBLISH_SECRET (x-publish-secret) or a publisher wallet
// signature over "Open Paywall publish v1" (publishSig). Anonymous calls are rejected.
// Reserves a globally unique article slug for a publisher (reserve-on-create),
// and upserts teaser/body for dashboard + article-body fetch.
// Optional listing fields: title, author, listOnOpenPaywall, externalUrl, embedSig.
// Same publisher may update their row; a different publisher gets 409 slug_taken.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { verifyMessage } from 'https://esm.sh/viem@2';
import {
  buildPublishAuthMessage,
  requestHasSecret,
  shouldApplyListing,
} from '../../../src/core/publish-auth.ts';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

function evaluateReserve(existing: { publisher?: string | null } | null, publisher: string) {
  const next = publisher.trim().toLowerCase();
  if (!existing) return { ok: true as const, action: 'insert' as const };
  const owner = String(existing.publisher || '').trim().toLowerCase();
  if (owner && owner !== next) {
    return { ok: false as const, error: 'slug_taken' as const, publisher: owner };
  }
  return { ok: true as const, action: 'update' as const };
}

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
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-publish-secret',
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
      articleIdHash,
      priceWei,
      publisher,
      teaser,
      body: articleBody,
      confirmRegistered,
      title,
      author,
      listOnOpenPaywall,
      externalUrl,
      embedSig,
      paymentAsset,
    } = body;

    if (!slug || !articleIdHash || priceWei == null || !publisher) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400, headers });
    }

    const publisherNorm = String(publisher).trim().toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(publisherNorm)) {
      return new Response(JSON.stringify({ error: 'invalid_publisher' }), { status: 400, headers });
    }

    const publishSecret = Deno.env.get('REGISTER_PUBLISH_SECRET') || '';
    const secretOk = requestHasSecret(req.headers, publishSecret, 'x-publish-secret');
    if (!secretOk) {
      const publishSig = typeof body.publishSig === 'string' ? body.publishSig.trim() : '';
      let sigOk = false;
      if (publishSig) {
        try {
          const message = await buildPublishAuthMessage({
            slug,
            publisher,
            articleIdHash,
            priceWei,
            paymentAsset,
            title,
            author,
            teaser,
            body: articleBody,
            listOnOpenPaywall,
            externalUrl,
          });
          sigOk = await verifyMessage({
            address: publisherNorm as `0x${string}`,
            message,
            signature: publishSig as `0x${string}`,
          });
        } catch {
          sigOk = false;
        }
      }
      if (!sigOk) {
        return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers });
      }
    }

    const slugNorm = String(slug).trim();
    const hashNorm = String(articleIdHash).trim();
    const priceWeiStr = typeof priceWei === 'string' ? priceWei : String(priceWei);

    // Prefer hash lookup; also reject if another row already owns this slug string.
    const { data: byHash, error: hashLookupError } = await supabase
      .from('articles')
      .select('article_id, article_id_hash, publisher, registration_status, listing_status')
      .eq('article_id_hash', hashNorm)
      .maybeSingle();

    if (hashLookupError) {
      console.error('Hash lookup failed:', hashLookupError);
      return new Response(JSON.stringify({ error: hashLookupError.message }), { status: 500, headers });
    }

    const { data: bySlug, error: slugLookupError } = await supabase
      .from('articles')
      .select('article_id, article_id_hash, publisher, registration_status, listing_status')
      .eq('article_id', slugNorm)
      .maybeSingle();

    if (slugLookupError) {
      console.error('Slug lookup failed:', slugLookupError);
      return new Response(JSON.stringify({ error: slugLookupError.message }), { status: 500, headers });
    }

    if (
      bySlug &&
      byHash &&
      bySlug.article_id_hash &&
      byHash.article_id_hash &&
      bySlug.article_id_hash !== byHash.article_id_hash
    ) {
      return new Response(
        JSON.stringify({
          error: 'slug_taken',
          publisher: bySlug.publisher,
          message: 'This article id is already reserved by another article hash.',
        }),
        { status: 409, headers }
      );
    }

    const existing = byHash || bySlug;
    const decision = evaluateReserve(existing, publisherNorm);
    if (!decision.ok) {
      return new Response(
        JSON.stringify({
          error: 'slug_taken',
          publisher: decision.publisher,
          message: `Article id already reserved by ${decision.publisher}`,
        }),
        { status: 409, headers }
      );
    }

    const priorStatus = existing?.registration_status || 'reserved';
    const registration_status = confirmRegistered
      ? 'registered'
      : priorStatus === 'registered'
        ? 'registered'
        : 'reserved';

    const row: Record<string, unknown> = {
      article_id: slugNorm,
      article_id_hash: hashNorm,
      publisher: publisherNorm,
      price_wei: priceWeiStr,
      teaser: teaser || null,
      body: articleBody || null,
      active: true,
      registration_status,
      updated_at: new Date().toISOString(),
    };

    if (typeof title === 'string') row.title = title.trim() || null;
    if (typeof author === 'string') row.author = author.trim() || null;
    if (paymentAsset === 'usdc' || paymentAsset === 'mon') row.payment_asset = paymentAsset;

    if (typeof embedSig === 'string' && embedSig.trim()) {
      row.embed_sig = embedSig.trim();
    }

    if (listOnOpenPaywall !== undefined || externalUrl !== undefined) {
      const urlResult = normalizeExternalUrl(externalUrl);
      if (!urlResult.ok) {
        return new Response(JSON.stringify({ error: urlResult.error }), { status: 400, headers });
      }
      if (externalUrl !== undefined) {
        row.external_url = urlResult.url;
      }

      const applyListing = shouldApplyListing({
        confirmRegistered,
        priorStatus,
        existingListingStatus: existing?.listing_status ?? null,
      });
      if (applyListing && listOnOpenPaywall === true) {
        row.listing_status = 'listed';
        if (existing?.listing_status !== 'listed') {
          row.listed_at = new Date().toISOString();
        }
      } else if (applyListing && listOnOpenPaywall === false) {
        row.listing_status = 'unlisted';
      }
    }

    // Keep original registered_at on update; set on insert via default / explicit.
    const { error } = existing
      ? await supabase.from('articles').update(row).eq('article_id_hash', existing.article_id_hash || hashNorm)
      : await supabase.from('articles').insert({
          ...row,
          registered_at: new Date().toISOString(),
          listing_status: row.listing_status || 'unlisted',
        });

    if (error) {
      // Unique index race — treat as taken.
      if (error.code === '23505') {
        return new Response(
          JSON.stringify({
            error: 'slug_taken',
            message: 'Article id already reserved (concurrent create).',
          }),
          { status: 409, headers }
        );
      }
      console.error('Reserve write failed:', error);
      return new Response(JSON.stringify({ error: error.message, details: error }), { status: 500, headers });
    }

    return new Response(
      JSON.stringify({
        success: true,
        reserved: registration_status === 'reserved',
        registration_status,
        action: decision.action,
        listing_status: row.listing_status ?? existing?.listing_status ?? 'unlisted',
      }),
      { status: 200, headers }
    );
  } catch (e: any) {
    console.error('register-article error:', e);
    return new Response(JSON.stringify({ error: e?.message || 'Invalid request' }), { status: 400, headers });
  }
});
