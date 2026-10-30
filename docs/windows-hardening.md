# KB OneMail Windows hardening

Implementation of the approved 2026-10-30 plan. Keep Tauri/WebView2, Roboto,
the shared mail interface, and the existing Workers/D1 backend. This is an
unsigned personal preview; update signatures are separate from Windows publisher
signing. The hosted origin and `dev.kevinjbridgelal.betterbox` application/profile
identifier are compatibility identifiers, not product branding.

## Milestones

These boxes track accepted installed behavior. Source implementation and local
checks are recorded below; pending Windows acceptance does not mean the source
work is absent.

- [ ] Rename fork/product to KB OneMail, blue envelope icon and default accent,
      migrate existing settings and BetterBox 0.2.1 installation safely.
- [ ] Single instance, native window controls, monitor-safe restoration, close to
      tray, activation handling, startup/recovery, draft-safe quit/restart.
- [ ] Versioned restricted bridge, desktop settings and Windows keyboard labels;
      preserve existing web clients and desktop authentication alias.
- [ ] Stateless owned-account Gmail history endpoint, native five-minute polling,
      hidden WebView suspension, unread indication, Windows notification activation,
      mailto and optional launch at login.
- [ ] Signature-verified preview updates, immutable release assets, channel
      manifest published last, no secrets in source.
- [ ] Web/native/runtime/installer validation and measured performance evidence.

## Window material

The Windows shell uses the native Mica backdrop with a translucent sidebar and
chrome, matching light/dark caption colors and the existing Roboto interface.
Mail and composition surfaces remain nearly opaque for readability. Native
caption buttons, resizing, system menus and Snap Layouts stay enabled. No web
blur animation or extra window-chrome plugin is required.

Desktop settings offer a translucent-window toggle. The native layer also falls
back to solid surfaces on older Windows builds, when Windows transparency is
disabled, in high contrast or battery saver, and when the renderer requests
reduced transparency. Backdrop setup failures also select solid surfaces.

## Privacy decision

The deployment owner explicitly approved sender and subject in Windows
notification history. This is the only new mailbox-persistence exception.
Private alerts and notifications-off remain available. The application still
does not persist a mailbox, bodies, attachments, draft buffers, Gmail history
cursors, or notification-deduplication data. Existing sessions, identity metadata,
user-created snippets/signatures, and non-mail preferences keep their existing
storage rules. Native background processing keeps only memory state.

## Acceptance

Measure the native process and its WebView2 descendants together, using release
builds. Targets on the Ryzen AI 9 HX 370 / 32 GB Windows 11 machine: local screen
startup p95 <=1 s, warm restore p95 <=300 ms, local interaction p95 <=100 ms,
foreground idle CPU <0.5%, tray CPU <0.1% over 15 minutes. With three accounts and
1,000 loaded rows, rendered rows must stay bounded and unexplained memory growth
must stay <=10% after a 30-minute navigation soak. These are targets, never
assumed results.

Record verification against exact installer SHA-256. Installation, 0.2.1 upgrade,
uninstall, notifications from notification center after exit, mailto, autostart,
sleep/offline recovery, multiple monitors, DPI, Narrator, high contrast and reduced
motion require actual platform evidence. Live OAuth consent belongs to the
account owner. A successful build does not qualify these checks.

## Implementation verification, 2026-10-30

- Fork renamed to `KB01111/kb-onemail`; local origin updated, upstream retained.
- Hosted support deployed at the existing origin, Workers version
  `14ab1fd7-9a5f-41df-b3fc-240afe4c0041`. Sign-in returns the new brand with
  private/no-store caching. No database or OAuth callback changes were required.
- Web typecheck, lint, build and 171 unit tests pass; 22 local Workers/D1 runtime
  checks pass. Native Rust tests pass (20 tests), including COM notification
  value ownership and a rejected backdrop selecting the solid fallback.
- An independent source review checked the final native appearance and
  notification identity changes. Installed behavior is qualified separately.
- The older portable 0.2.1 resource sample is preliminary: builds were running,
  and the first sampler collected too few intervals. It does not qualify idle
  CPU, memory growth or the 30-minute navigation soak.
- Source is prepared on `codex/kb-onemail-windows` for pull-request review.
  No new desktop version or update-channel manifest has been published.
- Google OAuth verification is not complete. Live Google project number
  `465098970444` requests identity scopes and `gmail.modify`; optional signature
  import adds `gmail.settings.basic`. Domain ownership, reviewer evidence and
  the required server-side security assessment remain external release work.
  The public FAQ no longer quotes a fixed assessment price or instructs users
  to bypass Google's warning.
- Visual checks observed Mica, the blue branding, native caption controls and
  retained sessions in the running development build. Further window interaction
  and final installation were deferred at the owner's explicit request to leave
  the app controls alone. Do not use that development build for performance
  qualification; use the release installer when testing resumes.

### Local release candidate

`KB OneMail_0.3.0_x64-setup.exe` — 3,868,107 bytes.

SHA-256: `fc2dd0e67b7dc1f40459addb0c99324f520d98e13162d5bc2c8b16fdd6b95ac8`.
The updater signature was verified against the bundled public key; tampered
installer bytes were rejected. This does not confer Windows publisher signing.

An earlier candidate exercised the default 0.2.1 upgrade, exact shortcut target,
legacy record/executable removal, profile preservation and uninstall. A custom
legacy path was left untouched. These checks do not qualify the final hash:
the notification-value ownership and checked-backdrop fixes followed that run.
Repeat fresh install, upgrade and activation checks against the hash above when
window interaction resumes. The currently open development build was left alone.
