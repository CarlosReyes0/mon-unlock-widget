-- NOT APPLIED to production by this change. Do not run this file until
-- STRIPE_CONNECT_DIRECT_CHARGES is ready to turn on.
--
-- connect_model records which Connect setup a writer account uses.
-- Null means the original Express account: the platform charges, then a
-- payout job transfers the sale. 'direct' means card charges are created
-- on the connected account and are not queued for a platform transfer.
-- legacy_stripe_account_id keeps the previous Express account so payout
-- jobs that were already queued still have a transfer destination.
-- This file does not update, retry, or delete any payout row.

alter table public.publisher_accounts
  add column if not exists connect_model text;

alter table public.publisher_accounts
  add column if not exists legacy_stripe_account_id text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'publisher_accounts_connect_model_check'
  ) then
    alter table public.publisher_accounts
      add constraint publisher_accounts_connect_model_check
      check (connect_model is null or connect_model in ('legacy', 'direct'));
  end if;
end $$;

comment on column public.publisher_accounts.connect_model is
  'Null or legacy: platform charge plus transfer. direct: charge on the connected account.';

comment on column public.publisher_accounts.legacy_stripe_account_id is
  'Previous Express account. Pending platform transfers use this after a writer re-onboards.';
