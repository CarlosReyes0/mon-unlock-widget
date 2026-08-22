-- Dual payment assets: native MON (legacy) and USDC (new ArticleUnlockUsdc).
-- Existing rows default to 'mon' so legacy embeds keep working (path A).

alter table public.articles
  add column if not exists payment_asset text not null default 'mon';

alter table public.unlocks
  add column if not exists payment_asset text not null default 'mon';

alter table public.articles
  drop constraint if exists articles_payment_asset_check;

alter table public.articles
  add constraint articles_payment_asset_check
  check (payment_asset in ('mon', 'usdc'));

alter table public.unlocks
  drop constraint if exists unlocks_payment_asset_check;

alter table public.unlocks
  add constraint unlocks_payment_asset_check
  check (payment_asset in ('mon', 'usdc'));

comment on column public.articles.payment_asset is
  'mon = native MON price_wei (18 decimals); usdc = USDC price_wei (6 decimals)';
comment on column public.unlocks.payment_asset is
  'Settlement asset for this unlock row (mon or usdc)';
