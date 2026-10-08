-- Drain the follow-notification outbox every 2 minutes.
-- The Railway handler rejects calls that do not carry FOLLOW_NOTIFY_SECRET
-- in x-follow-notify-secret. Empty vault values do not authenticate.
--
-- BEFORE this job can succeed, store the same value you set on the
-- Railway web service as FOLLOW_NOTIFY_SECRET:
--
--   select vault.create_secret(
--     '<paste FOLLOW_NOTIFY_SECRET — do not commit it>',
--     'follow_notify_secret',
--     'Open Paywall follow notify cron'
--   );
--
-- Do not put the secret in this file. New-post sending also stays off until
-- Railway has FOLLOW_EMAILS_ENABLED=true and POSTAL_ADDRESS.

create extension if not exists supabase_vault with schema vault;
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $$
begin
  perform cron.unschedule('open-paywall-follow-notify');
exception
  when others then null;
end $$;

select cron.schedule(
  'open-paywall-follow-notify',
  '*/2 * * * *',
  $$
  select net.http_post(
    url := 'https://openpaywall.app/api/follows/notify/process',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-follow-notify-secret', coalesce(
        (select decrypted_secret from vault.decrypted_secrets where name = 'follow_notify_secret' limit 1),
        ''
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  ) as request_id;
  $$
);
