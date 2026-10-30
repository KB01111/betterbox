# BetterBox for Windows

This Tauri v2 client opens the existing BetterBox deployment at
`https://betterbox.kevinjbridgelal.workers.dev`. The Workers/D1 application remains
the only backend. An internet connection is required. The desktop client adds no
mailbox database, offline mailbox buffer, or embedded OAuth credentials.

## Build

Use Windows 10/11 x64, Visual Studio C++ Build Tools and Windows SDK, Rust 1.95.0,
and Bun 1.3.14. From this directory:

```powershell
bun install --frozen-lockfile
bun run check
bun run test
bun run build
```

The installer is emitted beneath
`src-tauri/target/release/bundle/nsis/`. It installs for the current user, creates
a Start menu entry and uninstaller, and downloads the Microsoft WebView2
bootstrapper if the runtime is missing. Installer setup therefore needs internet
access. The installer is **unsigned**; Windows may show a publisher/SmartScreen
warning. No signing identity or automatic update channel is configured.

The application icon is rendered directly from the existing `public/favicon.svg`
branding using the pinned Tauri CLI. To regenerate only Windows assets:

```powershell
bunx tauri icon ../public/favicon.svg --output src-tauri/icons
```

Keep `icon.ico`, `icon.png`, and `32x32.png` for the Windows build; the command
also produces icons for other platforms which are not used here.

## Native security boundary

The only remote native command is `desktop_auth(mode)`, with the four supported
modes `signin`, `google`, `google-settings`, and `github`. An initialization script
publishes `window.__BETTERBOX_DESKTOP__.authenticate(mode)` only in the trusted
top-level document. No filesystem, shell, opener, credential, or general window
commands are granted to the remote page. Application command permissions are
generated explicitly in `build.rs` and granted only to the exact hosted HTTPS
origin and main window.

The native client generates a random 32-byte verifier and sends its SHA-256
base64url challenge to `/api/desktop/start`. Linking requests include the native
WebView's hosted cookies. The returned browser URL must have the exact trusted
origin, `/desktop/connect` path, and matching ticket ID. The native window shows
the approval code, and the system browser handles login, provider consent and
explicit approval. Native polling is limited to five minutes. Redeemed session
cookies are validated, installed as Secure, HttpOnly, SameSite=Lax cookies for
the exact hosted hostname, and never returned to JavaScript or placed in URLs.

Off-origin top-level navigation is cancelled; safe HTTP/HTTPS links open in the
system browser. New windows also open in the system browser. This policy uses
WebView2's top-level navigation event, so it does not intercept the sandboxed mail
iframe's own navigation or change its CSP/image policy. Google is never opened
inside an embedded provider window. Attachment downloads use a native Save As
dialog and only write the path explicitly chosen there; the remote page receives
no file API. Downloads are restricted to the hosted origin or blobs owned by it.

WebView2 keeps the application's session and ordinary browser profile state in
the per-user application profile. This is not an offline mailbox feature; the
desktop shell does not write message content to its own storage.

## Reproducible packaging

`.github/workflows/desktop-release.yml` runs on manual dispatch and `desktop-v*`
tags. It checks the committed Rust and Bun lockfiles, runs native tests, builds
the per-user NSIS installer, calculates SHA-256, and uploads both as workflow
artifacts. It does not create or publish a GitHub Release. Publish the installer
and checksum only after checking the matching workflow head and acceptance
results.

## Acceptance boundaries

Rust tests cover exact-origin decisions, handoff URL matching, verifier/challenge
generation, supported modes and cookie validation. A passing build does not prove
live OAuth consent, signed distribution, installation, attachment saving, or
accessibility. Record those results against the exact installer hash before
claiming them. Provider consent must be completed by the account owner.
