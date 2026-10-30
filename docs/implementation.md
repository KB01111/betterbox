# KB OneMail production implementation checklist

The supplied mission is the approved scope. Preserve React 19, TanStack Start,
Query, Base UI/shadcn, theme tokens, account colors, and the custom split tree.
The review branch and PR are authorized for publication to the user's fork.
Deployment remains a separate acceptance step. No mailbox content is stored in
D1. Snippets and signatures retain their existing user-scoped storage.

## Audit

Existing: Google/Better Auth linking and encrypted credentials, Gmail reading,
thread expansion, raw MIME, attachments, rich composer, real send/draft APIs,
labels, account scope/colors, themes, keyboard palette, optional GitHub board.

Gaps: no chronological unified list; search drops page tokens; metadata lacks
internal timestamps; requests fan out beyond free Worker limits; Postgres/Nitro
runtime; allowlist only checks signup; private responses have cache gaps; unsafe
inline SVG and image proxy; draft sender/save races and attachment/Bcc loss;
missing hosted automation and runtime integration coverage. Local dependencies
were absent; after installation the baseline has 81 passing tests and clean lint.

## Implementation

- [x] Cloudflare Vite plugin and official Start entry; client-render authenticated
      app routes; D1/Prisma 7 SQLite with explicit transaction-free Better Auth adapter.
- [x] Validated binding configuration, deny-by-default allowlist, sign-in/linking
      and returning-session gates, explicit account ownership before token access.
- [x] Unified view default, board switch, selected accounts, debounced global
      search, independent page cursors, safe chronological frontier and partial errors.
- [x] Bounded Gmail pages, internal timestamps, search pagination, unread/starred
      folders, resilient retries, cancellation and foreground synchronization.
- [x] Private no-store responses, CSRF/content checks, CSP, native rate limit
      binding, safe attachments and image handling, payload validation.
- [x] Preserve mature composer/reader; fix sender ownership and draft races,
      attachment/Bcc persistence, reply identity and resumable drafts.
- [x] D1 migrations, local and remote maintenance commands, nondestructive
      PostgreSQL transfer guide, GitHub Actions and exact deployment documentation.
- [x] Focused unit/API mocks, local workerd/D1 integration and build checks.
- [ ] Complete remaining desktop/mobile browser checks and live provider/hosted
      acceptance. Browser use became disabled during local QA; no live credentials
      were available. See [the final verification record](verification.md).

## Design decisions

Fetch one bounded Gmail page per account through separate API requests, with
client concurrency limited to three. Merge on Gmail internalDate and compound
account/message identity. Only publish rows above every account's loaded frontier;
fetch additional pages before revealing older rows. Failed accounts show explicit
partial results and can retry without discarding successful mail.

Keep the existing ReaderPane and controlled Composer. Unified view provides their
existing contexts and a resizable list/reader pair; board layout persistence stays
separate. Gmail labels and mailbox bodies remain live remote data in memory only.

Use official Cloudflare Workers integration and D1. Disable interactive Prisma
transactions; use database uniqueness and bounded operations. Private deployments
require an explicit allowed-email list. Google mailbox identity is its stable sub.
Native Workers rate limiting avoids an extra paid service. No background mailbox
watch is required for foreground refresh. No service worker caches private data.

## Verification and external gates

Run `bun run typecheck`, `bun run lint`, `bun test`, `bun run build`, local D1
migrations and workerd smoke/integration tests. Use Gmail mocks where credentials
are absent. Never claim live Google OAuth, delivered mail, deployed latency or
Cloudflare production acceptance from mocks/local runtime evidence. Deployment
requires real Cloudflare database identity/secrets and a configured Google client.
