import { desktopAuthenticationBlocked, desktopBridge } from "./desktop-bridge";
export type DesktopAuthMode =
  "signin" | "google" | "google-settings" | "github";

export function desktopConnectSearch(search: Record<string, unknown>) {
  return {
    id: typeof search.id === "string" ? search.id : "",
    connected: search.connected === "1" || search.connected === 1,
    error: typeof search.error === "string" ? search.error : undefined,
  };
}

declare global {
  interface Window {
    __BETTERBOX_DESKTOP__?: {
      authenticate: (mode: DesktopAuthMode) => Promise<unknown>;
    };
  }
}

export function desktopAuthenticate(mode: DesktopAuthMode) {
  const desktop =
    desktopBridge("auth") ??
    (typeof window !== "undefined" ? window.__BETTERBOX_DESKTOP__ : undefined);
  if (!desktop) return undefined;
  if (desktopAuthenticationBlocked())
    return Promise.resolve({
      error: {
        code: "desktop_busy",
        message:
          "Save or discard your open draft and finish the current action before connecting an account.",
      },
    });
  return desktop
    .authenticate(mode)
    .then(() => ({ error: null }))
    .catch(() => ({
      error: {
        code: "desktop_auth_failed",
        message: "Desktop connection failed or expired. Try again.",
      },
    }));
}
