# Non-destructive PostgreSQL → D1 transfer

No production database/credentials were present during this implementation. The
old database is never opened or erased automatically. The previous PostgreSQL
migration history remains in `prisma/migrations` as historical evidence; Wrangler
only applies the new SQLite files in `migrations/`.

1. Back up the existing PostgreSQL database with `pg_dump` and protect the output
   like credentials. Keep the existing `BETTER_AUTH_SECRET` in your secret manager.
2. Schedule a maintenance window; stop old-instance writes. Retain the old app and
   database for rollback. Do not point the old app at D1.
3. Export user, session, account, verification, snippet and signature tables using
   the read-only [export query](../scripts/export-postgresql.sql). Example using
   existing PostgreSQL tooling:

   ```sh
   psql --dbname YOUR_EXISTING_CONNECTION --no-psqlrc --quiet --tuples-only --no-align --file scripts/export-postgresql.sql --output transfer.local.json
   ```

   Prefer a service/password file over credentials in shell history. The JSON
   contains credentials and user-authored text. Keep it outside shared folders,
   logs, source control and CI artifacts. `.local.json` and `.local.sql` transfer
   files are ignored in this repository.
4. Run the converter with the **original** `BETTER_AUTH_SECRET` available only in
   the process environment:

   ```sh
   bun scripts/convert-postgresql.ts transfer.local.json transfer.local.sql
   ```

   It validates tables/columns, converts dates to the adapter's millisecond
   representation, preserves IDs/relations/roles/snippets/signatures, rejects
   duplicate provider subjects, encrypts plaintext access/refresh tokens, rejects
   undecryptable ciphertext and discards ID tokens. It writes INSERT statements
   for an empty destination; it never truncates or deletes existing data.
5. Create a **new empty D1 database**, record its returned ID in `wrangler.jsonc`,
   and apply `bun run db:migrate:remote`. Import only into this new database:

   ```sh
   bunx wrangler d1 execute DB --remote --file transfer.local.sql
   ```

   Test this first with local D1. INSERT conflicts abort rather than replace data.
   D1 import has statement/request size limits; for a large auth database split
   INSERT files in table order, then verify every table count and foreign key
   check. Do not put the whole transfer inside BEGIN/COMMIT: D1 does not support
   Prisma interactive transactions.
6. Compare source/destination row counts for all six tables and run
   `PRAGMA foreign_key_check;` using `wrangler d1 execute`. Inspect account
   provider-subject uniqueness and signature assignments. Verify a representative
   encrypted token decrypts with the retained secret without printing it. Owner
   roles must match the approved source, never inferred from email order.
7. Configure new HTTPS origin, Google redirect and explicit allowed addresses.
   Test primary/additional accounts, snippets and signatures before cutover.
   Cookies are hostname-bound; users may need to sign in again on workers.dev even
   though session records were preserved. Reconnect legacy accounts to populate
   verified account email metadata; imported rows validate live Google identity.
8. Switch users to the new URL only after verification. Keep the old database and
   backup unchanged until rollback retention expires. A failed migration means
   restore the old app URL/configuration, not delete the source. Remove protected
   transfer files according to your organization's retention policy after success.

Schema adaptation is deliberately separate from live data transfer. A successful
local empty-D1 migration is not evidence that an unknown production dataset has
been migrated.
