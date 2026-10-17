-- Audit L1 + L2 (Oct 16 2026): defense in depth on top of RLS.
--
-- Next number after 0016. Other draft PRs may add migrations too; if another
-- branch also takes 0017, renumber this file on merge. Timestamped migrations
-- 20260916094014 and 20260928143000 sort after this file and stay as they are.
--
-- Idempotent. Safe to re-run.
--
-- anon and authenticated keep the SELECT grants they already have (public
-- read policies, and the column grants on articles). This revokes only
-- INSERT, UPDATE, DELETE, and TRUNCATE on the public tables the audit names:
--   publisher_accounts, fiat_unlocks, payout_jobs, subscriptions,
--   follows, follow_notifications, follow_deliveries, email_suppressions,
--   articles, unlocks, writer_plans, article_nfts, indexer_state.
-- service_role is not touched. Railway and the edge functions write with
-- the service role key, not the anon key.
--
-- Trigger functions: enqueue_follow_notification() is created in 0015.
-- rls_auto_enable() is installed by Supabase on hosted projects and is not
-- created by this repo, so the revoke runs only when that function exists.
-- EXECUTE is revoked from public, anon, and authenticated. service_role
-- keeps the EXECUTE grant Supabase's default privileges already gave it,
-- so the articles trigger still runs for server writes.

revoke insert, update, delete, truncate on table
  public.articles,
  public.unlocks,
  public.indexer_state,
  public.fiat_unlocks,
  public.publisher_accounts,
  public.payout_jobs,
  public.writer_plans,
  public.subscriptions,
  public.article_nfts,
  public.follows,
  public.email_suppressions,
  public.follow_notifications,
  public.follow_deliveries
from anon, authenticated;

revoke execute on function public.enqueue_follow_notification()
  from public, anon, authenticated;

do $$
declare
  fn regprocedure;
begin
  for fn in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'rls_auto_enable'
  loop
    execute format(
      'revoke execute on function %s from public, anon, authenticated',
      fn
    );
  end loop;
end $$;
