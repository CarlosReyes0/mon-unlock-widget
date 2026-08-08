-- Globally unique article slugs + reservation status.
-- Reserve-on-create claims a slug in Supabase before (or without) on-chain registration.
-- Option A on-chain (ArticleTaken) is the hard stop; this is the product-level hold.

alter table public.articles
  add column if not exists registration_status text not null default 'registered';

comment on column public.articles.registration_status is
  'reserved = claimed in product DB; registered = confirmed on-chain (or legacy row).';

-- Existing rows are treated as registered (already live or indexed).
update public.articles
set registration_status = 'registered'
where registration_status is distinct from 'registered';

-- Human-readable slug must be unique when present (indexer may leave it null).
create unique index if not exists articles_article_id_unique
  on public.articles (article_id)
  where article_id is not null;

-- Helpful for reserve lookups by publisher
create index if not exists idx_articles_registration_status
  on public.articles (registration_status);
