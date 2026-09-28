-- Indexer cron must send x-indexer-secret.
-- The edge function rejects calls that do not carry INDEXER_SECRET.
--
-- BEFORE this job can succeed, store the same value you set on the
-- Edge Function secret INDEXER_SECRET and on the Railway cron service:
--
--   select vault.create_secret(
--     '<paste INDEXER_SECRET — do not commit it>',
--     'indexer_secret',
--     'Open Paywall indexer edge function'
--   );
--
-- The anon JWT below is the public project key (already in the widget).
-- It only satisfies the gateway verify_jwt check. It is not the indexer secret.
-- Re-applying 0005_schedule_indexer_cron.sql puts the open headers back;
-- re-apply this file afterward.

create extension if not exists supabase_vault with schema vault;
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $$
begin
  perform cron.unschedule('mon-unlock-indexer');
exception
  when others then null;
end $$;

select cron.schedule(
  'mon-unlock-indexer',
  '*/2 * * * *',
  $$
  select net.http_post(
    url := 'https://flczjqljgntmkanipugo.supabase.co/functions/v1/indexer',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsY3pqcWxqZ250bWthbmlwdWdvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE5MTUwNjQsImV4cCI6MjA5NzQ5MTA2NH0.ZKcFJ_4ZI4oK4hyZtR72vqC_JCdwttZSQQw82uTMEb4',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsY3pqcWxqZ250bWthbmlwdWdvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE5MTUwNjQsImV4cCI6MjA5NzQ5MTA2NH0.ZKcFJ_4ZI4oK4hyZtR72vqC_JCdwttZSQQw82uTMEb4',
      'x-indexer-secret', coalesce(
        (select decrypted_secret from vault.decrypted_secrets where name = 'indexer_secret' limit 1),
        ''
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  ) as request_id;
  $$
);
