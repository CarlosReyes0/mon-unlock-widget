-- Indexer state table for incremental scanning
-- Stores the last successfully indexed block so the Edge Function can resume
-- without re-scanning the entire chain on every run.

create table if not exists public.indexer_state (
  id bigint primary key generated always as identity,
  contract_address text not null unique,
  last_indexed_block numeric(78, 0) not null,
  updated_at timestamptz not null default now()
);

-- RLS: only the Edge Function (service role) writes; dashboard can read if needed
alter table public.indexer_state enable row level security;

create policy "Allow public read access to indexer_state"
  on public.indexer_state for select
  using (true);

-- Note: Service role bypasses RLS for writes from the Edge Function.