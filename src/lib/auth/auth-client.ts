import { createAuthClient } from "better-auth/react";
import { inferAdditionalFields } from "better-auth/client/plugins";
import type { auth } from "./auth";
import { toast } from "sonner";
import { authorizationErrorMessage } from "./auth-errors";
import { desktopAuthenticate } from "./desktop-client";

// inferAdditionalFields mirrors the server's user.additionalFields (e.g. `role`)
// onto the typed client — `import type` keeps server code out of the bundle.
export const authClient = createAuthClient({
  plugins: [inferAdditionalFields<typeof auth>()],
});

export const signIn = () => desktopAuthenticate("signin") ?? authClient.signIn.social({ provider: "google", callbackURL: "/", errorCallbackURL: "/sign-in" });
export const signInWithGithub = () =>
  desktopAuthenticate("github") ?? authClient.signIn.social({ provider: "github" });

// Attach another Gmail account to the signed-in user.
export const linkGoogle = async (gmailSettings = false) => {
  try {
  const desktop = desktopAuthenticate(gmailSettings ? "google-settings" : "google");
  if (desktop) return await desktop;
  const result = await authClient.linkSocial({
    provider: "google",
    scopes: [
      "https://www.googleapis.com/auth/gmail.modify",
      ...(gmailSettings ? ["https://www.googleapis.com/auth/gmail.settings.basic"] : []),
    ],
    callbackURL: "/?connected=google",
    errorCallbackURL: "/sign-in",
  });
  if (result.error) toast.error(authorizationErrorMessage(result.error.code) ?? "Could not connect Google");
  return result;
  } catch { toast.error("Could not start Google authorization. Check your connection and try again."); }
};

// Link a GitHub account to the signed-in user (not a new account) so the Pull
// requests page can read PRs via the GitHub API. `repo` covers private PRs;
// `read:user` resolves the viewer. Returns to the PRs page after the OAuth hop.
export const linkGithub = async () => {
  try {
  const desktop = desktopAuthenticate("github");
  if (desktop) return await desktop;
  const result = await authClient.linkSocial({
    provider: "github",
    scopes: ["read:user", "repo"],
    callbackURL: "/pull-requests",
  });
  if (result.error) toast.error("GitHub connection is unavailable. Ask the instance owner to check the optional GitHub credentials.");
  return result;
  } catch { toast.error("Could not start GitHub authorization. Try again later."); }
};

export const { signOut, useSession } = authClient;
