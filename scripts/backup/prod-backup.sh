#!/usr/bin/env bash
# Read-only production dump. The only database commands are `supabase db dump`.
# Dump files stay on the runner disk, are encrypted, then deleted before publish.
set -euo pipefail
umask 077

cd "$(dirname "$0")/../.."
source scripts/backup/common.sh

if [[ -n "${BACKUP_PUSH_URL:-}" ]]; then
  echo "Refusing to run: BACKUP_PUSH_URL is only for the local drill." >&2
  exit 1
fi

for cmd in supabase age python3 git tar sha256sum; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "missing command: $cmd" >&2
    exit 1
  fi
done
if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required. supabase db dump runs a Postgres 17 client in a container." >&2
  exit 1
fi

work=$(mktemp -d)
mask_file="$work/masks"
trap 'rm -rf "$work"' EXIT

# Classify before any dump. Registration of masks happens before the class line
# is printed, and the class line does not contain the URI.
class=$(python3 scripts/backup/classify_url.py --write-masks "$mask_file")
if [[ -n "${GITHUB_ACTIONS:-}" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -n "$line" ]] && printf '::add-mask::%s\n' "$line"
  done < "$mask_file"
fi
rm -f "$mask_file"
echo "$class"

export SUPABASE_DB_MAJOR_VERSION=17
if ! supabase telemetry disable; then
  echo "warning: could not disable the CLI telemetry preference; continuing" >&2
fi

dump="$work/dump"
mkdir -p "$dump"

echo "Dumping roles (read-only)."
supabase db dump --db-url "$SUPABASE_DB_URL" --role-only --file "$dump/roles.sql"
echo "Dumping schema (read-only)."
supabase db dump --db-url "$SUPABASE_DB_URL" --file "$dump/schema.sql"
echo "Dumping data (read-only)."
supabase db dump --db-url "$SUPABASE_DB_URL" --data-only --use-copy \
  --exclude storage.buckets_vectors \
  --exclude storage.vector_indexes \
  --file "$dump/data.sql"
chmod 600 "$dump/roles.sql" "$dump/schema.sql" "$dump/data.sql"

sanity_check_dump "$dump"
sizes=$(write_manifest "$dump")
echo "$sizes"

stamp=$(date -u +%Y%m%dT%H%M%SZ)
archive="$work/openpaywall-${stamp}.tar.gz.age"
cipher=$(encrypt_dump_dir "$dump" "$archive")
echo "$cipher"
# Plaintext is gone before the archive is published.
rm -rf "$dump"

scripts/backup/publish.sh "$archive"

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  {
    echo "### Prod database backup"
    echo "- archive: \`openpaywall-${stamp}.tar.gz.age\`"
    echo "- ${sizes}"
    echo "- ${cipher}"
    echo "- branch: \`backups\` (single orphan commit, newest files only)"
  } >> "$GITHUB_STEP_SUMMARY"
fi
echo "backup published openpaywall-${stamp}.tar.gz.age"
