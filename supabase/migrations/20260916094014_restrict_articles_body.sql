-- Hide paid article body from the public Data API (anon / authenticated).
--
-- Why column grants (not a new RLS policy):
--   public.articles already has RLS enabled with
--   "Allow public read access to articles" USING (true). RLS is row-level only,
--   so that policy exposes every column — including body — to GET /rest/v1/articles
--   with the browser anon key. Column privileges are the minimal fix.
--
-- Why revoke table-level SELECT then re-grant columns:
--   A table-level GRANT SELECT still covers every column. REVOKE SELECT (body)
--   would be a no-op while the table-level grant remains.
--
-- service_role keeps table-level SELECT (including body) for:
--   Railway /api/article-body, Edge Function functions/v1/article-body,
--   register-article, indexer, listings-api, Stripe, OG cards.
--
-- When adding a new public column to articles, add it to the GRANT SELECT list
-- below (and to the dashboard explicit select). Do not grant body.
--
-- Smoke (anon key is the one embedded in article.html):
--   # Must fail (PGRST204 / 401 / permission denied — must not return paid text)
--   curl -sS -D- \
--     -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
--     "$URL/rest/v1/articles?select=body&article_id=eq.the-quote-was-a-trap-939i9e&limit=1"
--
--   # Listing columns must still work
--   curl -sS \
--     -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
--     "$URL/rest/v1/articles?select=article_id,title,teaser,price_wei,payment_asset,publisher,listing_status&article_id=eq.the-quote-was-a-trap-939i9e&limit=1"
--
--   # Unlock gate (no session): 400 reader_or_fiat_session_required
--   curl -sS "$RAILWAY/api/article-body?article_id=the-quote-was-a-trap-939i9e"
--
--   # Unlock lookup still reaches body via service_role: fake wallet → 403 not_unlocked
--   curl -sS "$RAILWAY/api/article-body?article_id=the-quote-was-a-trap-939i9e&reader=0x0000000000000000000000000000000000000001"

revoke select on table public.articles from anon, authenticated;

grant select (
  id,
  article_id,
  article_id_hash,
  publisher,
  price_wei,
  active,
  registered_at,
  updated_at,
  teaser,
  registration_status,
  payment_asset,
  title,
  author,
  listing_status,
  external_url,
  listed_at,
  embed_sig,
  allow_a_la_carte
) on table public.articles to anon, authenticated;

notify pgrst, 'reload schema';
