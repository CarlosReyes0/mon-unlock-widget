#!/usr/bin/env bash
# Restore roles.sql, then schema.sql, then data.sql.
# Extra arguments are passed to psql (connection flags or --dbname).
#
# Prod archives are produced by `supabase db dump`. Restore those into a new
# Supabase project, which already has the managed auth and storage schemas.
# The local drill's plain pg_dump files restore into an empty Postgres 17.
set -euo pipefail

dir=${1:?dump directory required}
shift

for file in roles.sql schema.sql data.sql; do
  if [[ ! -s "$dir/$file" ]]; then
    echo "restore: $dir/$file is missing or empty" >&2
    exit 1
  fi
done

psql \
  --single-transaction \
  --variable ON_ERROR_STOP=1 \
  --file "$dir/roles.sql" \
  --file "$dir/schema.sql" \
  --command 'SET session_replication_role = replica' \
  --file "$dir/data.sql" \
  "$@"
