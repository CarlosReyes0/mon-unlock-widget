-- USD price for an article, in cents. Nullable so existing rows stay valid.
-- $0.50 is the Stripe USD minimum. No product maximum.
-- Unlock rows are not touched: a later price change does not remove access.

alter table public.articles
  add column if not exists price_cents integer;

alter table public.articles
  drop constraint if exists articles_price_cents_min;

alter table public.articles
  add constraint articles_price_cents_min
  check (price_cents is null or price_cents >= 50);

comment on column public.articles.price_cents is
  'Listed USD price in cents. Card and USDC checkout use this when set. Null keeps the previous client amount.';
