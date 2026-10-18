-- NOT APPLIED to production by this change. Do not run this file until the
-- server build that checks PAYOUTS_CRON_ENABLED is already deployed.
-- Until that flag is the string true, the handler transfers nothing.
--
-- Adds the platform charge id used as Transfer source_transaction, and
-- schedules a caller for POST /api/stripe/payouts/process.
-- The schedule does not call the admin retry path.
--
-- BEFORE the job can authenticate, store the same value you set on the
-- Railway web service as STRIPE_PAYOUT_CRON_SECRET:
--
--   select vault.create_secret(
--     '<paste STRIPE_PAYOUT_CRON_SECRET — do not commit it>',
--     'stripe_payout_cron_secret',
--     'Open Paywall payout cron'
--   );
--
-- Do not put the secret in this file. Failed payout rows are not retried
-- by this schedule. Retry stays a separate admin action.

create extension if not exists supabase_vault with schema vault;
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

alter table public.fiat_unlocks
  add column if not exists stripe_charge_id text;

alter table public.payout_jobs
  add column if not exists stripe_charge_id text;

comment on column public.fiat_unlocks.stripe_charge_id is
  'Platform charge id for Connect source_transaction. Do not log it.';

comment on column public.payout_jobs.stripe_charge_id is
  'Charge id copied onto the payout row for source_transaction. Do not log it.';

create index if not exists idx_fiat_unlocks_stripe_charge
  on public.fiat_unlocks (stripe_charge_id)
  where stripe_charge_id is not null;

do $$
begin
  perform cron.unschedule('open-paywall-payouts');
exception
  when others then null;
end $$;

select cron.schedule(
  'open-paywall-payouts',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://openpaywall.app/api/stripe/payouts/process',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', coalesce(
        (select decrypted_secret from vault.decrypted_secrets where name = 'stripe_payout_cron_secret' limit 1),
        ''
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  ) as request_id;
  $$
);
