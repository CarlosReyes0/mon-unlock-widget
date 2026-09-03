-- Opt-in Open Paywall directory / hosted feed.
-- listing_status: unlisted (default) | listed (auto-publish) | hidden (moderator hide)
-- external_url is optional and editable later (publisher's own site).

alter table public.articles
  add column if not exists title text,
  add column if not exists author text,
  add column if not exists listing_status text not null default 'unlisted',
  add column if not exists external_url text,
  add column if not exists listed_at timestamptz,
  add column if not exists embed_sig text;

alter table public.articles
  drop constraint if exists articles_listing_status_check;

alter table public.articles
  add constraint articles_listing_status_check
  check (listing_status in ('unlisted', 'listed', 'hidden'));

comment on column public.articles.listing_status is
  'unlisted = not on Open Paywall feed; listed = public; hidden = moderator removed';
comment on column public.articles.external_url is
  'Optional canonical URL on the publisher site; editable after listing';
comment on column public.articles.embed_sig is
  'Publisher-signed embed stamp for hosted article page / fiat checkout';

create index if not exists idx_articles_listing_status_listed_at
  on public.articles (listing_status, listed_at desc nulls last)
  where listing_status = 'listed';
