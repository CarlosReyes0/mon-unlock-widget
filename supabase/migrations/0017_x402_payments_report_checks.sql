-- x402 payment log + unpaid endpoint freshness checks.
-- Service role only: RLS on, no policies for anon/authenticated.
-- Repeat unlocks stay charge-per-call; this table is a log, not an entitlement.
--
-- The probe cron calls POST /api/x402/report/probe with header
-- x-x402-report-probe-secret. The Railway/server env var is
-- X402_REPORT_PROBE_SECRET. Empty vault values do not authenticate.
-- The handler also reads X402_REPORT_PROBE_SLUG (article slug to GET).
--
-- BEFORE the job can succeed, store the same value you set as
-- X402_REPORT_PROBE_SECRET (do not commit it):
--
--   select vault.create_secret(
--     '<paste X402_REPORT_PROBE_SECRET — do not commit it>',
--     'x402_report_probe_secret',
--     'Open Paywall x402 unpaid report probe'
--   );

create extension if not exists pgcrypto;
create extension if not exists supabase_vault with schema vault;
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create table if not exists public.x402_payments (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('publish', 'unlock')),
  -- articles.id is bigint. Nullable: publish can be paid before a row exists.
  article_id bigint references public.articles (id) on delete set null,
  payer text,
  amount_atomic numeric,
  network text,
  asset text,
  tx text,
  created_at timestamptz not null default now()
);

create index if not exists x402_payments_article_id_kind_idx
  on public.x402_payments (article_id, kind);

create index if not exists x402_payments_payer_idx
  on public.x402_payments (payer);

-- One row per probed endpoint. article_id is the slug for the article GET
-- (null for the publish and validate checks). endpoint is the upsert key.
create table if not exists public.report_checks (
  endpoint text primary key,
  article_id text,
  last_tested timestamptz not null default now(),
  status text not null check (status in ('live_402_challenge', 'live_200_free', 'failing')),
  details jsonb not null default '{}'::jsonb
);

alter table public.x402_payments enable row level security;
alter table public.report_checks enable row level security;

revoke all on public.x402_payments from anon, authenticated;
revoke all on public.report_checks from anon, authenticated;

-- No policies: anon/authenticated cannot read or write. service_role bypasses RLS.

drop view if exists public.x402_article_stats;
create view public.x402_article_stats
with (security_invoker = true, security_barrier = true) as
select
  article_id,
  count(distinct payer) as unique_payers,
  count(*) filter (where kind = 'unlock') as total_unlocks,
  coalesce(sum(amount_atomic), 0) as amount,
  max(created_at) as last_paid_at
from public.x402_payments
where article_id is not null
group by article_id;

revoke all on public.x402_article_stats from public, anon, authenticated;
grant select on public.x402_article_stats to service_role;

do $$
begin
  perform cron.unschedule('open-paywall-x402-report-probe');
exception
  when others then null;
end $$;

select cron.schedule(
  'open-paywall-x402-report-probe',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://openpaywall.app/api/x402/report/probe',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-x402-report-probe-secret', coalesce(
        (select decrypted_secret from vault.decrypted_secrets where name = 'x402_report_probe_secret' limit 1),
        ''
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  ) as request_id;
  $$
);
