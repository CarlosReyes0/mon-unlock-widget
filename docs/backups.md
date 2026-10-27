# Database backups

Production Postgres is the Supabase project `flczjqljgntmkanipugo` (Postgres 17, us-west-2) on the Free plan. That plan has no platform backups. This repo's weekly workflow is the backup: a read-only dump, encrypted with an age public key, pushed to a separate private git repo.

The workflow does not write to production. It does not create the backups repo, set secrets, or change repository settings. Those steps are below, and they are manual.

## What a backup contains

Three SQL files, packed into one `openpaywall-YYYYMMDDTHHMMSSZ.tar.gz` and encrypted to a single age recipient:

| File | Command | What you get |
| --- | --- | --- |
| `roles.sql` | `supabase db dump --role-only` | Custom roles only. The CLI strips reserved roles (`anon`, `authenticated`, `service_role`, `postgres`, `supabase_*`) and does not write passwords. |
| `schema.sql` | `supabase db dump` | App schema, including `public`. Managed schemas such as `auth`, `storage`, `vault`, and `cron` are left out on purpose. |
| `data.sql` | `supabase db dump --data-only --use-copy` | Rows for `public`, and for `auth` and `storage`. `vault` is left out. `storage.buckets_vectors` and `storage.vector_indexes` are excluded because Supabase's own restore guide excludes them. |

`manifest.txt` inside the archive records the byte size of each SQL file. That file is encrypted with the dump. The Actions log on this public repo says only whether the sanity check passed or failed. It does not print row counts or dump sizes. The private backups repo stores ciphertext plus `SHA256SUMS` of the ciphertext.

Not in the backup:

- Storage object bytes (photos and audio in the `article-media` bucket). The data file may contain `storage` metadata. The files themselves are not SQL.
- Edge Functions.
- Vault secrets (`indexer_secret`, `follow_notify_secret`). The CLI excludes the `vault` schema. Recreate them on a restored project with `vault.create_secret`.
- The Supabase Vault / pgsodium root key. Backup files never contain it. You only need it if you must decrypt data that was encrypted with that key.

Each run checks that `roles.sql`, `schema.sql`, and `data.sql` are non-empty, that the schema and data files are larger than a trivial stub, and that both mention `writer_plans` and `used_signatures`. An empty `used_signatures` table still passes: the dump names the table even when it has no rows. A failed check fails the job and does not publish. The public log line is `sanity check passed` or `sanity check failed`.

This repository is public. Do not paste a connection string, a dump size, or a table count into an issue, a pull request, or an Actions log. Compare counts on your machine during a restore drill.

## How the workflow runs

Workflow file: `.github/workflows/prod-db-backup.yml`.

- Schedule: Sunday 09:00 UTC (`0 9 * * 0`). GitHub runs that only from the default branch, and it may start late when the repo has been quiet.
- Manual: Actions → **prod-db-backup** → **Run workflow**.
- If the required secret or the age public key is missing, the job prints `Backup skipped` and exits 0. That is so this file can be on `main` before setup is finished.
- If the dump, the sanity check, or the publish fails, the job fails and stops there. This repo is public, so the workflow does not open a GitHub issue. GitHub emails the repository owner about the failed Actions run. That mail is private. Turn the notification on under GitHub → Settings → Notifications → Actions if it is off.

The job's `GITHUB_TOKEN` cannot push anywhere. Checkout does not persist credentials. The database URL and the decoded password are registered with `::add-mask::` before the dump starts, and the scripts never echo them.

### Why the session pooler

GitHub-hosted runners are IPv4-only. On the Free plan the direct host `db.flczjqljgntmkanipugo.supabase.co` is IPv6-only (the IPv4 add-on is a paid extra). Transaction mode, port **6543**, breaks `pg_dump`.

Use the **Session pooler** string from the Supabase dashboard: Connect → Session pooler. Shape, for this project:

```text
postgresql://postgres.flczjqljgntmkanipugo:[PASSWORD]@aws-0-us-west-2.pooler.supabase.com:5432/postgres
```

The host prefix may be `aws-0` or `aws-1`. Copy the string the dashboard shows. Do not type it from memory. Percent-encode the password (`@` becomes `%40`, and so on):

```bash
python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=""))' 'paste-the-password-here'
```

The workflow rejects port 6543 and rejects a `db.<ref>.supabase.co` / `.supabase.com` host. Set repository variable `BACKUP_ALLOW_DIRECT` to exactly `true` only if you later buy the IPv4 add-on and switch to the direct URI. Leave it unset on the Free plan.

`supabase db dump` (CLI 2.121.0) runs `pg_dump` / `pg_dumpall` from the Postgres 17 image, with `SUPABASE_DB_MAJOR_VERSION=17`. Docker on the GitHub runner is what launches that client. The script's only database commands are those three dumps.

### Why age, and where the private key lives

age public-key encryption means CI only has the **recipient** (`age1...`). The identity file (the secret key) is never a GitHub secret, never in either repo, and never on Railway. Someone who can read Actions logs, the deploy key, or the backups repo still cannot decrypt.

A symmetric passphrase (`age -p` or gpg `--symmetric`) would have to sit in a GitHub secret. Anyone who can read that secret, or a workflow that prints it, could decrypt every backup. That is the worse option, so this workflow does not use it.

Generate the key on your own machine:

```bash
age-keygen -o openpaywall-backup-identity.txt
```

The file's `# public key: age1...` line is the value for `BACKUP_AGE_RECIPIENT`. Keep `openpaywall-backup-identity.txt` in a password manager and on a second offline copy (a USB drive you control). Losing it means the backups cannot be decrypted. There is no recovery.

### Why the backups repo is an orphan branch

The ciphertext goes to branch `backups` on a **private** repo, default name `CarlosReyes0/openpaywall-backups`. Each run fetches that branch, adds the new file, deletes archives beyond the newest 8 (override with variable `BACKUP_KEEP`), and force-pushes **one** new commit that has no parent (`--force-with-lease`).

A normal commit history would keep every deleted dump forever, so the repo would grow without a bound. Git LFS has the same problem unless you run a separate LFS prune, and it adds another protocol. The orphan branch keeps the reachable tree at about eight compressed dumps.

Trade-off: there is no git history older than those eight files, and the push replaces the previous commit. `--force-with-lease` refuses to overwrite a tip this run did not just fetch. The workflow concurrency group stops two runs from publishing at once. GitHub can keep unreachable objects until its own garbage collection, so a deleted file may linger outside the branch for a while. The branch you clone stays bounded. Confidentiality is the age key, not git.

Preferred credential: an SSH **deploy key** that can write only to the backups repo. The private half is Actions secret `BACKUP_DEPLOY_KEY` on **this** repo. It cannot read this repo's secrets and it cannot decrypt dumps. A leaked deploy key could replace ciphertext; it cannot read plaintext.

Alternative: a fine-grained personal access token, secret `BACKUP_GITHUB_TOKEN`, with Contents read and write on **only** the backups repo. If both are set, the deploy key is used. Do not use a classic PAT.

## One-time setup

1. Create a **private** empty GitHub repo `CarlosReyes0/openpaywall-backups`. Do not initialize it with a license if you want the first push to be the only commit; a generated README is harmless. After the first successful run, set the repo's default branch to `backups` so the files are what you see when you open it.
2. On your machine, run `age-keygen -o openpaywall-backup-identity.txt`. Store that file in your password manager and offline. Copy only the `age1...` public key.
3. On your machine:

   ```bash
   ssh-keygen -t ed25519 -C "openpaywall-backup" -f openpaywall-backup-deploy -N ""
   ```

   In the backups repo → Settings → Deploy keys → Add deploy key, paste `openpaywall-backup-deploy.pub`, and check **Allow write access**.
4. On **this** repo (`CarlosReyes0/mon-unlock-widget`) → Settings → Secrets and variables → Actions:

   | Name | Kind | Value |
   | --- | --- | --- |
   | `SUPABASE_DB_URL` | Secret | Session pooler URI from the dashboard. Database password, percent-encoded. |
   | `BACKUP_DEPLOY_KEY` | Secret | Contents of `openpaywall-backup-deploy` (the private file, including the `BEGIN` / `END` lines). |
   | `BACKUP_AGE_RECIPIENT` | Variable | The `age1...` public key. One line. Not the identity file. |
   | `BACKUP_REPO` | Variable, optional | `owner/name`. Default `CarlosReyes0/openpaywall-backups`. |
   | `BACKUP_KEEP` | Variable, optional | How many archives to keep. Default `8`. |
   | `BACKUP_GITHUB_TOKEN` | Secret, optional | Fine-grained token if you are not using a deploy key. |
   | `BACKUP_ALLOW_DIRECT` | Variable, optional | Leave unset. |

   Repository secrets, not an environment. A scheduled job does not pick an environment unless the workflow says so, and this one does not.

5. Actions → **prod-db-backup** → **Run workflow**. A skipped run means a name from the table is still empty. A green run that says `backup published` is the first real backup. A red run did not write to production; the log's error is the thing to fix.

The database role in the URI is the `postgres.<project-ref>` session user. The CLI runs `SET ROLE postgres` for the dump, so a lesser login role will fail the role dump. The workflow's read-only guarantee is that it only invokes `supabase db dump`. `scripts/backup/roundtrip.sh` checks that `prod-backup.sh` has no `psql` and no other database subcommand.

## Run it by hand

Actions → **prod-db-backup** → **Run workflow** → branch `main` (or this branch, before merge, if you are proving the workflow file itself).

From a shell that already has the secrets, the same entrypoint is:

```bash
bash scripts/backup/prod-backup.sh
```

Do not export `BACKUP_PUSH_URL`. The prod script refuses to run when that variable is set. It exists so the local drill can push to a temp git repo.

## Restore into a throwaway Supabase project

Do this against a **new** project, never against `flczjqljgntmkanipugo`.

1. Create a throwaway Supabase project in a region you can reach. Enable any non-default extensions the dump's schema file creates (`CREATE EXTENSION`) if the restore complains one is missing. Postgres 17 matches production.
2. On your machine, with the identity file from your password manager (not from GitHub):

   ```bash
   age -d -i openpaywall-backup-identity.txt \
     -o dump.tar.gz \
     openpaywall-YYYYMMDDTHHMMSSZ.tar.gz.age
   mkdir dump && tar -xzf dump.tar.gz -C dump
   ```

   You should see `roles.sql`, `schema.sql`, `data.sql`, and `manifest.txt`. Read `manifest.txt` for the sizes recorded at dump time.
3. Confirm the files before restoring:

   ```bash
   test -s dump/roles.sql && test -s dump/schema.sql && test -s dump/data.sql
   grep -q writer_plans dump/schema.sql
   grep -q used_signatures dump/schema.sql
   grep -q writer_plans dump/data.sql
   grep -q used_signatures dump/data.sql
   ```
4. Copy the throwaway project's **Session pooler** URI (or the direct URI if that project has IPv6 or the IPv4 add-on) into `NEW_DB_URL`. This URI is for the throwaway project only.
5. Restore, in this order. `session_replication_role = replica` turns triggers off for the data load so columns are not rewritten by triggers:

   ```bash
   psql \
     --single-transaction \
     --variable ON_ERROR_STOP=1 \
     --file dump/roles.sql \
     --file dump/schema.sql \
     --command 'SET session_replication_role = replica' \
     --file dump/data.sql \
     --dbname "$NEW_DB_URL"
   ```

   `scripts/backup/restore.sh` is that same command. `psql` must be from Postgres 17 (`psql --version`).
6. If restore complains about `supabase_admin`, comment out `ALTER ... OWNER TO "supabase_admin"` lines in `schema.sql` and run the command again on a fresh throwaway project (the failed transaction rolls back when `ON_ERROR_STOP` is set). If it complains `permission denied to grant privileges as role`, delete the `GRANTED BY "..."` clause on that line in `roles.sql` and retry on a fresh project.
7. Check counts on the throwaway project:

   ```sql
   select 'articles' as t, count(*) from public.articles
   union all select 'writer_plans', count(*) from public.writer_plans
   union all select 'used_signatures', count(*) from public.used_signatures
   union all select 'unlocks', count(*) from public.unlocks;
   ```

   Compare those numbers with the same query run read-only against production (SQL editor, or `psql` with the prod session URI). They should match the moment the dump was taken. Later writes to prod will make the numbers drift.
8. Recreate Vault secrets on the throwaway project if you are testing cron. They were not in the dump. Do not copy them by reading them out of prod into a chat or a commit.
9. If you need existing Auth sessions to keep working, copy the pgsodium root key from the old project to the new one with the Management API **before** you pause or delete the old project. The key is not in the backup. Skip this for a drill you are about to delete. A new project has its own root key; restored ciphertext that depended on the old key stays unreadable until you copy it. Overwriting a project's root key makes data encrypted under a different key unreadable. The `PUT` target has to be the throwaway project ref. Never send it to `flczjqljgntmkanipugo`.

   ```bash
   curl "https://api.supabase.com/v1/projects/$OLD_PROJECT_REF/pgsodium" \
     -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
   | curl "https://api.supabase.com/v1/projects/$NEW_PROJECT_REF/pgsodium" \
     -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
     -X PUT --json @-
   ```

10. Delete the throwaway project when the drill is done. Delete `dump.tar.gz` and the SQL files from the laptop. Keep the age identity.

Custom login roles, if you add any later, are restored without passwords. Set those passwords on the new project yourself.

### Local Postgres instead of a throwaway project

The automated proof is:

```bash
sudo apt-get install -y postgresql-common ca-certificates age
sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
sudo apt-get install -y postgresql-17
bash scripts/backup/roundtrip.sh
```

That script applies `supabase/migrations` to a throwaway cluster, seeds `writer_plans` (2 rows) and `used_signatures` (3 rows), dumps with the Postgres 17 `pg_dump` / `pg_dumpall`, encrypts, decrypts, restores into a second cluster, and requires the counts to match. It unsets `SUPABASE_DB_URL` if your shell had one, and it never calls the Supabase CLI.

A production archive is not the same shape as that local dump. `supabase db dump` omits the `auth` and `storage` **schema** (the new Supabase project already has them) and includes their **data**. Restoring a production archive into an empty local Postgres fails on those tables. Use a throwaway Supabase project for a real restore. Use `roundtrip.sh` to prove the encrypt and restore path without touching production.

## Quarterly restore drill

Do this once a quarter. Write down the date.

- [ ] Actions → **prod-db-backup** → Run workflow. The run is green and the log says the sanity check passed. Open sizes only after you decrypt `manifest.txt` on your machine.
- [ ] The private backups repo's `backups` branch has the new `openpaywall-*.tar.gz.age` file, and it does not have more than `BACKUP_KEEP` (default 8) of those files.
- [ ] `SHA256SUMS` on that branch matches `sha256sum` of the file you downloaded.
- [ ] Create a throwaway Supabase project. Decrypt with the age identity from the password manager. Restore with the `psql` command above.
- [ ] Counts for `articles`, `writer_plans`, `used_signatures`, and `unlocks` match a read-only count on production.
- [ ] You did not need the age private key from GitHub, because it is not there.
- [ ] Delete the throwaway project and the decrypted SQL on disk.
- [ ] You still have the age identity in the password manager and on the offline copy.

## Local drill vs production

| | Local `roundtrip.sh` | Weekly workflow |
| --- | --- | --- |
| Database | Two local Postgres 17 clusters | Session pooler of `flczjqljgntmkanipugo`, read-only dump |
| Client | `pg_dump` / `pg_dumpall` 17 | `supabase` CLI 2.121.0, Postgres 17 image |
| Encryption | Ephemeral age key, deleted with the temp dir | Public key in `BACKUP_AGE_RECIPIENT`; private key only with you |
| Publish | Temp git repo, then deleted | Private backups repo, branch `backups` |
