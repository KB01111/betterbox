# BetterBox Tauri v2 desktop release

## Scope

Replace the proposed Edge launcher installer with a Windows Tauri v2 application
and publish its installer in KB01111/betterbox GitHub Releases. Keep the existing
Cloudflare Workers/D1 backend and hosted mailbox interface.

## Recommended design

- Tauri v2 uses Windows WebView2 to show the existing BetterBox deployment.
- Restrict application navigation to the exact BetterBox HTTPS origin. Open
  ordinary external links in the system browser. Do not grant arbitrary remote
  pages native filesystem, shell, or credential access.
- Google sign-in and account linking run in the system browser, not the embedded
  WebView. Add an expiring, single-use authentication handoff bound to a native
  verifier so the authenticated session can be established in the desktop app.
  OAuth tokens and client secrets remain on the server. Do not put session
  tokens into callback URLs or expose them to page JavaScript.
- Preserve explicit Gmail admission, account ownership checks, remote-image
  consent, HTML sandboxing and encrypted server-side OAuth credentials.
- Do not add mailbox persistence or offline mailbox storage. The installed app
  requires an internet connection and uses the existing Cloudflare deployment.
- Produce a per-user Windows NSIS installer with application icon, Start menu
  entry and uninstaller. Handle the WebView2 runtime prerequisite.
- Publish source changes on a release branch and a versioned GitHub release with
  the installer and SHA-256 checksum. Do not merge unrelated work or commit
  credentials. Clearly label an unsigned installer if no signing identity exists.

## Alternatives

An Edge launcher has less integration work but was superseded by the Tauri
request. Moving the server and OAuth credentials into the desktop application
would change the established architecture and is outside this release.

## Acceptance

Build the actual Windows installer. Verify installation, launch, external-link
handling, system-browser authentication handoff, account linking and uninstall.
Run existing web checks and regression tests for handoff expiry, replay,
verifier binding and user isolation. Use hosted CI for reproducible packaging.
Only claim live Google consent when completed with the user's account; leave
the final Google permission approval to the user if required.

## Implementation order

1. Add and test the authentication handoff without changing ordinary web login.
2. Add the restricted Tauri shell and native sign-in integration.
3. Build and verify the Windows installer and run existing app checks.
4. Push the release branch, verify hosted packaging, and publish release assets.
