-- Schedule the indexer Edge Function via pg_cron + pg_net.
-- Requires pg_cron and pg_net enabled (Supabase Dashboard → Database → Extensions).
--
-- Apply: Supabase Dashboard → SQL Editor → run this file,
-- or: supabase db push (linked project).

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Idempotent: replace existing job if re-applied.
do $$
begin
  perform cron.unschedule('mon-unlock-indexer');
exception
  when others then null;
end $$;

select cron.schedule(
  'mon-unlock-indexer',
  '*/2 * * * *', -- every 2 minutes (cron syntax; "2 minutes" not supported on all Supabase Postgres versions)
  $$
  select net.http_post(
    url := 'https://flczjqljgntmkanipugo.supabase.co/functions/v1/indexer',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsY3pqcWxqZ250bWthbmlwdWdvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE5MTUwNjQsImV4cCI6MjA5NzQ5MTA2NH0.ZKcFJ_4ZI4oK4hyZtR72vqC_JCdwttZSQQw82uTMEb4',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsY3pqcWxqZ250bWthbmlwdWdvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE5MTUwNjQsImV4cCI6MjA5NzQ5MTA2NH0.ZKcFJ_4ZI4oK4hyZtR72vqC_JCdwttZSQQw82uTMEb4'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  ) as request_id;
  $$
);
