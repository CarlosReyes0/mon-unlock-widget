#!/usr/bin/env python3
"""Classify a Supabase Postgres URI without printing it.

GitHub-hosted runners have no IPv6 route. On the Free plan the direct host
``db.<project-ref>.supabase.co`` is IPv6-only, so dumps must use the session
pooler (port 5432). Port 6543 is transaction mode and breaks pg_dump.
"""

from __future__ import annotations

import argparse
import os
import sys
from urllib.parse import unquote, urlparse


def _raw_url() -> str:
    raw = os.environ.get("SUPABASE_DB_URL", "")
    if not raw.strip():
        sys.exit("SUPABASE_DB_URL is empty")
    return raw


def _classify(raw: str) -> str:
    parsed = urlparse(raw)
    if parsed.scheme not in ("postgres", "postgresql"):
        sys.exit("SUPABASE_DB_URL must be a postgres:// or postgresql:// URI")
    host = (parsed.hostname or "").lower()
    if not host or not parsed.username:
        sys.exit("SUPABASE_DB_URL is missing a username or host")
    port = parsed.port or 5432
    allow_direct = os.environ.get("BACKUP_ALLOW_DIRECT", "").strip().lower() == "true"
    direct = host.startswith("db.") and (
        host.endswith(".supabase.co") or host.endswith(".supabase.com")
    )
    pooler = ".pooler.supabase." in host
    if port == 6543:
        sys.exit(
            "Refusing port 6543 (transaction pooler). "
            "pg_dump needs a session. Use the session pooler on port 5432."
        )
    if port != 5432:
        sys.exit(f"Refusing port {port}. Expected 5432.")
    if direct and not allow_direct:
        sys.exit(
            "Refusing the direct db.<project-ref>.supabase.co host. "
            "On the Free plan that address is IPv6-only, and GitHub-hosted "
            "runners are IPv4-only. Paste the Session pooler URI from the "
            "Supabase Connect panel (host aws-<n>-<region>.pooler.supabase.com, "
            "port 5432, user postgres.<project-ref>)."
        )
    if pooler:
        return "connection class: session pooler on port 5432 (IPv4)"
    if direct and allow_direct:
        return "connection class: direct host allowed because BACKUP_ALLOW_DIRECT=true"
    return "connection class: port 5432 session endpoint"


def _mask_values(raw: str) -> list[str]:
    parsed = urlparse(raw)
    values: list[str] = [raw]
    if parsed.password:
        values.append(parsed.password)
        decoded = unquote(parsed.password)
        if decoded != parsed.password:
            values.append(decoded)
    seen: list[str] = []
    for value in values:
        if value and value not in seen:
            seen.append(value)
    return seen


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--write-masks",
        metavar="FILE",
        help="Write the URI and password, one per line, for log masking. Not printed.",
    )
    args = parser.parse_args()
    raw = _raw_url()
    line = _classify(raw)
    if args.write_masks:
        with open(args.write_masks, "w", encoding="utf-8") as handle:
            handle.write("\n".join(_mask_values(raw)))
            handle.write("\n")
    print(line)


if __name__ == "__main__":
    main()
