#!/usr/bin/env bash
# Local proof of the backup path. Never opens a remote database.
# Seeds Postgres 17 from supabase/migrations, dumps, encrypts with age,
# decrypts, restores into a second cluster, and checks row counts.
set -euo pipefail
umask 077

cd "$(dirname "$0")/../.."
source scripts/backup/common.sh

# A developer shell may already have the prod URI. Drop it before anything else.
unset SUPABASE_DB_URL BACKUP_DEPLOY_KEY BACKUP_GITHUB_TOKEN BACKUP_AGE_RECIPIENT BACKUP_ALLOW_DIRECT BACKUP_PUSH_URL || true

echo "static checks"
if grep -E -n 'psql|db push|db reset|db query' scripts/backup/prod-backup.sh; then
  echo "prod-backup.sh must stay dump-only" >&2
  exit 1
fi
dump_calls=$(grep -c 'supabase db dump --' scripts/backup/prod-backup.sh)
if [[ "$dump_calls" != "3" ]]; then
  echo "expected 3 db dump calls, found ${dump_calls}" >&2
  exit 1
fi
if ! grep -q '0 9 \* \* 0' .github/workflows/prod-db-backup.yml; then
  echo "weekly cron is missing" >&2
  exit 1
fi
if ! grep -q 'workflow_dispatch' .github/workflows/prod-db-backup.yml; then
  echo "workflow_dispatch is missing" >&2
  exit 1
fi
if grep -q 'pull_request' .github/workflows/prod-db-backup.yml; then
  echo "backup workflow must not run on pull_request" >&2
  exit 1
fi
if grep -q 'prod-alert' .github/workflows/prod-db-backup.yml; then
  echo "backup workflow must not open public alert issues" >&2
  exit 1
fi

echo "connection class checks"
assert_refused() {
  local url="$1"
  local needle="$2"
  local err
  err=$(mktemp)
  if SUPABASE_DB_URL="$url" python3 scripts/backup/classify_url.py >"$err" 2>&1; then
    echo "URI was accepted and should have been refused (${needle})" >&2
    rm -f "$err"
    exit 1
  fi
  if ! grep -q "$needle" "$err"; then
    echo "refusal did not mention ${needle}" >&2
    rm -f "$err"
    exit 1
  fi
  if grep -q 'drill-password' "$err"; then
    echo "refusal printed the fixture password" >&2
    rm -f "$err"
    exit 1
  fi
  rm -f "$err"
}

assert_refused \
  'postgresql://postgres:drill-password@db.flczjqljgntmkanipugo.supabase.co:5432/postgres' \
  'IPv6'
assert_refused \
  'postgresql://postgres:drill-password@db.flczjqljgntmkanipugo.supabase.com:5432/postgres' \
  'IPv6'
assert_refused \
  'postgresql://postgres.flczjqljgntmkanipugo:drill-password@aws-0-us-west-2.pooler.supabase.com:6543/postgres' \
  '6543'

mask=$(mktemp)
class=$(SUPABASE_DB_URL='postgresql://postgres.flczjqljgntmkanipugo:drill-password@aws-1-us-west-2.pooler.supabase.com:5432/postgres' \
  python3 scripts/backup/classify_url.py --write-masks "$mask")
if [[ "$class" != *"session pooler"* ]]; then
  echo "session pooler URI was not accepted" >&2
  exit 1
fi
if [[ "$class" == *"drill-password"* ]]; then
  echo "classifier printed the fixture password" >&2
  exit 1
fi
if ! grep -q 'drill-password' "$mask"; then
  echo "mask file did not contain the fixture password" >&2
  exit 1
fi
rm -f "$mask"
direct_class=$(BACKUP_ALLOW_DIRECT=true \
  SUPABASE_DB_URL='postgresql://postgres:drill-password@db.flczjqljgntmkanipugo.supabase.co:5432/postgres' \
  python3 scripts/backup/classify_url.py)
if [[ "$direct_class" != *"BACKUP_ALLOW_DIRECT=true"* ]]; then
  echo "direct host override was not honored" >&2
  exit 1
fi
echo "classify ok"

echo "skip-when-unconfigured check"
skip_out=$(mktemp)
skip_log=$(GITHUB_OUTPUT="$skip_out" bash scripts/backup/check-config.sh)
if ! grep -q 'configured=false' "$skip_out"; then
  echo "missing configuration should skip" >&2
  exit 1
fi
if [[ "$skip_log" != *"Backup skipped"* ]]; then
  echo "skip message was not printed" >&2
  exit 1
fi
ready_out=$(mktemp)
ready_log=$(
  GITHUB_OUTPUT="$ready_out" \
    SUPABASE_DB_URL='postgresql://postgres:drill-password@aws-0-us-west-2.pooler.supabase.com:5432/postgres' \
    BACKUP_AGE_RECIPIENT='age1drillpublickeynotreal' \
    BACKUP_DEPLOY_KEY='dummy-key' \
    bash scripts/backup/check-config.sh
)
if ! grep -q 'configured=true' "$ready_out"; then
  echo "complete configuration should proceed" >&2
  exit 1
fi
if [[ "$ready_log" == *"drill-password"* || "$ready_log" == *"dummy-key"* ]]; then
  echo "check-config printed a fixture secret" >&2
  exit 1
fi
rm -f "$skip_out" "$ready_out"
echo "config gate ok"

echo "retention and orphan-branch check"
keep_dir=$(mktemp -d)
for stamp in 20260101T000000Z 20260108T000000Z 20260115T000000Z 20260122T000000Z; do
  echo x > "$keep_dir/openpaywall-${stamp}.tar.gz.age"
done
prune_archives "$keep_dir" 2 >/dev/null
kept=$(find "$keep_dir" -name 'openpaywall-*.tar.gz.age' | wc -l | tr -d ' ')
if [[ "$kept" != "2" ]]; then
  echo "prune kept ${kept}, expected 2" >&2
  exit 1
fi
if [[ -e "$keep_dir/openpaywall-20260101T000000Z.tar.gz.age" ]]; then
  echo "prune left the oldest archive" >&2
  exit 1
fi
rm -rf "$keep_dir"

bare=$(mktemp -d)/backups.git
git init -q --bare "$bare"
publish_fixture() {
  local stamp="$1"
  local file
  file=$(mktemp)
  echo "ciphertext ${stamp}" > "$file"
  mv "$file" "$(dirname "$file")/openpaywall-${stamp}.tar.gz.age"
  file="$(dirname "$file")/openpaywall-${stamp}.tar.gz.age"
  BACKUP_KEEP=2 BACKUP_REPO=example/openpaywall-backups \
    bash scripts/backup/publish.sh "$file" "$bare" >/dev/null
  rm -f "$file"
}
publish_fixture 20260201T000000Z
publish_fixture 20260208T000000Z
publish_fixture 20260215T000000Z
commits=$(git --git-dir="$bare" rev-list --count backups)
names=$(git --git-dir="$bare" ls-tree -r --name-only backups | sort)
if [[ "$commits" != "1" ]]; then
  echo "orphan branch has ${commits} commits, expected 1" >&2
  exit 1
fi
if ! grep -q 'openpaywall-20260215T000000Z.tar.gz.age' <<<"$names"; then
  echo "newest archive missing from branch" >&2
  exit 1
fi
if grep -q 'openpaywall-20260201T000000Z.tar.gz.age' <<<"$names"; then
  echo "pruned archive is still on the branch" >&2
  exit 1
fi
rm -rf "$(dirname "$bare")"
echo "publish drill ok commits=1 kept=2"

if ! command -v age >/dev/null 2>&1 || ! command -v age-keygen >/dev/null 2>&1; then
  echo "age is not installed" >&2
  exit 1
fi

pg_root=/usr/lib/postgresql
if [[ ! -d "$pg_root/17/bin" ]]; then
  echo "PostgreSQL 17 client is not installed under ${pg_root}/17" >&2
  exit 1
fi
bin="$pg_root/17/bin"
echo "$("$bin/psql" --version)"

root=$(mktemp -d)
src_data=""
dst_data=""
cleanup() {
  if [[ -n "$src_data" && -d "$src_data" ]]; then
    "$bin/pg_ctl" -D "$src_data" -m immediate stop >/dev/null 2>&1 || true
  fi
  if [[ -n "$dst_data" && -d "$dst_data" ]]; then
    "$bin/pg_ctl" -D "$dst_data" -m immediate stop >/dev/null 2>&1 || true
  fi
  rm -rf "$root"
}
trap cleanup EXIT

free_port() {
  python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()'
}

start_cluster() {
  local name="$1"
  local user="$2"
  local dir="$root/$name"
  local data="$dir/data"
  local sock="$dir/sock"
  local port
  port=$(free_port)
  mkdir -p "$sock"
  "$bin/initdb" -D "$data" --auth=trust --username "$user" --no-instructions --locale=C >/dev/null
  "$bin/pg_ctl" -D "$data" -l "$dir/postgres.log" -w \
    -o "-p ${port} -k ${sock} -c listen_addresses=" start >/dev/null
  printf '%s %s\n' "$port" "$sock" > "$dir/conn"
  if [[ "$name" == "source" ]]; then
    src_data=$data
  else
    dst_data=$data
  fi
}

psql_as() {
  local sock="$1"
  local port="$2"
  local user="$3"
  local db="$4"
  shift 4
  PGOPTIONS='-c client_min_messages=warning' \
    "$bin/psql" -h "$sock" -p "$port" -U "$user" -d "$db" -v ON_ERROR_STOP=1 -q "$@"
}

echo "starting source cluster"
start_cluster source "$USER"
read -r src_port src_sock < "$root/source/conn"
psql_as "$src_sock" "$src_port" "$USER" postgres -c 'create database openpaywall' >/dev/null
psql_as "$src_sock" "$src_port" "$USER" openpaywall -f scripts/backup/local-stubs.sql >/dev/null

mapfile -t migrations < <(find supabase/migrations -maxdepth 1 -name '*.sql' | sort)
if ((${#migrations[@]} == 0)); then
  echo "no migration files found" >&2
  exit 1
fi
for migration in "${migrations[@]}"; do
  filtered="$root/$(basename "$migration")"
  sed -E 's/^create extension[^;]*;/select 1;/Ig' "$migration" > "$filtered"
  if ! psql_as "$src_sock" "$src_port" "$USER" openpaywall -f "$filtered" >/dev/null; then
    echo "migration failed: $(basename "$migration")" >&2
    tail -n 40 "$root/source/postgres.log" >&2 || true
    exit 1
  fi
done
psql_as "$src_sock" "$src_port" "$USER" openpaywall -f scripts/backup/local-seed.sql >/dev/null

count_sql="select 'articles=' || count(*)::text from public.articles
union all select 'used_signatures=' || count(*)::text from public.used_signatures
union all select 'writer_plans=' || count(*)::text from public.writer_plans
order by 1;"
src_counts=$(psql_as "$src_sock" "$src_port" "$USER" openpaywall -tA -c "$count_sql")
expected=$'articles=0\nused_signatures=3\nwriter_plans=2'
if [[ "$src_counts" != "$expected" ]]; then
  echo "source counts were not the seeded rows" >&2
  exit 1
fi

dump="$root/dump"
mkdir -p "$dump"
"$bin/pg_dumpall" -h "$src_sock" -p "$src_port" -U "$USER" \
  --roles-only --no-role-passwords --quote-all-identifiers \
  -f "$dump/roles.sql"
"$bin/pg_dump" -h "$src_sock" -p "$src_port" -U "$USER" -d openpaywall \
  --schema-only --quote-all-identifiers --no-owner \
  -f "$dump/schema.sql"
"$bin/pg_dump" -h "$src_sock" -p "$src_port" -U "$USER" -d openpaywall \
  --data-only --quote-all-identifiers --no-owner \
  -f "$dump/data.sql"
chmod 600 "$dump"/*.sql
sanity_check_dump "$dump"
write_manifest "$dump"

identity="$root/identity.txt"
age-keygen -o "$identity" >/dev/null 2>&1
recipient=$(sed -n 's/^# public key: //p' "$identity")
if [[ ! "$recipient" =~ ^age1[0-9a-z]+$ ]]; then
  echo "age-keygen did not write a public key" >&2
  exit 1
fi
stamp=$(date -u +%Y%m%dT%H%M%SZ)
archive="$root/openpaywall-${stamp}.tar.gz.age"
BACKUP_AGE_RECIPIENT="$recipient" encrypt_dump_dir "$dump" "$archive" >/dev/null
rm -rf "$dump"

plain="$root/plain"
decrypt_archive "$archive" "$plain" "$identity"
sanity_check_dump "$plain" >/dev/null
if ! grep -q '^sanity_tables=writer_plans,used_signatures$' "$plain/manifest.txt"; then
  echo "decrypted manifest is missing the sanity line" >&2
  exit 1
fi
for key in roles_bytes schema_bytes data_bytes; do
  if ! grep -q "^${key}=" "$plain/manifest.txt"; then
    echo "decrypted manifest is missing ${key}" >&2
    exit 1
  fi
done
# pg_dumpall records GRANTED BY the source superuser. A second cluster's
# superuser cannot execute that clause. Dropping it does not change table data.
sed -i -E 's/ GRANTED BY "[^"]+"//' "$plain/roles.sql"

echo "starting restore cluster"
start_cluster restore restoreadmin
read -r dst_port dst_sock < "$root/restore/conn"
psql_as "$dst_sock" "$dst_port" restoreadmin postgres -c 'create database openpaywall' >/dev/null
# psql on PATH is the same major; restore.sh calls psql from PATH.
export PATH="$bin:$PATH"
if ! bash scripts/backup/restore.sh "$plain" \
  -h "$dst_sock" -p "$dst_port" -U restoreadmin -d openpaywall >/dev/null; then
  echo "restore failed" >&2
  tail -n 50 "$root/restore/postgres.log" >&2 || true
  exit 1
fi
dst_counts=$(psql_as "$dst_sock" "$dst_port" restoreadmin openpaywall -tA -c "$count_sql")
if [[ "$dst_counts" != "$src_counts" ]]; then
  echo "restored counts do not match the source" >&2
  exit 1
fi

echo "roundtrip ok"
