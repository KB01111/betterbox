# Tauri desktop implementation plan

Approved scope: docs/tauri-desktop-design.md. Work on codex/tauri-desktop-release.
Keep existing deployment changes from this chat; no secrets in commits.

- [ ] Server handoff: add short-lived D1 authentication tickets bound to SHA-256
  verifier challenges. Browser approval requires an authenticated session and
  explicit code comparison. Redeem atomically, issue a separate Better Auth
  session, reject expiry/replay/wrong verifier and mismatched linking users.
- [ ] Browser page and auth-client integration: normal web flows remain intact;
  desktop sign-in/link/settings/GitHub flows use the native handoff. System
  browser handles Google consent; the user approves permissions themselves.
- [ ] Native shell: Tauri v2, trusted origin only, narrow authenticate command,
  system-browser opener, native polling and HttpOnly session-cookie installation.
  Per-user NSIS Windows installer with WebView2 prerequisite and branded icon.
- [ ] Verify unit/type/lint/build, Workers runtime security, native Rust tests,
  installer installation/launch/uninstall. Review the connected implementation.
- [ ] Deploy server support, commit and push release source, run hosted Windows
  packaging and web checks; publish installer and checksum on our fork.

## Shared protocol

POST /api/desktop/start {challenge, mode} -> {id, userCode, browserUrl}.
Modes: signin, google, google-settings, github.
Link modes require native session; server binds expected user.
Native verifier is random 32 bytes base64url; challenge SHA256 base64url.
POST /api/desktop/redeem {id, verifier} -> 202 pending, 410 expired/used,
403 invalid; 200 {cookie:{name,value,expires}} on success.
Cookie expires is RFC3339 UTC. Native sends session cookies to start for linking.
Browser /desktop/connect?id=... shows userCode and approval; it initiates web
login/linking itself, then POST /api/desktop/approve {id} on explicit confirmation.
Native polls every 2 seconds for at most 5 minutes, never exposes cookie to JS,
sets HttpOnly Secure same-site cookie at trusted host and reloads mailbox.
