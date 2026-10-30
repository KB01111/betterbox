# Deploy a private BetterBox on Cloudflare

Use the Workers **Free** plan and D1. No paid plan, custom domain, VM, Redis,
container, AI API or commercial monitoring service is needed. These instructions
create your own instance; the repository does not contain deployment credentials.

## 1. Cloudflare account and database

1. Create a free account at [Cloudflare](https://dash.cloudflare.com/sign-up).
2. Install Bun 1.3.14 and Node 24, clone this fork, run
   `bun install --frozen-lockfile`.
3. Authenticate with `bunx wrangler login`; inspect with `bunx wrangler whoami`.
4. Run `bunx wrangler d1 create betterbox`. Copy the **returned** `database_id`
   into the DB entry in `wrangler.jsonc`. Keep its `binding` as `DB` and
   `migrations_dir` as `migrations`. Do not invent an identifier. The omitted ID
   permits local D1 testing; always set the real ID before production migrations.
5. For an existing installation, stop here and use the
   [PostgreSQL transfer guide](postgresql-migration.md) first.
6. Apply the schema with `bun run db:migrate:remote`.
7. Run `bun run build`, `bun run test:runtime`, then `bunx wrangler deploy`.
   Keep the URL Wrangler prints, for example the pattern
   `https://betterbox.YOUR-SUBDOMAIN.workers.dev`. This initial deployment has no
   credentials and cannot admit users; its sign-in page explains missing setup.

Wrangler may offer to create a workers.dev subdomain during initial setup. It is
free; buying a domain is unnecessary. Do not use a temporary preview account as
your production deployment.

## 2. Google Cloud project and official OAuth

1. Create/select a project in [Google Cloud Console](https://console.cloud.google.com).
2. Enable the **Gmail API** in APIs & Services → Library.
3. Configure Google Auth Platform branding, contact details and audience. For
   private testing use External → Testing and explicitly register all primary
   and additional Gmail addresses as test users. Workspace internal access is
   a different policy choice controlled by the organization administrator.
4. Declare identity scopes (`openid`, email, profile) and
   `https://www.googleapis.com/auth/gmail.modify`. This grants read/search,
   compose/send/drafts and message organization, without permanent deletion.
   Requesting separate readonly/send grants adds no capability here.
5. Native Gmail signature import is optional and requests
   `https://www.googleapis.com/auth/gmail.settings.basic` incrementally. Add it
   to your consent configuration if that feature will be used.
6. Create an OAuth client of type **Web application**. Set JavaScript origin
   to the actual HTTPS origin. Set the authorized redirect URI to exactly:

   ```text
   https://YOUR-WORKER.workers.dev/api/auth/callback/google
   ```

   Replace the entire hostname with the URL from Wrangler. For local Vite add
   `http://localhost:3000/api/auth/callback/google`; for built preview use
   `http://localhost:8787/api/auth/callback/google`. Register each exact redirect
   you use; changing ports, protocol or hostname changes the URI.

7. Keep the client secret on the server. No Chrome cookies, profiles or Google
   session credentials are read. Google's browser chooser displays signed-in
   accounts when available; the app requests `select_account consent`, state,
   PKCE and offline access.

Testing is limited to 100 registered users; Gmail test grants/refresh tokens
normally expire after seven days. Reconnect when Google expires or revokes a
grant. Google also limits live refresh tokens per account/client. There is no
BetterBox account-count cap, but these provider limits still apply.
See [audience/testing rules](https://support.google.com/cloud/answer/15549945)
and [Google OAuth token rules](https://developers.google.com/identity/protocols/oauth2).

Before distributing beyond eligible private/testing/internal use, review
[restricted-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification).
Gmail data passing through a third-party server can require verification and an
annual third-party security assessment. Avoiding permanent mailbox storage does
not waive those rules. This project makes no fixed assessment-price claim and
does not guarantee unrestricted public distribution for $0.

## 3. Cloudflare secrets

Generate a random secret, for example:

```sh
bun -e 'console.log(require("node:crypto").randomBytes(48).toString("base64url"))'
```

For a database transfer use the **existing** secret instead. Changing it makes
stored credentials unreadable. Enter each value using Wrangler's hidden prompt:

```sh
bunx wrangler secret put BETTER_AUTH_SECRET
bunx wrangler secret put BETTER_AUTH_URL
bunx wrangler secret put GOOGLE_CLIENT_ID
bunx wrangler secret put GOOGLE_CLIENT_SECRET
bunx wrangler secret put ALLOWED_EMAILS
```

`BETTER_AUTH_URL` is the actual HTTPS origin, without path/query. `ALLOWED_EMAILS`
is a comma-separated list of exact addresses for **every** application user and
linked Gmail identity. Empty/invalid lists deny access. Existing sessions and
returning logins are rechecked; removing a primary address revokes app access.
Removing a linked address blocks token access to that mailbox. There are no
wildcard/domain shortcuts.

`bun run encrypt-tokens` loads the local `.dev.vars` file. For a remote backfill,
explicitly provide the original production `BETTER_AUTH_SECRET` in the process
environment; it takes precedence over the local value. Never use a new/local key
to rewrite existing production credentials.

`IS_SELF_HOSTED=true` is set in Wrangler vars. This private fork always takes
unauthenticated users to sign-in. The legacy marketing waitlist does not collect
data. `DB` is a binding, never `DATABASE_URL`.

Optional paired GitHub credentials use `wrangler secret put GITHUB_CLIENT_ID`
and `GITHUB_CLIENT_SECRET`. Absent keys leave Gmail functional. GitHub's callback
uses `/api/auth/callback/github`; GitHub grants are separate from Gmail consent.

Remote email images are blocked by default. If needed, set `IMAGE_PROXY_HOSTS`
with exact, administrator-trusted DNS hostnames. The proxy permits HTTPS/443,
rechecks redirect targets, rejects literal IPs and active image formats, and has
size/time limits. Trusting an arbitrary sender-controlled hostname is unsafe;
the allowlist is not a claim of IP-pinned arbitrary-host SSRF protection.

Run `bunx wrangler deploy` after configuration changes. `wrangler secret put`
updates the deployed secret; redeploying does not put it into browser assets.

## 4. First account, additional accounts and owner tools

Open the HTTPS URL in Chrome. Continue with Google, select an allowed account,
and review/approve the requested Gmail permissions. All Inboxes is the default.
Use **Add Gmail account** for second/third accounts; choose a different account
in Google's chooser. They link to the current BetterBox user using Google's
stable subject identity. Reconnecting an identity updates it rather than adding
a duplicate. An identity already owned by a different BetterBox user cannot be
silently transferred.

Use account filters to select one, several or all; Board restores the original
split-tree workspace. Settings → Accounts controls colors, sending defaults,
reconnect/disconnect and optional signature permissions. Better Auth prevents
unlinking the final sign-in method. Revoking Google permission and disconnecting
from BetterBox are separate actions.

To enable owner-only demo/test tools after your first successful sign-in:

```sh
bun run set-owner you@example.com --remote
```

This is the sanctioned role grant. Demo mail is synthetic and separate from
real mailbox data. Never count a simulated send as delivered mail.

## 5. Development, preview, updates and CI

Copy `.env.example` to `.dev.vars`, configure local Google credentials/origin,
then `bun run db:migrate:local` and `bun run dev`. Both Vite and built preview use
workerd and local D1. Apply local migrations before expecting sessions to work.
For built preview: `bun run build`, then `bun run cf:preview`. Stop preview before
rebuilding on Windows: running workerd can lock files in `dist/server`.

For updates run typecheck, lint, tests, build and runtime tests. Record a D1
recovery bookmark (`bunx wrangler d1 time-travel info DB --json`) and keep a
protected backup as appropriate, apply remote migrations, then deploy. Review
schema/data migrations before applying; the initial D1 migration only creates
tables and does not delete PostgreSQL data.

`.github/workflows/quality.yml` runs checks on pushes/PRs. The deployment workflow
is **manual** (`workflow_dispatch`) and uses GitHub's `production` environment.
Set its `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets; scope the token
to Workers deployment and D1 access for your account. Commit the real nonsecret
D1 binding ID when you are ready. Configure OAuth/app secrets directly in
Cloudflare first; Actions does not need or print those values. The workflow
records a recovery bookmark without uploading the auth database to an artifact.

Runtime tests use Node because Wrangler's current test harness explicitly does
not support dispatching Worker fetches under Bun. Bun remains the package manager
and native unit runner. The runtime harness uses isolated fixture D1 and fake
credentials, never your real Google account.

## Free-tier budget and limits

Checked against [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
and [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) on
October 29, 2026. Workers Free: 100,000 requests/day, 10 ms CPU per invocation,
128 MB memory, 50 external subrequests and six simultaneous outgoing connections.
D1 Free: 5 million rows read/day, 100,000 rows written/day and 5 GB total storage;
individual Free databases have a smaller [size limit](https://developers.cloudflare.com/d1/platform/limits/).
Free quota exhaustion fails requests; it does not make this application require
an automatic paid upgrade. Do not enable a paid plan merely to finish setup.

This app uses ten metadata messages/page, three concurrent account calls, three
concurrent metadata requests/account, up to three safe-read attempts and a total
40-Gmail-fetch request budget, leaving headroom for token refresh. Requests that
mutate or send mail are not retried automatically. Mark-account-read processes a
bounded batch rather than unbounded work. The shared Worker rate limiter is
approximate and local to Cloudflare locations, not an exact global billing cap.
Polling pauses in hidden tabs. No cron/PubSub/queue infrastructure is required.

Local workerd wall-time measurements cannot establish production CPU consumption.
After configuring real accounts, inspect Cloudflare's deployed CPU metrics under
representative load, including first requests, thread sizes, uploads and token
refresh. The 10 ms Free CPU budget is an acceptance gate; no paid fallback is
silently enabled. Gmail and Google Cloud quotas are separate. Enabling Gmail API
and OAuth for this private setup requires no paid Google backend service; avoid
unneeded Pub/Sub, assessment or other billable services.

## Troubleshooting

| Symptom                                                    | Action                                                                                                                      |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Setup incomplete / Continue unavailable                    | Set all required values, minimum 32-character secret, nonempty exact access list and DB binding.                            |
| `redirect_uri_mismatch`                                    | Copy exact deployed origin plus `/api/auth/callback/google` into the Web client's authorized redirects.                     |
| `access_denied`                                            | Confirm the address is a Google test user and is in ALLOWED_EMAILS; review requested consent and Workspace admin policy.    |
| `email_not_allowed`                                        | Add that primary/linked address to ALLOWED_EMAILS, then restart the OAuth flow.                                             |
| `invalid_grant`, revoked permission, missing refresh token | Reconnect from the browser chooser and grant offline consent. Test grants normally expire in seven days.                    |
| Account already linked to another user                     | Sign in to that BetterBox user, disconnect there, then add it to the intended user. Never edit ownership to bypass consent. |
| One account unavailable                                    | Other mail remains visible. Retry that account; for permissions/refresh errors reconnect.                                   |
| No native Gmail signature                                  | Import requires incremental settings permission; local BetterBox signatures still work.                                     |
| Remote images absent                                       | Default privacy policy. Opt in per message; administrator must also trust the exact host.                                   |
| D1 table missing                                           | Apply local or remote migrations to the same binding used by the running environment.                                       |
| Wrong encryption key                                       | Restore the original BETTER_AUTH_SECRET; never run a backfill to overwrite undecryptable ciphertext.                        |
| Preview build EPERM on Windows                             | Stop the preview started for this repository before rebuilding.                                                             |
| 429 or free quota failure                                  | Wait/back off, inspect Gmail/Cloudflare usage. Do not run mailbox-wide fetches or remove budgets.                           |

Hosted OAuth callbacks, delivered mail, refresh/revocation behavior and production
CPU remain external checks until the deployment has real credentials and consent.
