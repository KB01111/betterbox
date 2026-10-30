# Implementation and verification record

October 30, 2026. Validation covers the implementation on
`codex/production-unified-gmail`. No deployment or live mail send was performed.

This is the initial implementation record. See [the PR review follow-up](pr-review-followup.md)
for subsequent fixes and the latest local verification counts.

## Delivered behavior

Unified Inbox is the default with global Gmail search, per-account filters,
chronological pagination, stable compound message identities, partial errors,
retry and bounded foreground refresh. Original split-tree Board remains available.
Unread and Starred join the existing folders. Large loaded lists are virtualized.

The mature reader/composer retain thread expansion, raw MIME, rich/plain editing,
recipients, signatures, snippets, attachments, reply/all, forwarding, drafts and
organization. Draft saves are serialized and account-pinned. Attachments/Bcc and
reply metadata survive draft editing. Failed saves preserve the composer;
disconnecting a sender cannot silently choose another account.

Google sign-in/linking requests the official account chooser, offline consent,
state and PKCE. Exact allowlists apply to new/returning users and linked identities.
Credentials remain encrypted server-side. Optional Gmail signature permissions
are incremental; optional GitHub credentials are not required for Gmail.

## Architecture and dependencies

Cloudflare Vite + the official TanStack Start entry replace Nitro. Authenticated
application routes render on the client; APIs/auth execute in Workers. Request-local
bindings and Prisma use D1/SQLite with Better Auth transactions disabled. D1 stores
auth, verified account metadata and approved user-created snippets/signatures;
mailbox content stays live and in memory. Versioned SQLite migrations and a
non-destructive PostgreSQL conversion/import path preserve existing data.

Added Cloudflare Vite, Wrangler, Workers types and Prisma D1 adapter. Removed the
PostgreSQL adapter, Nitro and Vercel analytics/speed SDKs. Removed the installed
shadcn CLI dependency while preserving its stock CSS locally with the MIT license;
`bunx shadcn@latest` still adds primitives. Updated compatible Start/Router/Query,
Better Auth, Prisma, Vite, React, Tiptap/Base UI and sanitizer dependencies, with
targeted transitive security fixes in the lockfile. Key pinned versions: Prisma
7.10.1, Better Auth 1.7.14, Vite 8.3.5, Wrangler 4.156.0. See package.json/bun.lock
for every exact resolved dependency.

## Review follow-up

An independent source review identified five defects, all corrected:

1. Pending draft opens reserve the composer and cannot populate another user's
   session after a late response. Forward preparation also checks reader lifetime.
2. Gmail's unpadded embedded attachment bytes normalize to valid outgoing base64.
3. Failed profile/count refreshes preserve the verified sender identity.
4. Embedded CID images render raster bytes without requesting an empty attachment ID.
5. CSS image URLs/imports use corrected expressions and follow image consent/CSP.

Focused regressions cover these behaviors. Pure tests do not replace browser or
live-provider acceptance.

## Verification

Final command results are recorded below after the final build. Runtime tests use
an isolated real workerd/D1 environment with fake credentials, not live Gmail.

| Check                                                  | Result                                                       |
| ------------------------------------------------------ | ------------------------------------------------------------ |
| Frozen lockfile install and Prisma generation          | PASS; no dependency changes                                  |
| Strict type checking, including maintenance/QA scripts | PASS                                                         |
| Biome lint                                             | PASS; 223 files                                              |
| Bun unit/Gmail mock/security suite                     | PASS; 140 tests, 384 assertions, 25 files                    |
| Cloudflare client and Worker build                     | PASS                                                         |
| workerd/D1 integration suite                           | PASS; 14 checks                                              |
| Wrangler deployment dry run                            | PASS; 2476.24 KiB compressed Worker upload                   |
| Local D1 migration                                     | Passed; schema also created in each isolated runtime test    |
| Dependency audit                                       | Passed: no reported vulnerabilities                          |
| Whitespace/diff check                                  | PASS                                                         |
| Hosted CI                                              | Configured; consult the PR checks for current hosted results |

Client bundle inspection found no Prisma/database or Node crypto implementation.
The Better Auth browser SDK contains an environment-variable name; the sign-in
setup instructions contain a Google secret variable label. These labels are not
credential values. Runtime test secrets are synthetic, server-only fixtures.

The runtime suite verifies anonymous denial, actual Prisma/D1 session reads,
three user-scoped linked identities, cross-user rejection before token access,
removed allowlist session denial, disabled token HTTP endpoints, mutation CSRF,
user-scoped snippet writes, OAuth initiation/linking, canonical callback,
state/PKCE/offline account chooser, denial callback handling, private headers,
HTML CSP and static assets.

Earlier synthetic desktop browser checks confirmed the combined chronological
list, account badges, cross-account `invoice` search/highlighting and opening a
reader. No console warnings/errors were recorded at that point. Browser access
then became disabled in Work settings. Loaded-reader interactions, the revised
composer, mobile/light theme and keyboard/focus flows remain unverified in a
browser. No screenshot of the final revision was captured.

## Deployment and exact remaining setup

No Cloudflare login, production D1 identity or usable Google client was available.
There is no deployed URL to report. Follow [deployment.md](deployment.md) in order:

1. Authenticate Wrangler; create D1 `betterbox`, put its returned `database_id`
   into `wrangler.jsonc`. For existing installations follow
   [postgresql-migration.md](postgresql-migration.md) before importing anything.
2. Apply remote D1 migrations and deploy to obtain the real workers.dev hostname.
3. Enable Gmail API in Google Cloud; configure the private testing audience and
   every intended primary/linked Gmail address as a test user. Create a Web OAuth
   client with that exact origin and `/api/auth/callback/google` redirect.
4. Set Cloudflare secrets `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`,
   `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ALLOWED_EMAILS`. Keep the original
   encryption secret when transferring existing data. `IS_SELF_HOSTED=true` and
   `DB` are already configured as bindings/vars.
5. Deploy with those settings; sign in and link second/third Gmail accounts in
   Chrome. Test reconnect/deduplication, expiration/revocation and real mail actions
   against designated test messages. Complete mobile, theme and keyboard checks.
6. Inspect deployed CPU/memory/subrequests on normal and worst expected inputs.
   Accept the Free plan only after the 10 ms CPU gate is measured. Configure the
   optional GitHub/remote-image settings only when needed. Manual Actions deploy
   also needs Cloudflare account/API-token secrets in the production environment.

## Known limits and Definition of Done

Pass locally: build, D1 auth compatibility, security tests, type/lint/unit/runtime
checks, deployment configuration/docs, no hardcoded credentials, unified/search
logic and paging, retained board, explicit remaining setup and visible Soon controls.
Mail behavior is covered by mocks; this is not proof of live mail delivery.

Still external: deployed Worker acceptance; genuine Google primary/second/third
account consent; refreshed/revoked grants across sessions; live read/send/reply/
forward/draft/attachment actions; desktop/mobile interaction acceptance; deployed
CPU/memory/latency. Full mission Definition of Done is therefore **not yet met**.

No paid infrastructure is introduced. Private use must remain within Cloudflare
and Google quotas. Google's testing token expiry and public restricted-scope
verification remain provider requirements. Remote images are blocked until
message consent and exact administrator-trusted host configuration. Composer
sender locks after its first autosave. Large attachment memory use and long
threads require deployed resource testing. Client chunks over 500 kB and a CSS
sourcemap warning remain build warnings, not hidden test failures. There is no
background mailbox push service; foreground refresh polls every minute.

An earlier verbose Vite diagnostic printed inherited process environment values,
including credentials, in local tool output. Verbose diagnostics were stopped;
those values were not added to tracked files or application responses. Treat that
saved diagnostic output as sensitive and rotate any affected credentials.

| Mission Definition of Done                            | Evidence/status                                                          |
| ----------------------------------------------------- | ------------------------------------------------------------------------ |
| Application builds                                    | PASS                                                                     |
| Workers production deployment configured and verified | Configuration/dry-run/local runtime PASS; hosted pending                 |
| D1 authentication database works                      | PASS in actual local workerd/D1                                          |
| Google login with real configured client              | Pending live consent                                                     |
| Multiple Gmail accounts connect                       | Linking initiation and three-record isolation PASS; live linking pending |
| Browser account chooser                               | Generated Google authorization URL PASS; live browser consent pending    |
| Accounts persist across sessions/token rules          | D1 sessions PASS; live Google refresh/revocation pending                 |
| One unified chronological inbox                       | Mock merge tests and synthetic desktop list PASS                         |
| Global search selected accounts                       | Mock API and synthetic desktop search PASS; live Gmail pending           |
| Inbox/search pagination                               | Mock three-account/frontier/cursor tests PASS                            |
| Full real mail functionality                          | Mock/API tests PASS; designated live-message acceptance pending          |
| Original Board accessible                             | Source/UI switch retained; final interaction check pending               |
| Desktop/mobile UI                                     | Desktop list/search observed; mobile/full interaction checks pending     |
| No paid hosting dependency                            | PASS configuration; deployed quota acceptance pending                    |
| Security tests pass                                   | PASS                                                                     |
| Type/lint/unit/build pass                             | PASS                                                                     |
| Deployment instructions complete                      | PASS                                                                     |
| No hardcoded deployment credentials                   | PASS; tests contain clearly synthetic fixture values                     |
| Incomplete features marked visibly                    | Soon affordances retained; external verification limits explicit         |
| External configuration documented                     | PASS                                                                     |

## Changed files

The inventory below includes modified, new and removed tracked paths relative to
the repository root. Generated Prisma/build output is ignored.

```text
.env.example
.github/CONTRIBUTING.md
.github/workflows/deploy.yml
.github/workflows/quality.yml
.gitignore
AGENTS.md
bun.lock
docs/deployment.md
docs/implementation.md
docs/licenses/shadcn.md
docs/postgresql-migration.md
docs/verification.md
migrations/0001_initial.sql
package.json
prisma.config.ts
prisma.waitlist.config.ts
prisma/schema.prisma
prisma/waitlist.prisma
README.md
scripts/convert-postgresql.test.ts
scripts/convert-postgresql.ts
scripts/d1.ts
scripts/encrypt-oauth-tokens.ts
scripts/export-postgresql.sql
scripts/preview-fixture.ts
scripts/set-owner.ts
scripts/test-runtime.ts
src/components/editor/composer.tsx
src/components/editor/composer-attachments.ts
src/components/mail/html-body.tsx
src/components/mail/labeled-view.tsx
src/components/mail/pane-chrome.tsx
src/components/mail/panes/reader-message.tsx
src/components/mail/panes/reader-pane.tsx
src/components/mail/tag-picker.tsx
src/components/mail/thread-list-states.tsx
src/components/mail/thread-row.tsx
src/components/mail/unified-mailbox.tsx
src/components/settings/pages/accounts.tsx
src/components/settings/pages/keyboard.tsx
src/components/shell/app-sidebar.tsx
src/components/shell/command-menu.tsx
src/hooks/settings-mutations.test.ts
src/hooks/use-account-scope.ts
src/hooks/use-settings.ts
src/hooks/use-signatures.ts
src/hooks/use-snippets.ts
src/hooks/use-unified-mail.ts
src/lib/account.ts
src/lib/api-error.ts
src/lib/auth/auth.ts
src/lib/auth/auth-client.ts
src/lib/auth/auth-errors.test.ts
src/lib/auth/auth-errors.ts
src/lib/auth/auth-factory.ts
src/lib/auth/auth-policy.test.ts
src/lib/auth/auth-session.ts
src/lib/composer-open.ts
src/lib/db/prisma.server.ts
src/lib/db/waitlist-prisma.server.ts
src/lib/draft-attachments.test.ts
src/lib/draft-save.test.ts
src/lib/draft-save.ts
src/lib/email/html-security.test.ts
src/lib/email/html-security.ts
src/lib/email/reply.test.ts
src/lib/email/reply.ts
src/lib/env.ts
src/lib/folders.test.ts
src/lib/folders.ts
src/lib/github/github.server.ts
src/lib/gmail/accounts.server.ts
src/lib/gmail/api.server.test.ts
src/lib/gmail/api.server.ts
src/lib/json-response.test.ts
src/lib/json-response.ts
src/lib/mail-queries.test.ts
src/lib/mail-queries.ts
src/lib/request-security.test.ts
src/lib/request-security.ts
src/lib/runtime.server.ts
src/lib/runtime-config.test.ts
src/lib/runtime-config.ts
src/lib/test-account.ts
src/lib/unified-mail.test.ts
src/lib/unified-mail.ts
src/routes/__root.tsx
src/routes/_app.tsx
src/routes/_app/starred.tsx
src/routes/_app/unread.tsx
src/routes/api/accounts.ts
src/routes/api/contacts.ts
src/routes/api/draft.ts
src/routes/api/emails.ts
src/routes/api/gmail-signature.ts
src/routes/api/image-proxy.ts
src/routes/api/labels.ts
src/routes/api/message.ts
src/routes/api/send.ts
src/routes/api/signatures.ts
src/routes/api/snippets.ts
src/routes/api/waitlist.ts
src/routes/privacy.tsx
src/routes/sign-in.tsx
src/routeTree.gen.ts
src/shadcn.css
src/start.ts
src/styles.css
src/worker.ts
tsconfig.json
vite.config.ts
wrangler.jsonc
```
