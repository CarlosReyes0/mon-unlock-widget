-- Writer Dashboard Schema
-- Stores articles registered on-chain and aggregates unlock revenue.

create table if not exists public.articles (
  id bigint primary key generated always as identity,
  article_id text not null, -- The human-readable slug, e.g., "test-6"
  article_id_hash text not null unique, -- The keccak256 bytes32 as hex string
  publisher text not null, -- The wallet address (0x...)
  price_wei numeric(78, 0) not null, -- Store as string to avoid precision loss
  active boolean not null default true,
  registered_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Track individual unlock payments for revenue calculation
create table if not exists public.unlocks (
  id bigint primary key generated always as identity,
  article_id_hash text not null references public.articles(article_id_hash),
  reader text not null, -- The wallet that paid
  amount_wei numeric(78, 0) not null,
  tx_hash text,
  unlocked_at timestamptz not null default now()
);

-- Indexes for fast dashboard queries
create index if not exists idx_articles_publisher on public.articles(publisher);
create index if not exists idx_unlocks_article on public.unlocks(article_id_hash);

-- Enable Row Level Security (RLS)
-- We will allow public read access for the dashboard, but restrict writes to the Edge Function.
alter table public.articles enable row level security;
alter table public.unlocks enable row level security;

-- Allow anyone to read articles (for the dashboard)
create policy "Allow public read access to articles"
  on public.articles for select
  using (true);

-- Allow anyone to read unlocks (for the dashboard)
create policy "Allow public read access to unlocks"
  on public.unlocks for select
  using (true);

-- Note: We will use a Service Role key in the Edge Function to bypass RLS for writes.