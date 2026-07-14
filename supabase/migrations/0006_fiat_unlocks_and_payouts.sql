-- Fiat (Stripe) unlocks + publisher USDC payout routing.
-- Access is hybrid: on-chain unlocks OR fiat_unlocks rows grant article-body.

create table if not exists public.fiat_unlocks (
  id bigint primary key generated always as identity,
  article_id text,
  article_id_hash text not null,
  publisher text not null,
  session_token text not null unique,
  stripe_payment_intent_id text not null unique,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'usd',
  buyer_email text,
  status text not null default 'succeeded'
    check (status in ('succeeded', 'refunded', 'disputed')),
  unlocked_at timestamptz not null default now()
);

create index if not exists idx_fiat_unlocks_article_hash
  on public.fiat_unlocks(article_id_hash);
create index if not exists idx_fiat_unlocks_session
  on public.fiat_unlocks(session_token);
create index if not exists idx_fiat_unlocks_publisher
  on public.fiat_unlocks(publisher);

-- Stripe Connect Express accounts for publishers (USDC payout target).
create table if not exists public.publisher_accounts (
  publisher text primary key,
  stripe_account_id text unique,
  usdc_wallet text,
  onboarded_at timestamptz,
  updated_at timestamptz not null default now()
);

-- Queue: fiat charge → Transfer to Connect account (USDC when stablecoin payouts enabled).
create table if not exists public.payout_jobs (
  id bigint primary key generated always as identity,
  fiat_unlock_id bigint not null references public.fiat_unlocks(id),
  publisher text not null,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'usd',
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'paid', 'failed', 'skipped')),
  stripe_transfer_id text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_payout_jobs_status on public.payout_jobs(status);
create index if not exists idx_payout_jobs_publisher on public.payout_jobs(publisher);

alter table public.fiat_unlocks enable row level security;
alter table public.publisher_accounts enable row level security;
alter table public.payout_jobs enable row level security;

-- No public policies: service role only (checkout server + edge functions).
