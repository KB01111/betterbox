# KB OneMail

A private unified Gmail web application, hosted on Cloudflare Workers and D1.
Use a normal HTTPS URL in Chrome or another browser; no desktop installation,
Docker, paid database or always-running server is required for hosted use.

The Windows Tauri v2 client uses this same hosted backend. Its installer is
published on [our fork's Releases page](https://github.com/KB01111/kb-onemail/releases).
Google authorization opens in your system browser. Compare the displayed code
before approving the desktop connection; return to the app when approved.
Mail still requires a network connection and is not stored in the desktop profile.
Windows notifications can include sender and subject in Windows notification
history; disable previews or notifications in Desktop settings for private alerts.
See [the desktop design](docs/tauri-desktop-design.md) for the security boundary.

This is the [KB01111/kb-onemail](https://github.com/KB01111/kb-onemail) fork of
[Aidan McAlister's BetterBox](https://github.com/aidankmcalister/betterbox), under
the existing MIT license.

## Mail workspace

- Unified chronological mail and cross-account Gmail search, with independent
  page cursors, account filters, partial failures and compound message identity.
- Existing draggable split-tree board, account colors and saved layouts.
- Inbox, Unread, Starred, Sent, Drafts, Archive, Spam, Trash and labels.
- Full thread reader, safe HTML/plain text, raw MIME, downloadable attachments
  and remote images blocked by default.
- Rich composer, To/Cc/Bcc, sender selection, replies/forwarding, snippets,
  signatures and Gmail drafts. Send uses the selected account's saved draft.
- Google account chooser and explicit account linking; exact-address access
  list (or explicit `*@gmail.com` admission) applies to signup, sign-in,
  existing sessions and linked Gmail identities.
- Light/dark themes, responsive reading pane, command palette and keyboard use.
- Optional GitHub panels. Linear/webhooks/developer API remain visibly **Soon**.

Messages and attachments stay in Google and pass through the Worker on demand.
They are held in browser memory, never saved in D1 or a service-worker cache.
The approved Windows notification-history exception contains only sender and
subject; the app adds no local mailbox, body, attachment, or draft persistence.
D1 stores authentication, encrypted credentials, account metadata and existing
user-created snippets/signatures. There are no analytics SDKs in this fork.

## Local development

Requires Bun 1.3.14 and Node 24 (Wrangler's runtime test harness needs Node).

```sh
bun install --frozen-lockfile
cp .env.example .dev.vars
bun run db:migrate:local
bun run dev
```

On Windows use `Copy-Item .env.example .dev.vars`. Configure the values in that
file, including **every** permitted primary and additional Gmail address in
`ALLOWED_EMAILS`. Register `http://localhost:3000/api/auth/callback/google` as a
Google Web client redirect. Local Vite runs server routes in workerd with local
D1; it does not need PostgreSQL. Restart Vite after dependency changes.

## Deploy for $0/month modest private use

Follow [the complete Cloudflare/Google setup guide](docs/deployment.md), including
free-tier quotas, private OAuth testing conditions, secrets and troubleshooting.

```sh
bunx wrangler login
bunx wrangler d1 create betterbox
# Put the returned real database_id in wrangler.jsonc.
bun run db:migrate:remote
bun run deploy
# Configure Google and Cloudflare secrets using the actual workers.dev hostname.
```

The production callback is
`https://YOUR-WORKER.workers.dev/api/auth/callback/google`. No custom domain is
required. An instance with missing secrets/access list cannot admit users.
Cloudflare does not impose an application-level linked-account cap; Google
consent, test-user and token quotas still apply. Unrestricted public distribution
requires a separate review of Google's restricted-scope verification requirements.

## Commands

| Command | Purpose |
| --- | --- |
| `bun run dev` | Vite + local Worker/D1 on port 3000 |
| `bun run typecheck` | Strict TypeScript |
| `bun run lint` | Biome |
| `bun test` | Unit, Gmail mocks and security regression tests |
| `bun run build` | Cloudflare production client and Worker |
| `bun run cf:preview` | Built Worker preview on port 8787 |
| `bun run test:runtime` | Isolated real workerd/D1 auth and route checks after build |
| `bun run db:generate` | Generate Prisma 7 Cloudflare client |
| `bun run db:migrate:local` | Apply versioned migrations to local D1 |
| `bun run db:migrate:remote` | Apply migrations to the configured remote D1 |
| `bun run deploy` | Build and deploy using Wrangler |
| `bun run set-owner EMAIL [--remote]` | Sanctioned owner-role grant |
| `bun run encrypt-tokens [--remote]` | Backfill using the existing `BETTER_AUTH_SECRET` |

The maintenance commands default to **local** D1; `--remote` is explicit. Before
migrating an existing PostgreSQL deployment read [the non-destructive transfer
guide](docs/postgresql-migration.md). Do not run SQLite migrations on PostgreSQL
or discard the old database. Keep the existing encryption secret during transfer.

## Verification boundary

Local workerd/D1 and mocked Gmail checks do not prove live Google consent,
revocation, real mail delivery, deployed CPU limits or hosted latency. See
[the implementation/verification record](docs/verification.md) for this change.
Production acceptance needs the owner's Cloudflare account, real Google client
and permitted test accounts. No credentials are bundled in the client.
