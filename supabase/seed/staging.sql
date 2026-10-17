-- Demo data for a NON-production Supabase project.
--
-- Do not run this on production. The file refuses to run until you change
-- seed_ack below from 'no' to 'yes' in the test project's SQL editor, and it
-- still refuses if this database schedules the production indexer or the
-- production follow cron, or if it already contains a known production article.
-- Do not commit the 'yes' change.
--
-- Apply the schema migrations first. Skip these cron migrations on the test
-- project (they call production): 0005_schedule_indexer_cron.sql,
-- 20260928143000_indexer_cron_secret.sql, and 0016_follow_notify_cron.sql.
-- See docs/staging-environment.md.

begin;

do $seed$
declare
  seed_ack text := 'no'; -- STAGING_SEED_ACK change to yes only in the test project
  cron_hit boolean := false;
  prod_article boolean := false;
begin
  if seed_ack is distinct from 'yes' then
    raise exception
      'staging seed refused: change seed_ack from no to yes in the test project SQL editor, then run this file. Do not commit that change.';
  end if;

  if to_regclass('cron.job') is not null then
    select exists (
      select 1
      from cron.job
      where command ilike '%flczjqljgntmkanipugo%'
         or command ilike '%openpaywall.app%'
    )
    into cron_hit;
    if cron_hit then
      raise exception
        'staging seed refused: pg_cron in this database still calls production (the indexer project or openpaywall.app). Unschedule those jobs before seeding.';
    end if;
  end if;

  if to_regclass('public.articles') is not null then
    select exists (
      select 1
      from public.articles
      where article_id = 'the-quote-was-a-trap-939i9e'
    )
    into prod_article;
    if prod_article then
      raise exception
        'staging seed refused: this database already has a production article slug.';
    end if;
  end if;
end
$seed$;

-- Placeholder wallet. No private key for it is in this repo. Do not send real funds here.
insert into public.articles (
  article_id,
  article_id_hash,
  publisher,
  price_wei,
  teaser,
  body,
  title,
  author,
  payment_asset,
  price_cents,
  listing_status,
  listed_at,
  registration_status,
  allow_a_la_carte,
  followers_notified_at,
  updated_at
) values (
  'staging-demo-walk',
  '0xe8c2732a36a54ccc29f7af7c790533d127a986d13b6ad5534181a66131377951',
  '0x1111111111111111111111111111111111111111',
  500000,
  'This is the free preview on the test site. Payments here are not real.',
  'This is the paid body of the staging demo. It stays off the public listing.',
  'A walk that costs fifty cents',
  'Demo Writer',
  'usdc',
  50,
  'listed',
  now(),
  'registered',
  true,
  now(),
  now()
)
on conflict (article_id_hash) do update set
  article_id = excluded.article_id,
  publisher = excluded.publisher,
  price_wei = excluded.price_wei,
  teaser = excluded.teaser,
  body = excluded.body,
  title = excluded.title,
  author = excluded.author,
  payment_asset = excluded.payment_asset,
  price_cents = excluded.price_cents,
  listing_status = excluded.listing_status,
  listed_at = excluded.listed_at,
  registration_status = excluded.registration_status,
  allow_a_la_carte = excluded.allow_a_la_carte,
  followers_notified_at = excluded.followers_notified_at,
  updated_at = now();

insert into public.writer_plans (
  publisher,
  monthly_price_cents,
  monthly_price_usdc,
  allow_a_la_carte,
  updated_at
) values (
  '0x1111111111111111111111111111111111111111',
  500,
  5000000,
  true,
  now()
)
on conflict (publisher) do update set
  monthly_price_cents = excluded.monthly_price_cents,
  monthly_price_usdc = excluded.monthly_price_usdc,
  allow_a_la_carte = excluded.allow_a_la_carte,
  updated_at = now();

commit;
