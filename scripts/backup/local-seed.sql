-- Fixed rows for the local restore drill. Not production data.
insert into public.writer_plans (publisher, monthly_price_cents, monthly_price_usdc)
values
  ('backup-drill-writer-a', 500, 5000000),
  ('backup-drill-writer-b', 900, 9000000);

insert into public.used_signatures (sig_hash, wallet, purpose)
values
  ('backup-drill-hash-1', 'backup-drill-writer-a', 'plan'),
  ('backup-drill-hash-2', 'backup-drill-writer-b', 'alacarte'),
  ('backup-drill-hash-3', 'backup-drill-writer-a', 'plan');
