#!/usr/bin/env bash
# Shared helpers for the prod backup and the local restore drill.
# These functions must not echo connection strings, keys, or SQL.

sanity_check_dump() {
  local dir="$1"
  local file table schema_bytes data_bytes
  for file in roles.sql schema.sql data.sql; do
    if [[ ! -s "$dir/$file" ]]; then
      echo "sanity check failed: $file is missing or empty" >&2
      return 1
    fi
  done
  schema_bytes=$(wc -c < "$dir/schema.sql" | tr -d ' ')
  data_bytes=$(wc -c < "$dir/data.sql" | tr -d ' ')
  if (( schema_bytes < 1000 )); then
    echo "sanity check failed: schema.sql is only ${schema_bytes} bytes" >&2
    return 1
  fi
  if (( data_bytes < 200 )); then
    echo "sanity check failed: data.sql is only ${data_bytes} bytes" >&2
    return 1
  fi
  for table in writer_plans used_signatures; do
    if ! grep -q "$table" "$dir/schema.sql"; then
      echo "sanity check failed: schema.sql does not mention ${table}" >&2
      return 1
    fi
    if ! grep -q "$table" "$dir/data.sql"; then
      echo "sanity check failed: data.sql does not mention ${table}" >&2
      return 1
    fi
  done
  echo "sanity check passed (writer_plans, used_signatures present)"
}

write_manifest() {
  local dir="$1"
  local roles schema data
  roles=$(wc -c < "$dir/roles.sql" | tr -d ' ')
  schema=$(wc -c < "$dir/schema.sql" | tr -d ' ')
  data=$(wc -c < "$dir/data.sql" | tr -d ' ')
  cat > "$dir/manifest.txt" <<EOF
created_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
roles_bytes=${roles}
schema_bytes=${schema}
data_bytes=${data}
sanity_tables=writer_plans,used_signatures
EOF
  echo "plaintext bytes: roles=${roles} schema=${schema} data=${data}"
}

encrypt_dump_dir() {
  local dir="$1"
  local out="$2"
  local recipient="${BACKUP_AGE_RECIPIENT:?BACKUP_AGE_RECIPIENT is required}"
  local tar
  if [[ ! "$recipient" =~ ^age1[0-9a-z]+$ ]]; then
    echo "BACKUP_AGE_RECIPIENT must be one age public key starting with age1" >&2
    return 1
  fi
  tar=$(mktemp)
  tar -C "$dir" -czf "$tar" roles.sql schema.sql data.sql manifest.txt
  age -r "$recipient" -o "$out" "$tar"
  rm -f "$tar"
  if [[ ! -s "$out" ]]; then
    echo "encryption produced an empty file" >&2
    return 1
  fi
  chmod 600 "$out"
  echo "ciphertext bytes: $(wc -c < "$out" | tr -d ' ')"
}

decrypt_archive() {
  local archive="$1"
  local dest="$2"
  local identity="$3"
  local tar
  tar=$(mktemp)
  age -d -i "$identity" -o "$tar" "$archive"
  mkdir -p "$dest"
  tar -C "$dest" -xzf "$tar"
  rm -f "$tar"
}

prune_archives() {
  local dir="$1"
  local keep="$2"
  local -a files=()
  local name count remove i
  if [[ ! "$keep" =~ ^[0-9]+$ ]] || (( keep < 1 )); then
    echo "retention must be a positive integer" >&2
    return 1
  fi
  while IFS= read -r name; do
    [[ -n "$name" ]] && files+=("$name")
  done < <(find "$dir" -maxdepth 1 -type f -name 'openpaywall-*.tar.gz.age' -printf '%f\n' | sort)
  count=${#files[@]}
  if (( count <= keep )); then
    echo "retention: keeping ${count} archive(s), limit ${keep}"
    return 0
  fi
  remove=$((count - keep))
  for ((i = 0; i < remove; i++)); do
    rm -f "$dir/${files[$i]}"
    echo "pruned ${files[$i]}"
  done
  echo "retention: kept ${keep}, pruned ${remove}"
}
