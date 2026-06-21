-- Make article_id nullable so the indexer can insert rows
-- when it only has the hash (the event does not emit the human-readable slug).

alter table public.articles
  alter column article_id drop not null;