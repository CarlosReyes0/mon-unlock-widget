-- Optional Article NFTs on Monad (writer editions + reader receipts).
-- Unlock remains access; this table only records minted tokenId ↔ slug ↔ role.
-- Writes go through the server (service role). Public read for dashboards / tokenURI.

create table if not exists public.article_nfts (
  id bigint primary key generated always as identity,
  token_id numeric(78, 0) not null,
  article_slug text not null,
  role text not null check (role in ('edition', 'receipt')),
  minter text not null,
  amount numeric(78, 0) not null default 1,
  tx_hash text,
  contract text not null,
  minted_at timestamptz not null default now(),
  unique (contract, token_id)
);

comment on table public.article_nfts is
  'Monad ArticleNFT mints. tokenURI metadata is title/teaser/OG — never paid body.';
comment on column public.article_nfts.role is
  'edition = writer 1/1 or small edition; receipt = reader souvenir after crypto unlock';

create index if not exists idx_article_nfts_slug_role
  on public.article_nfts (article_slug, role);
create index if not exists idx_article_nfts_minter
  on public.article_nfts (minter);

alter table public.article_nfts enable row level security;

drop policy if exists "Allow public read access to article_nfts" on public.article_nfts;
create policy "Allow public read access to article_nfts"
  on public.article_nfts for select
  using (true);
