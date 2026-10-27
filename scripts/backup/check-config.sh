#!/usr/bin/env bash
# Exit 0 when the backup cannot run yet. A missing secret is a skip, not a failure,
# so the workflow can land on main before Carlos finishes the one-time setup.
# Any later dump or publish error must still fail the job.
set -euo pipefail

missing=()
if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  missing+=("secret SUPABASE_DB_URL")
fi
if [[ -z "${BACKUP_AGE_RECIPIENT:-}" ]]; then
  missing+=("variable BACKUP_AGE_RECIPIENT")
fi
if [[ -z "${BACKUP_DEPLOY_KEY:-}" && -z "${BACKUP_GITHUB_TOKEN:-}" ]]; then
  missing+=("secret BACKUP_DEPLOY_KEY (or secret BACKUP_GITHUB_TOKEN)")
fi

write_output() {
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    echo "$1" >> "$GITHUB_OUTPUT"
  fi
}

if ((${#missing[@]} > 0)); then
  echo "Backup skipped. Not configured yet. Missing:"
  printf '  - %s\n' "${missing[@]}"
  echo "See docs/backups.md. This skip is intentional so the schedule can be merged before secrets exist."
  echo "::notice title=Backup skipped::Required backup secrets or variables are not set yet. See docs/backups.md."
  write_output "configured=false"
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    {
      echo "### Backup skipped"
      echo "Required secrets or variables are not set yet. See docs/backups.md."
    } >> "$GITHUB_STEP_SUMMARY"
  fi
  exit 0
fi

echo "Backup configuration is present. Values are not printed."
write_output "configured=true"
