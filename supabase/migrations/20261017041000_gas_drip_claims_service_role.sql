-- Persistent gas-drip limits. One row per funded address, counted per UTC day
-- for the global cap. The server calls claim_gas_drip with the service role.
-- Idempotent. RLS on, no policies, and anon/authenticated have no grants, so
-- the public anon key cannot read or write this table.

create table if not exists public.gas_drip_claims (
  address text primary key check (address ~ '^0x[a-f0-9]{40}$'),
  claimed_at timestamptz not null default now()
);

create index if not exists gas_drip_claims_claimed_at_idx
  on public.gas_drip_claims (claimed_at);

alter table public.gas_drip_claims enable row level security;

revoke all on table public.gas_drip_claims from public, anon, authenticated;
grant select, insert, delete on table public.gas_drip_claims to service_role;

-- security invoker: runs as the caller. service_role has the table grants
-- and bypasses RLS. anon cannot execute this function.
create or replace function public.claim_gas_drip(
  p_address text,
  p_day_start timestamptz,
  p_cap integer
) returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  n integer;
begin
  if p_address is null or p_address !~ '^0x[a-f0-9]{40}$' then
    return 'invalid_address';
  end if;
  if p_cap is null or p_cap < 1 then
    return 'rate_limited';
  end if;

  perform pg_advisory_xact_lock(hashtext('openpaywall_gas_drip'));

  if exists (select 1 from public.gas_drip_claims where address = p_address) then
    return 'already_claimed';
  end if;

  select count(*) into n
  from public.gas_drip_claims
  where claimed_at >= p_day_start;
  if n >= p_cap then
    return 'rate_limited';
  end if;

  insert into public.gas_drip_claims (address) values (p_address);
  return 'ok';
exception
  when unique_violation then
    return 'already_claimed';
end
$$;

revoke all on function public.claim_gas_drip(text, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.claim_gas_drip(text, timestamptz, integer) to service_role;

-- Daily counters for voice drafts (per address) and media uploads (per uploader).
-- take_rate_limit increments one row and returns the new count. The server
-- compares that count to its cap. Idempotent. RLS on, no policies.
-- security invoker: service_role has the grants and bypasses RLS.
-- anon and authenticated cannot execute the function or touch the table.

create table if not exists public.rate_limit_counters (
  bucket text not null check (char_length(bucket) between 1 and 64),
  key text not null check (char_length(key) between 1 and 200),
  day date not null,
  count integer not null default 0 check (count >= 0),
  primary key (bucket, key, day)
);

alter table public.rate_limit_counters enable row level security;

revoke all on table public.rate_limit_counters from public, anon, authenticated;
grant select, insert, update on table public.rate_limit_counters to service_role;

create or replace function public.take_rate_limit(
  p_bucket text,
  p_key text,
  p_day date
) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  n integer;
begin
  if p_bucket is null or char_length(p_bucket) < 1 or char_length(p_bucket) > 64 then
    raise exception 'invalid_bucket';
  end if;
  if p_key is null or char_length(p_key) < 1 or char_length(p_key) > 200 then
    raise exception 'invalid_key';
  end if;
  if p_day is null then
    raise exception 'invalid_day';
  end if;

  insert into public.rate_limit_counters as c (bucket, key, day, count)
  values (p_bucket, p_key, p_day, 1)
  on conflict (bucket, key, day)
  do update set count = c.count + 1
  returning c.count into n;

  return n;
end
$$;

revoke all on function public.take_rate_limit(text, text, date) from public, anon, authenticated;
grant execute on function public.take_rate_limit(text, text, date) to service_role;
