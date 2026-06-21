-- Store the original teaser and body text so the dashboard can reproduce
-- the exact embed block the generator created.

alter table public.articles
  add column if not exists teaser text,
  add column if not exists body text;