export function authorizationErrorMessage(code: string | undefined): string | null {
  if (!code) return null;
  const messages: Record<string,string> = {
    desktop_auth_failed: "Desktop connection failed or expired. Start again and approve the matching code in your browser.",
    access_denied: "Google authorization was cancelled. Choose an allowed account and grant Gmail access to continue.",
    invalid_grant: "Google access has expired or been revoked. Reconnect the account and grant access again.",
    redirect_uri_mismatch: "The Google OAuth callback does not match this deployment. Ask the instance owner to update the Web client redirect URI.",
    email_not_allowed: "This Google address is not on the instance access list. Ask the owner to add it before signing in or linking it.",
    account_already_linked_to_different_user: "This Google account belongs to another BetterBox user. Disconnect it from that user before linking it here.",
    state_mismatch: "The sign-in session expired. Start again in this browser tab.",
    state_not_found: "The sign-in session expired. Start again in this browser tab.",
    unable_to_link_account: "The account could not be linked. Sign in again, then retry Add Gmail account.",
    invalid_code: "The authorization code expired. Start sign-in again.",
    account_not_linked: "Sign in using the Google account that created your BetterBox user, then add this account from Settings.",
  };
  return messages[code] ?? "Google authorization could not finish. Retry, or ask the instance owner to check OAuth credentials and permitted users.";
}
