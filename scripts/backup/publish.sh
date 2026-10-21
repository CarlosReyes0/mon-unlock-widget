#!/usr/bin/env bash
# Publish one ciphertext into the private backups repo.
# The branch "backups" is a single orphan commit holding the newest archives.
# History does not grow. --force-with-lease refuses to replace a tip we did not fetch.
set -euo pipefail

source "$(dirname "$0")/common.sh"

archive=$(realpath "${1:?archive path required}")
override_remote=${2:-}
backup_repo=${BACKUP_REPO:-CarlosReyes0/openpaywall-backups}
keep=${BACKUP_KEEP:-8}
base=$(basename "$archive")

if [[ ! "$backup_repo" =~ ^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$ ]]; then
  echo "BACKUP_REPO must look like owner/name" >&2
  exit 1
fi
if [[ ! "$keep" =~ ^[0-9]+$ ]] || (( keep < 1 || keep > 100 )); then
  echo "BACKUP_KEEP must be an integer from 1 to 100" >&2
  exit 1
fi
if [[ ! "$base" =~ ^openpaywall-[0-9]{8}T[0-9]{6}Z\.tar\.gz\.age$ ]]; then
  echo "archive name is not openpaywall-YYYYMMDDTHHMMSSZ.tar.gz.age" >&2
  exit 1
fi
if [[ ! -s "$archive" ]]; then
  echo "archive is missing or empty" >&2
  exit 1
fi

redact() {
  sed -E 's#(https://[^[:space:]]+|git@[^[:space:]]+)#<remote>#g' "$1"
}

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cd "$work"
git init -q -b scratch

remote=""
if [[ -n "$override_remote" ]]; then
  remote=$override_remote
elif [[ -n "${BACKUP_DEPLOY_KEY:-}" ]]; then
  key="$work/deploy_key"
  known="$work/known_hosts"
  umask 077
  KEY_PATH="$key" python3 - <<'PY'
import os
from pathlib import Path
raw = os.environ.get("BACKUP_DEPLOY_KEY", "")
if raw.count("\n") < 2 and "\\n" in raw:
    raw = raw.replace("\\n", "\n")
if not raw.endswith("\n"):
    raw += "\n"
Path(os.environ["KEY_PATH"]).write_text(raw)
PY
  chmod 600 "$key"
  if ! grep -q "PRIVATE KEY" "$key"; then
    echo "BACKUP_DEPLOY_KEY does not look like a private key" >&2
    exit 1
  fi
  # GitHub's published ed25519 host key (ssh-keyscan github.com).
  printf '%s\n' 'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl' > "$known"
  chmod 600 "$known"
  export GIT_SSH_COMMAND="ssh -i ${key} -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=${known}"
  remote="git@github.com:${backup_repo}.git"
elif [[ -n "${BACKUP_GITHUB_TOKEN:-}" ]]; then
  askpass="$work/askpass"
  cat > "$askpass" <<'EOF'
#!/bin/sh
case "$1" in
  Username*) printf '%s\n' "x-access-token" ;;
  *) printf '%s\n' "$BACKUP_GITHUB_TOKEN" ;;
esac
EOF
  chmod 700 "$askpass"
  export GIT_ASKPASS="$askpass"
  export GIT_TERMINAL_PROMPT=0
  remote="https://github.com/${backup_repo}.git"
else
  echo "No backup repo credential. Set BACKUP_DEPLOY_KEY or BACKUP_GITHUB_TOKEN." >&2
  exit 1
fi

git remote add origin "$remote"
export GIT_CONFIG_COUNT=1
export GIT_CONFIG_KEY_0=credential.helper
export GIT_CONFIG_VALUE_0=
export GIT_AUTHOR_NAME=openpaywall-backup
export GIT_AUTHOR_EMAIL=openpaywall-backup@users.noreply.github.com
export GIT_COMMITTER_NAME=openpaywall-backup
export GIT_COMMITTER_EMAIL=openpaywall-backup@users.noreply.github.com

fetch_log="$work/fetch.log"
set +e
git fetch --depth=1 origin refs/heads/backups >"$fetch_log" 2>&1
fetch_status=$?
set -e
lease=""
if (( fetch_status == 0 )); then
  lease=$(git rev-parse FETCH_HEAD)
  git checkout -q FETCH_HEAD -- .
else
  if grep -q "couldn't find remote ref" "$fetch_log"; then
    lease=""
    echo "branch backups does not exist yet; this will be the first push"
  else
    echo "Could not fetch refs/heads/backups" >&2
    redact "$fetch_log" >&2
    exit 1
  fi
fi

cp "$archive" "$work/$base"
prune_archives "$work" "$keep"
sha256sum openpaywall-*.tar.gz.age | sort -k2 > SHA256SUMS
cat > README.md <<'EOF'
# Open Paywall database backups

Each `openpaywall-*.tar.gz.age` file is a gzip-compressed Postgres dump
encrypted to an age public key. The private key is not in this repository.

Decrypt and restore from the application repo's `docs/backups.md`.
`SHA256SUMS` covers the ciphertext only.
EOF

git checkout -q --orphan rebuilt
git add -A
git commit -q -m "backup ${base%.tar.gz.age}"

push_log="$work/push.log"
set +e
if [[ -n "$lease" ]]; then
  git push --force-with-lease="refs/heads/backups:${lease}" origin HEAD:refs/heads/backups >"$push_log" 2>&1
else
  git push origin HEAD:refs/heads/backups >"$push_log" 2>&1
fi
push_status=$?
set -e
redact "$push_log"
if (( push_status != 0 )); then
  echo "push to refs/heads/backups failed" >&2
  exit 1
fi
echo "pushed refs/heads/backups (${base})"
