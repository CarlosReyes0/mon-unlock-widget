-- Per-writer subscriptions (fiat via Stripe Billing, crypto via Monad USDC).
-- Access: permanent purchase OR live subscription. Cancel drops sub access immediately.
-- Purchases stay unlocked. Writers can turn off à la carte (subscribe-only).

alter table public.articles
  add column if not exists allow_a_la_carte boolean not null default true;

comment on column public.articles.allow_a_la_carte is
  'If false, readers cannot buy this article; they must subscribe to the writer.';

create table if not exists public.writer_plans (
  publisher text primary key,
  monthly_price_cents integer not null default 500
    check (monthly_price_cents >= 50 and monthly_price_cents <= 100000),
  monthly_price_usdc numeric(78, 0) not null default 5000000,
  allow_a_la_carte boolean not null default true,
  stripe_product_id text,
  stripe_price_id text,
  updated_at timestamptz not null default now()
);

comment on table public.writer_plans is
  'Monthly subscribe-to-this-writer price. 0 USDC / omit row = not offering crypto/fiat sub.';

create table if not exists public.subscriptions (
  id bigint primary key generated always as identity,
  reader text not null,
  writer text not null,
  status text not null default 'active'
    check (status in ('active', 'canceled', 'past_due', 'lapsed')),
  source text not null check (source in ('stripe', 'crypto')),
  stripe_subscription_id text unique,
  stripe_customer_id text,
  tx_hash text,
  current_period_end timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (reader, writer, source)
);

create index if not exists idx_subscriptions_reader on public.subscriptions (reader);
create index if not exists idx_subscriptions_writer on public.subscriptions (writer);
create index if not exists idx_subscriptions_live
  on public.subscriptions (writer, reader)
  where status = 'active' and canceled_at is null;

alter table public.fiat_unlocks
  add column if not exists reader text;

create index if not exists idx_fiat_unlocks_reader
  on public.fiat_unlocks (reader)
  where reader is not null;

-- Subscription invoices reuse payout_jobs (Connect transfer to the writer).
alter table public.payout_jobs
  alter column fiat_unlock_id drop not null;

alter table public.payout_jobs
  add column if not exists subscription_id bigint references public.subscriptions(id);

alter table public.writer_plans enable row level security;
alter table public.subscriptions enable row level security;

create policy "Allow public read access to writer_plans"
  on public.writer_plans for select
  using (true);

-- Subscriptions are not public; service role only (no SELECT policy).
