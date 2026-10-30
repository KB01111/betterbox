# KB OneMail for Windows

KB OneMail 0.3.0 is a Tauri v2 Windows 11 personal preview. The existing
https://betterbox.kevinjbridgelal.workers.dev deployment remains the only backend.
The application/profile identifier stays dev.kevinjbridgelal.betterbox so sessions,
layouts and preferences survive the product rename.

## Desktop behavior

- Native Windows caption buttons, system menu, Snap Layouts and window restoration.
- Translucent Mica sidebar/chrome, theme-matched title bar, and solid mail surfaces.
  Turn translucency off in Desktop settings. Windows transparency, high contrast,
  reduced transparency and battery saver take precedence. Unsupported systems
  use an opaque window; no web blur or animation loop is used.
- One instance per Windows user; closing hides to the tray. Use its Quit command
  to exit. Compose, Settings, Open and Check mail are available from the tray.
- Native background checks every five minutes. History cursors and deduplication
  exist only in memory. Hidden WebView rendering suspends when drafts/actions
  are safe; Rust continues checking mail.
- Windows notifications optionally show sender and subject. Windows notification
  history is the explicitly approved persistence exception. Private alerts and
  notifications-off remain available; no local mailbox/body/draft database exists.
- Mailto is advertised in Windows Default apps; the user chooses the handler.
  Links populate an editable composer and never send automatically. Existing
  compositions and pending draft loads are protected.
- Optional launch at Windows sign-in starts in the tray; disabled by default.
- Quit, reload and update installation require a successful draft-save handshake.
  Failed/busy saves keep the app open. Browser OAuth retains the verifier-bound,
  expiring, single-use approval-code handoff.

## Build and verification

Use the pinned Bun/Rust versions in package.json and Cargo.toml and install the
Windows C++ Build Tools, Windows SDK and Microsoft WebView2 runtime.

    bun install --frozen-lockfile
    bun run check
    bun run test
    bun run build

Release packaging requires TAURI_SIGNING_PRIVATE_KEY and
TAURI_SIGNING_PRIVATE_KEY_PASSWORD. Keep private material outside source control.
The public verification key in updater.pub must match plugins.updater.pubkey.
The release workflow uses encrypted repository secrets and checks this identity.

The resulting NSIS installer, updater signature and checksum go under
src-tauri/target/release/bundle/nsis (or CARGO_TARGET_DIR when overridden).
This is a per-user installation. Missing WebView2 uses Microsoft's bootstrapper
and requires internet. The installer is **unsigned by a Windows publisher**;
Windows may show a publisher/SmartScreen warning. Update signing is separate.

## Upgrade and distribution

The installer migrates a verified BetterBox 0.2.1 default installation in place.
It checks the exact old per-user path and executable version, preserves the
identifier-based profile, and removes only matching old records and shortcuts.
Other/custom legacy installations are left alone.

The Windows release workflow builds and signs immutable versioned installer
assets. Publishing is an explicit manual dispatch with compatible backend and
installer acceptance recorded. The preview channel manifest is uploaded last.
Updates verify installer signatures, ask before installation, and protect drafts.
A failed or missing update channel keeps the current installed application.

Before releasing, deploy compatible hosted support and record installed Windows
acceptance against the exact installer SHA-256. See ../docs/windows-hardening.md.
Live OAuth, notification-center activation, sleep/resume, accessibility, multiple
monitors/DPI and performance targets need actual platform evidence; passing
unit tests or a build does not qualify them.

## Resource measurements

From the repository root, the measurement script records only the selected app
process and descendants, without mail, URLs, command lines or screenshots.

    pwsh -NoProfile -File scripts/measure-desktop.ps1 -SelfTest
    pwsh -NoProfile -File scripts/measure-desktop.ps1 -ProcessId <PID> -DurationSeconds 900 -OutputPath <absolute-json-path>

Keep unrelated heavy work stopped for acceptance measurements. The JSON/CSV
records normalized CPU, private memory, working set and sample duration. It does
not establish startup/interaction latency or a 1,000-row navigation soak by itself.
