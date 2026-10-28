-- Cap articles.price_cents at $1,000.00 (100000 cents).
-- NOT APPLIED by this change. Do not run this file from the app deploy.
--
-- A count of rows with price_cents above 100000 was 0 when this file was
-- written. The constraint is NOT VALID so applying it does not rewrite any
-- row and does not fail if a row is already over the cap. New inserts and
-- updates must still satisfy the check. VALIDATE CONSTRAINT can run later,
-- after any over-cap rows are gone. This file does not update or delete rows.

alter table public.articles
  drop constraint if exists articles_price_cents_max;

alter table public.articles
  add constraint articles_price_cents_max
  check (price_cents is null or price_cents <= 100000)
  not valid;

comment on constraint articles_price_cents_max on public.articles is
  'Listed USD price cannot exceed $1,000.00 (100000 cents). NOT VALID: existing rows were not rewritten.';

comment on column public.articles.price_cents is
  'Listed USD price in cents. Card and USDC checkout use this when set. Null keeps the previous client amount. Maximum is $1,000.00 (100000 cents).';
