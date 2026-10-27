-- NOT APPLIED to production by this change. Do not run this file until the
-- payout server that reads the charge balance transaction is deployed.
--
-- Records the Stripe processing fee and the writer net on payout_jobs.
-- Both columns are nullable, so existing rows stay valid. This file does
-- not update, retry, or delete any payout row.

alter table public.payout_jobs
  add column if not exists stripe_fee_cents integer;

alter table public.payout_jobs
  add column if not exists net_cents integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'payout_jobs_stripe_fee_cents_check'
  ) then
    alter table public.payout_jobs
      add constraint payout_jobs_stripe_fee_cents_check
      check (stripe_fee_cents is null or stripe_fee_cents >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'payout_jobs_net_cents_check'
  ) then
    alter table public.payout_jobs
      add constraint payout_jobs_net_cents_check
      check (net_cents is null or net_cents >= 0);
  end if;
end $$;

comment on column public.payout_jobs.stripe_fee_cents is
  'Processing fee in cents from the charge balance transaction. Null until the payout run reads it.';

comment on column public.payout_jobs.net_cents is
  'Cents transferred to the writer after that fee, capped at the platform net. Null until the payout run.';
