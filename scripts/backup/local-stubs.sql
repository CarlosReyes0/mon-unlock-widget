-- Objects the hosted project provides and these migrations call.
-- pg_cron, pg_net, and supabase_vault are not installed for the local drill.
-- The roundtrip replaces CREATE EXTENSION in the migration files with select 1.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant anon, authenticated, service_role to current_user;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

create schema if not exists extensions;
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key,
  name text,
  public boolean,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create schema if not exists cron;
create or replace function cron.unschedule(job_name text) returns bigint
  language plpgsql as $$ begin return 1; end $$;
create or replace function cron.schedule(job_name text, schedule text, command text) returns bigint
  language plpgsql as $$ begin return 1; end $$;

create schema if not exists net;
create or replace function net.http_post(
  url text,
  headers jsonb,
  body jsonb,
  timeout_milliseconds integer
) returns bigint language sql as $$ select 1::bigint $$;

create schema if not exists vault;
create table if not exists vault.decrypted_secrets (
  name text,
  decrypted_secret text
);
