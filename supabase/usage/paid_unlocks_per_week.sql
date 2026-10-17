-- Paid unlocks per week, from data that is already stored.
-- This file is a read-only query for the Supabase SQL editor. It is not a
-- migration. Do not apply it. It creates nothing.
--
-- The one number: unlocks in the current UTC week (Monday 00:00 through
-- the next Monday). Revenue is included where the tables already have it.
--
-- Methods that are trivial from existing columns:
--   crypto_mon   public.unlocks.payment_asset is mon (or anything other than usdc)
--                revenue is sum(amount_wei) — 18 decimal MON
--   crypto_usdc  public.unlocks.payment_asset = 'usdc'
--                revenue is sum(amount_wei) — 6 decimal USDC
--   stripe       succeeded public.fiat_unlocks
--                revenue is sum(amount_cents) — USD cents
--
-- Not available without new tracking, so this query does not invent them:
--   card vs Apple Pay vs Google Pay (fiat_unlocks has no payment-method column)
--   x402 agent payments (they are not inserted into unlocks or fiat_unlocks)
--   which wallet was used to sign in
--
-- Postgres date_trunc('week', ...) starts on Monday, same as the admin page.

-- This week.
select
  date_trunc('week', (now() at time zone 'utc'))::date as week,
  method,
  unlocks,
  revenue_atomic
from (
  select
    case when payment_asset = 'usdc' then 'crypto_usdc' else 'crypto_mon' end as method,
    count(*)::int as unlocks,
    coalesce(sum(amount_wei), 0)::text as revenue_atomic
  from public.unlocks
  where unlocked_at >= (date_trunc('week', (now() at time zone 'utc')) at time zone 'utc')
  group by 1
  union all
  select
    'stripe',
    count(*)::int,
    coalesce(sum(amount_cents), 0)::text
  from public.fiat_unlocks
  where status = 'succeeded'
    and unlocked_at >= (date_trunc('week', (now() at time zone 'utc')) at time zone 'utc')
  group by 1
) current_week
order by method;

-- Every week that has a paid unlock (newest first).
select week, method, unlocks, revenue_atomic
from (
  select
    date_trunc('week', unlocked_at at time zone 'utc')::date as week,
    case when payment_asset = 'usdc' then 'crypto_usdc' else 'crypto_mon' end as method,
    count(*)::int as unlocks,
    coalesce(sum(amount_wei), 0)::text as revenue_atomic
  from public.unlocks
  group by 1, 2
  union all
  select
    date_trunc('week', unlocked_at at time zone 'utc')::date,
    'stripe',
    count(*)::int,
    coalesce(sum(amount_cents), 0)::text
  from public.fiat_unlocks
  where status = 'succeeded'
  group by 1
) weeks
order by week desc, method;
