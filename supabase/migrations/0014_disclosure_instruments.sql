-- DRAFT SPIKE. Do not apply to production. Do not merge to main.
--
-- Disclosure badge ticker map (spec v0.1, 2026-10-06).
-- Schema only for the curated instrument map. SIWE, transfers, and badges
-- are sketched in docs/disclosure-badge-spike.md and are not in this file.
--
-- Seed is seven US xStocks that had a Monad deployment on the Backed public
-- API on 2026-10-07. verified_at stays null: an admin still has to confirm
-- each row. deploy_block stays null (public RPC has no historical state far
-- enough back to find creation). shares_per_token stays 1; on-chain
-- multiplier() is recorded in the spike doc and is not applied here.
--
-- article_instrument.article_id references public.articles.id (bigint).

create table if not exists public.issuer_allowlist (
  issuer text primary key,
  display_name text not null,
  source_url text not null,
  active boolean not null default true
);

comment on table public.issuer_allowlist is
  'Issuers whose token contracts may back a disclosure badge. v1 is Backed xStocks only.';

create table if not exists public.instrument (
  id uuid primary key default gen_random_uuid(),
  primary_ticker text not null,
  exchange text not null,
  figi text,
  isin text,
  cik text,
  name text not null,
  type text not null check (type in ('common', 'etf', 'adr', 'preferred', 'other')),
  status text not null default 'active' check (status in ('active', 'renamed', 'delisted', 'merged', 'suspended')),
  aliases text[] not null default '{}',
  successor_id uuid references public.instrument (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (primary_ticker, exchange)
);

comment on table public.instrument is
  'One row per share class, not per company. GOOGL and GOOG are different rows.';
comment on column public.instrument.primary_ticker is
  'Underlying ticker (TSLA), never the token symbol (TSLAx).';
comment on column public.instrument.exchange is
  'MIC code (XNAS, XNYS, ARCX).';
comment on column public.instrument.isin is
  'Underlying ISIN. Not the Swiss certificate ISIN on the xStock itself.';
comment on column public.instrument.aliases is
  'Names used for detection only. Never match a token by on-chain symbol.';

create table if not exists public.instrument_history (
  id bigint primary key generated always as identity,
  instrument_id uuid not null references public.instrument (id),
  event_type text not null check (event_type in (
    'rename', 'ticker_change', 'split', 'reverse_split',
    'delisting', 'merger', 'share_class_change'
  )),
  effective_at timestamptz not null,
  old_value jsonb,
  new_value jsonb,
  source_url text,
  created_at timestamptz not null default now()
);

comment on table public.instrument_history is
  'Renames, splits, and delistings so an old article still resolves. Empty in this seed.';

create table if not exists public.instrument_token (
  id uuid primary key default gen_random_uuid(),
  instrument_id uuid not null references public.instrument (id),
  chain text not null,
  chain_id integer not null,
  contract text not null,
  token_role text not null default 'base' check (token_role in ('base', 'wrapper')),
  base_token_id uuid references public.instrument_token (id),
  symbol text not null,
  issuer text not null references public.issuer_allowlist (issuer),
  decimals integer not null,
  shares_per_token numeric not null default 1,
  deploy_block bigint,
  status text not null default 'active' check (status in ('active', 'paused', 'deprecated')),
  verified_at timestamptz,
  verified_by text,
  created_at timestamptz not null default now(),
  unique (chain_id, contract),
  constraint instrument_token_contract_lower check (
    contract = lower(contract) and contract ~ '^0x[0-9a-f]{40}$'
  ),
  constraint instrument_token_role_link check (
    (token_role = 'base' and base_token_id is null)
    or (token_role = 'wrapper' and base_token_id is not null)
  )
);

comment on table public.instrument_token is
  'One contract per chain. Uniqueness is (chain_id, contract), never contract alone. Wrappers aggregate with their base or a wrap looks like a sale.';
comment on column public.instrument_token.symbol is
  'Display only (TSLAx, wTSLAx). Never used to match prose or to trust an unknown contract.';
comment on column public.instrument_token.verified_at is
  'Null until an admin confirms symbol(), decimals(), and the issuer source. Unverified rows do not offer a badge.';
comment on column public.instrument_token.deploy_block is
  'Backfill starts here. Null in this seed: not yet read from an archive or explorer.';

create index if not exists idx_instrument_token_instrument
  on public.instrument_token (instrument_id);

create table if not exists public.article_instrument (
  article_id bigint not null references public.articles (id) on delete cascade,
  instrument_id uuid not null references public.instrument (id),
  source text not null check (source in ('auto', 'writer_confirmed')),
  confidence numeric,
  first_offset integer,
  confirmed_at timestamptz,
  primary key (article_id, instrument_id)
);

comment on table public.article_instrument is
  'Instruments an article is about. A badge requires source = writer_confirmed. article_id is articles.id (bigint), not the text slug.';

create index if not exists idx_article_instrument_instrument
  on public.article_instrument (instrument_id);

alter table public.issuer_allowlist enable row level security;
alter table public.instrument enable row level security;
alter table public.instrument_history enable row level security;
alter table public.instrument_token enable row level security;
alter table public.article_instrument enable row level security;

create policy "Allow public read access to active issuers"
  on public.issuer_allowlist for select
  using (active = true);

create policy "Allow public read access to active instruments"
  on public.instrument for select
  using (status = 'active');

create policy "Allow public read access to instrument_history"
  on public.instrument_history for select
  using (true);

create policy "Allow public read access to active instrument tokens"
  on public.instrument_token for select
  using (status = 'active');

-- Hosted article pages are readable while articles.active is true.
-- Writer insert/update policies wait for the SIWE publish path.
create policy "Allow public read access to article instruments"
  on public.article_instrument for select
  using (
    exists (
      select 1
      from public.articles a
      where a.id = article_id
        and a.active = true
    )
  );

grant select on public.issuer_allowlist to anon, authenticated;
grant select on public.instrument to anon, authenticated;
grant select on public.instrument_history to anon, authenticated;
grant select on public.instrument_token to anon, authenticated;
grant select on public.article_instrument to anon, authenticated;

-- Seed. The inserts are safe to re-run (on conflict do nothing).
-- The file as a whole is a normal one-shot migration: policies are not
-- created with IF NOT EXISTS. verified_at is intentionally left null.

insert into public.issuer_allowlist (issuer, display_name, source_url)
values (
  'backed',
  'Backed Finance (xStocks)',
  'https://api.backed.fi/api/v2/public/assets'
)
on conflict (issuer) do nothing;

insert into public.instrument (
  primary_ticker, exchange, isin, cik, name, type, aliases
)
values
  -- Names and CIKs are cik_str / title from SEC company_tickers.json
  -- fetched 2026-10-07, except QQQ (no row in that file).
  ('TSLA', 'XNAS', 'US88160R1014', '1318605', 'Tesla, Inc.', 'common', array['Tesla', 'Tesla Motors']),
  ('AAPL', 'XNAS', 'US0378331005', '320193', 'Apple Inc.', 'common', array['Apple']),
  ('NVDA', 'XNAS', 'US67066G1040', '1045810', 'NVIDIA CORP', 'common', array['NVIDIA', 'Nvidia']),
  ('META', 'XNAS', 'US30303M1027', '1326801', 'Meta Platforms, Inc.', 'common', array['Meta', 'Meta Platforms', 'Facebook']),
  ('GOOGL', 'XNAS', 'US02079K3059', '1652044', 'Alphabet Inc.', 'common', array['Alphabet']),
  ('SPY', 'ARCX', 'US78462F1030', '884394', 'SPDR S&P 500 ETF TRUST', 'etf', array['S&P 500', 'SPDR']),
  -- QQQ: company_tickers.json had no QQQ row. Name is a placeholder. cik is null.
  ('QQQ', 'XNAS', 'US46090E1038', null, 'Invesco QQQ Trust, Series 1', 'etf', array['Nasdaq-100', 'Invesco QQQ'])
on conflict (primary_ticker, exchange) do nothing;

-- Base contracts. symbol/decimals checked with eth_call on https://rpc.monad.xyz
-- on 2026-10-07. All seven are EIP-1967 proxies sharing one implementation.
insert into public.instrument_token (
  instrument_id, chain, chain_id, contract, token_role, symbol, issuer, decimals, shares_per_token
)
select i.id, 'monad', 143, v.contract, 'base', v.symbol, 'backed', 18, 1
from public.instrument i
join (
  values
    ('TSLA', 'XNAS', '0x8ad3c73f833d3f9a523ab01476625f269aeb7cf0', 'TSLAx'),
    ('AAPL', 'XNAS', '0x9d275685dc284c8eb1c79f6aba7a63dc75ec890a', 'AAPLx'),
    ('NVDA', 'XNAS', '0xc845b2894dbddd03858fd2d643b4ef725fe0849d', 'NVDAx'),
    ('META', 'XNAS', '0x96702be57cd9777f835117a809c7124fe4ec989a', 'METAx'),
    ('GOOGL', 'XNAS', '0xe92f673ca36c5e2efd2de7628f815f84807e803f', 'GOOGLx'),
    ('SPY', 'ARCX', '0x90a2a4c76b5d8c0bc892a69ea28aa775a8f2dd48', 'SPYx'),
    ('QQQ', 'XNAS', '0xa753a7395cae905cd615da0b82a53e0560f250af', 'QQQx')
) as v(primary_ticker, exchange, contract, symbol)
  on i.primary_ticker = v.primary_ticker
 and i.exchange = v.exchange
on conflict (chain_id, contract) do nothing;

-- Wrappers. On-chain symbol is wTSLAx (not TSLAx). asset() returns the base.
-- Leaving these out of the aggregate makes a wrap look like a full sale.
insert into public.instrument_token (
  instrument_id, chain, chain_id, contract, token_role, base_token_id, symbol, issuer, decimals, shares_per_token
)
select b.instrument_id, 'monad', 143, v.contract, 'wrapper', b.id, v.symbol, 'backed', 18, 1
from public.instrument_token b
join (
  values
    ('0x8ad3c73f833d3f9a523ab01476625f269aeb7cf0', '0xc3fdbe3a68ee5de461d30415a8165cf9aefe1171', 'wTSLAx'),
    ('0x9d275685dc284c8eb1c79f6aba7a63dc75ec890a', '0x943bf64d566c32a2bcd41ac92fb63c111cc9de8f', 'wAAPLx'),
    ('0xc845b2894dbddd03858fd2d643b4ef725fe0849d', '0xa8ddb5cd96b5222afe198316e9a57caa642850d5', 'wNVDAx'),
    ('0x96702be57cd9777f835117a809c7124fe4ec989a', '0xe840946ffebcd66b7c4e95095effafadfa0d0e56', 'wMETAx'),
    ('0xe92f673ca36c5e2efd2de7628f815f84807e803f', '0xf8c5308f80e459bb53d9ebe689854d9cbb2caa6f', 'wGOOGLx'),
    ('0x90a2a4c76b5d8c0bc892a69ea28aa775a8f2dd48', '0xe7e553cd128f0011777323a0b44a7b96ea1cb540', 'wSPYx'),
    ('0xa753a7395cae905cd615da0b82a53e0560f250af', '0x4c1ae29c159838fc1b224636e28e086eb69101f7', 'wQQQx')
) as v(base_contract, contract, symbol)
  on b.contract = v.base_contract
 and b.chain_id = 143
 and b.token_role = 'base'
on conflict (chain_id, contract) do nothing;

notify pgrst, 'reload schema';
