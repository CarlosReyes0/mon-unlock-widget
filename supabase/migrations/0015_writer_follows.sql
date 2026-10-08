-- Free per-writer follows. Service role only (no anon/authenticated policies).
-- Applying this file does not email anyone: existing listed articles are
-- marked followers_notified_at so the trigger will not enqueue them.

create table if not exists public.follows (
  id                 bigint generated always as identity primary key,
  writer_wallet      text not null check (writer_wallet ~ '^0x[a-f0-9]{40}$'),
  follower_email     text check (follower_email is null or follower_email = lower(follower_email)),
  follower_wallet    text check (follower_wallet is null or follower_wallet ~ '^0x[a-f0-9]{40}$'),
  source             text not null check (source in ('email','wallet')),
  verified_at        timestamptz,            -- email: on confirm; wallet: on signed follow
  unsubscribed_at    timestamptz,            -- null = active
  confirm_token_hash text,                   -- sha256 of the emailed token; null once used
  confirm_expires_at timestamptz,            -- 48h
  confirm_sent_count int not null default 0, -- per-row resend throttle
  last_confirm_sent_at timestamptz,
  consent_version    text,                   -- copy shown at follow time, e.g. 'follow-v1'
  created_ip_hash    text,                   -- sha256(ip + FOLLOW_TOKEN_SECRET), never raw IP
  via                text,                   -- 'feed' | 'article' | 'post_unlock' | 'writer_page'
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint follows_one_identity check (num_nonnulls(follower_email, follower_wallet) = 1),
  constraint follows_source_matches check (
    (source = 'email'  and follower_email  is not null) or
    (source = 'wallet' and follower_wallet is not null)),
  constraint follows_no_self check (follower_wallet is null or follower_wallet <> writer_wallet)
);

create unique index if not exists follows_writer_email_uq
  on public.follows (writer_wallet, follower_email)  where follower_email  is not null;
create unique index if not exists follows_writer_wallet_uq
  on public.follows (writer_wallet, follower_wallet) where follower_wallet is not null;
create index if not exists follows_active_by_writer
  on public.follows (writer_wallet) where verified_at is not null and unsubscribed_at is null;
create index if not exists follows_by_follower_wallet
  on public.follows (follower_wallet) where follower_wallet is not null;

-- Global opt-out ("stop all Open Paywall emails") + bounces/complaints.
create table if not exists public.email_suppressions (
  email      text primary key check (email = lower(email)),
  reason     text not null check (reason in ('global_unsubscribe','bounce','complaint')),
  created_at timestamptz not null default now()
);

-- Outbox: one row per article that should notify followers.
alter table public.articles add column if not exists followers_notified_at timestamptz;

create table if not exists public.follow_notifications (
  id            bigint generated always as identity primary key,
  article_id    text not null unique,            -- slug; unique = never notify twice
  writer_wallet text not null,
  send_after    timestamptz not null default now() + interval '10 minutes',
  status        text not null default 'pending'
                check (status in ('pending','sending','sent','skipped','failed')),
  skip_reason   text,
  attempts      int not null default 0,
  created_at    timestamptz not null default now(),
  finished_at   timestamptz
);

create index if not exists follow_notifications_due
  on public.follow_notifications (send_after)
  where status = 'pending';

create table if not exists public.follow_deliveries (
  notification_id bigint not null references public.follow_notifications(id),
  follow_id       bigint not null references public.follows(id),
  status          text not null check (status in ('sent','failed','suppressed')),
  provider_id     text,
  error           text,
  created_at      timestamptz not null default now(),
  primary key (notification_id, follow_id)       -- idempotent retries
);

alter table public.follows              enable row level security;
alter table public.email_suppressions   enable row level security;
alter table public.follow_notifications enable row level security;
alter table public.follow_deliveries    enable row level security;
revoke all on public.follows, public.email_suppressions,
              public.follow_notifications, public.follow_deliveries
  from anon, authenticated;
-- No policies on purpose: the anon key is public (shipped in the widget).

-- Publish hook: every path that lists a registered article (register-article,
-- update-listing, agent publish, markArticleRegistered) hits this trigger.
-- A skipped (unlisted during the grace window) row is re-queued if the writer
-- lists the same slug again. A sent row is left alone.
create or replace function public.enqueue_follow_notification() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.listing_status = 'listed'
     and new.registration_status = 'registered'
     and new.followers_notified_at is null
     and new.article_id is not null
     and (tg_op = 'INSERT'
          or old.listing_status is distinct from 'listed'
          or old.registration_status is distinct from 'registered') then
    insert into public.follow_notifications (article_id, writer_wallet)
    values (new.article_id, new.publisher)
    on conflict (article_id) do update
      set status = 'pending',
          skip_reason = null,
          send_after = now() + interval '10 minutes',
          attempts = 0,
          finished_at = null,
          writer_wallet = excluded.writer_wallet
      where public.follow_notifications.status = 'skipped';
  end if;
  return new;
end $$;

drop trigger if exists articles_enqueue_follow_notification on public.articles;
create trigger articles_enqueue_follow_notification
  after insert or update of listing_status, registration_status on public.articles
  for each row execute function public.enqueue_follow_notification();

-- IMPORTANT: don't blast followers about old posts on deploy.
update public.articles set followers_notified_at = now()
  where listing_status = 'listed' and followers_notified_at is null;
