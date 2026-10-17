# One staging environment

This is for a single long-lived test site, not a preview on every pull request. Production stays on `openpaywall.app` and the Supabase project `flczjqljgntmkanipugo`. Do not point production at the test project, and do not point staging at production.

The app reads `SUPABASE_URL` and `SUPABASE_ANON_KEY` at runtime. When those are unset, pages and the server keep the production project, so production does not need new variables. Set `APP_ENV=staging` (or `preview`) on the test service. It will refuse to start if:

- `STRIPE_SECRET_KEY` starts with `sk_live_`, or a publishable key starts with `pk_live_`
- `SUPABASE_URL` is missing or is the production project
- `SUPABASE_ANON_KEY` is missing or is the production anon key

A staging process also shows a “Test site — fake payments” banner, sends `noindex` (a meta tag and `X-Robots-Tag`), answers `/robots.txt` with `Disallow: /`, turns the gas relayer off even if `RELAYER_PRIVATE_KEY` is set, and hides the crypto pay buttons. Card checkout still runs, so Stripe test cards work. Monad chain 143 is mainnet, so a crypto payment would spend real funds.

The embeddable widget on someone else’s site does not read this config. It keeps calling the production project. On our own pages the widget script is same-origin, so it uses the injected project and hides crypto there too.

## Railway variables

Create the staging service yourself. This repository change does not create it and does not change the production service.

Names only. Do not copy secret values out of production.

### Copy

Same non-secret values production already uses:

- `VITE_WALLETCONNECT_PROJECT_ID`
- `WALLETCONNECT_PROJECT_ID`

### Point at the test project and Stripe test mode

Set these on the staging service. `VITE_*` values are baked into the browser bundle at image build, and the server also reads `VITE_STRIPE_PUBLISHABLE_KEY` at startup so it can reject a live key. Set that variable for both the build and the running service.

- `APP_ENV` = `staging`
- `PUBLIC_ORIGIN` = the staging site origin, for example `https://your-service.up.railway.app`
- `SUPABASE_URL` = the test project URL (`https://<ref>.supabase.co`)
- `SUPABASE_ANON_KEY` = that project’s anon key
- `SUPABASE_SERVICE_ROLE_KEY` = that project’s service role key
- `STRIPE_SECRET_KEY` = `sk_test_...`
- `STRIPE_WEBHOOK_SECRET` = the signing secret for a webhook pointed at the staging URL
- `VITE_STRIPE_PUBLISHABLE_KEY` = `pk_test_...`
- `VITE_PRIVY_APP_ID` = a development Privy app whose allowed origins include the staging origin and localhost
- `FOLLOW_EMAILS_ENABLED` = `false`

Generate new values for the test project. Do not reuse production secrets:

- `REGISTER_PUBLISH_SECRET`, if agent publish is turned on
- `LISTING_ADMIN_SECRET`, if you need the hide control
- `READER_SESSION_SECRET`, only if you set one (it must match the test project’s edge function)
- `INDEXER_SECRET` and `FOLLOW_NOTIFY_SECRET`, only if you later schedule cron against this project

`VITE_CHECKOUT_ORIGIN` can stay unset. Hosted pages open checkout on the same origin as the widget script.

### Must stay unset

Leaving these empty keeps staging from spending real funds or sending real mail. The relayer is also forced off in code when `APP_ENV` is staging.

- `RELAYER_PRIVATE_KEY`
- `CDP_API_KEY_ID`
- `CDP_API_KEY_SECRET`
- `CDP_API_KEY`
- `CDP_API_SECRET`
- `MPP_SECRET_KEY`
- `MPP_TEMPO_RECIPIENT`
- `BASE_BUILDER_CODE`
- `VOICE_DRAFT_API_KEY`
- `RESEND_API_KEY`

Also leave `MIROSHARK_X402_PRIVATE_KEY`, `X402_PAY_TO`, `MPP_DEV_BYPASS`, and `X402_DEV_BYPASS` unset.

The content-security policy already allows `https://*.supabase.co`. The test project should be a normal Supabase host. Do not add `unsafe-eval` or a new script host to make staging work.

## Cron on the test database

Migrations `0005_schedule_indexer_cron.sql` and `20260928143000_indexer_cron_secret.sql` schedule `pg_cron` to POST to the **production** indexer every two minutes, with the production anon key. Migration `0016_follow_notify_cron.sql` POSTs to `https://openpaywall.app/api/follows/notify/process` every two minutes.

Do not edit those files. They are already applied on production. On the test project:

1. Apply the other migrations so the tables exist.
2. Skip `0005`, `20260928143000`, and `0016`.
3. If you already ran them, unschedule the jobs before you seed:

```sql
select cron.unschedule('mon-unlock-indexer');
select cron.unschedule('open-paywall-follow-notify');
```

Leave them unscheduled unless you mean to index the test project. A staging indexer must use the test project URL and a new `INDEXER_SECRET` stored in that project’s vault, not the production URL copied out of those files. The Railway cron service reads `SUPABASE_URL` and `SUPABASE_ANON_KEY` and refuses the production URL when `APP_ENV=staging`. Do not run that cron against production from the staging service.

Follow mail stays off while `FOLLOW_EMAILS_ENABLED=false`. Skipping `0016` means the test database will not call `openpaywall.app`.

## Seed

After the schema is applied and those cron jobs are absent, open `supabase/seed/staging.sql` in the test project’s SQL editor. Change `seed_ack` from `no` to `yes`, run the file once, and do not commit that edit.

The file inserts one demo writer (`0x1111111111111111111111111111111111111111`, no key in this repo) and one listed $0.50 article, `staging-demo-walk`, with a teaser and a paid body. `followers_notified_at` is set so listing the row does not queue a new-post email. It will not run if `seed_ack` is still `no`, if `cron.job` still mentions the production project or `openpaywall.app`, or if the production article slug `the-quote-was-a-trap-939i9e` is already in the database.

## What you still have to create

- A Supabase project that is not `flczjqljgntmkanipugo`, plus its URL, anon key, and service role key
- Stripe test-mode secret key, publishable key, and a webhook endpoint on the staging origin
- A Privy development app id allowed on the staging origin
- The Railway staging service and its public origin

Production Railway variables can stay as they are.
