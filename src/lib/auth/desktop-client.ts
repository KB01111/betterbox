export type DesktopAuthMode = "signin" | "google" | "google-settings" | "github";

declare global {
  interface Window {
    __BETTERBOX_DESKTOP__?: { authenticate: (mode: DesktopAuthMode) => Promise<unknown> };
  }
}

export function desktopAuthenticate(mode: DesktopAuthMode) {
  const desktop = typeof window !== "undefined" ? window.__BETTERBOX_DESKTOP__ : undefined;
  if (!desktop) return undefined;
  return desktop.authenticate(mode).then(() => ({ error: null })).catch(() => ({
    error: { code: "desktop_auth_failed", message: "Desktop connection failed or expired. Try again." },
  }));
}
