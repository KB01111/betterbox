# PR #1 review follow-up

Reviewed all eight inline threads, all review bodies and top-level comments
against `651186a24ec18b0bea7cac39f4c7fd9444bcdc71`. No discussion pages were
omitted; the fetched GraphQL connections reported no additional pages.

## Findings

| Review comment                                                                              | Assessment and change                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Last Google account](https://github.com/KB01111/kb-onemail/pull/1#discussion_r4419235164)   | Fixed: dummy accounts do not count as Google sign-in identities. A regression covers one real account plus dummy accounts and multiple real accounts.                                                                                                                                                                                                                               |
| [Backfill environment](https://github.com/KB01111/kb-onemail/pull/1#discussion_r4419235170)  | Fixed: the package command loads `.dev.vars`. A native Bun check verified that an explicitly supplied production secret takes precedence; a missing local file does not block an exported secret. No secrets were printed.                                                                                                                                                          |
| [Demo labels](https://github.com/KB01111/kb-onemail/pull/1#discussion_r4419235175)           | Fixed in the backing store: per-account in-memory label metadata retains creation, rename and deletion across query refetches. Other accounts remain unchanged; tests forbid real Gmail fetches.                                                                                                                                                                                    |
| [Attachment preview](https://github.com/KB01111/kb-onemail/pull/1#discussion_r4419235182)    | Fixed: `view=1` permits PDF/plain text as well as raster images. Download wins over preview; HTML/SVG remain downloads. Native PDF viewers are not disabled by a CSP sandbox; scriptless CSP remains on other attachment types. Browser rendering remains an acceptance check.                                                                                                      |
| [Migration timestamps](https://github.com/KB01111/kb-onemail/pull/1#discussion_r4419235190)  | Fixed: timezone-less PostgreSQL timestamps are interpreted as UTC, including session expiration. Regression runs the converter with `TZ=America/Los_Angeles`. Explicit timezones and numeric milliseconds remain supported.                                                                                                                                                         |
| [Owner grant](https://github.com/KB01111/kb-onemail/pull/1#discussion_r4419235194)           | Fixed: select and validate a unique identity before granting by its exact ID. The update also rechecks email uniqueness atomically. Real SQLite regression verifies ambiguous/absent matches leave every role unchanged.                                                                                                                                                            |
| [Reply draft threading](https://github.com/KB01111/kb-onemail/pull/1#discussion_r4419235198) | Fixed: every available Gmail draft thread ID is preserved, even without RFC reply headers. No headers are fabricated from a subject prefix.                                                                                                                                                                                                                                         |
| [Sandbox image cookies](https://github.com/KB01111/kb-onemail/pull/1#discussion_r4419235203) | The proposed authentication removal is not supported by the current source: the reader uses `allow-same-origin` and its srcdoc inherits the parent origin. Keep the proxy private. A workerd regression verifies missing sessions are rejected and valid sessions reach host validation. Browser reproduction is unverified because local browser use is disabled in Work settings. |

The [Qlty comment](https://github.com/KB01111/kb-onemail/pull/1#issuecomment-6511503925)
also reported four blocking workflow findings. Both workflows now disable
checkout credential persistence, and every action is pinned to a verified full
commit ID. Workflow job names and quality concurrency are explicit. No audit
rules or thresholds were relaxed.

Other review-service comments concern file/size/usage limits or missing service
setup; they contain no additional code findings. Non-blocking complexity and
duplication observations do not justify restructuring the mature composer or
migration converter during this correctness pass.

## Validation

- 146 Bun tests pass, including six new regression scenarios; 410 assertions.
- Strict type checking and Biome lint pass.
- Actionlint and the Zizmor offline auditor scan pass with no findings.
- Dependency audit reports no vulnerabilities; diff whitespace check passes.
- Production build and all 15 local workerd/D1 checks pass. Wrangler deployment
  dry run passes at 2475.92 KiB compressed. Live Google and hosted acceptance
  remain separate.

No thread was marked resolved or replied to automatically. The requested fixes
are pushed to the existing PR; current hosted results are on its Checks tab.

## Browser references

The [HTML origin rules](https://html.spec.whatwg.org/dev/document-sequences.html)
specify that srcdoc inherits its source origin unless the sandboxed-origin flag
is set. The reader's `allow-same-origin` prevents that opaque-origin flag while
scripts remain disabled. [MDN's iframe reference](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe)
also explains this permission and notes that a sandbox can prevent native PDF
viewers from loading, even with script/download permissions. These references
support the implementation decisions; they are not a substitute for real browser
acceptance on the deployed application.
