-- Optional 1/1 article edition NFT on Base (collectible / provenance).
-- Unlock / USDC pricing stays the access gate. These columns are public
-- metadata so the hosted article page can show "Collectible minted".

alter table public.articles
  add column if not exists nft_token_id text,
  add column if not exists nft_contract text,
  add column if not exists nft_chain_id integer,
  add column if not exists nft_tx_hash text,
  add column if not exists nft_owner text,
  add column if not exists nft_minted_at timestamptz;

comment on column public.articles.nft_token_id is
  'ERC-721 token id on Base (ArticleEditionNFT). Null = no collectible minted.';
comment on column public.articles.nft_contract is
  'ArticleEditionNFT contract address. Unlock contracts stay on Monad.';
comment on column public.articles.nft_chain_id is
  '8453 Base mainnet or 84532 Base Sepolia.';

create unique index if not exists idx_articles_nft_contract_token
  on public.articles (nft_contract, nft_token_id)
  where nft_token_id is not null and nft_contract is not null;

-- Additive column grants: anon already lost table-level SELECT (see
-- 20260916094014_restrict_articles_body.sql). Do not grant body.
grant select (
  nft_token_id,
  nft_contract,
  nft_chain_id,
  nft_tx_hash,
  nft_owner,
  nft_minted_at
) on table public.articles to anon, authenticated;

notify pgrst, 'reload schema';
