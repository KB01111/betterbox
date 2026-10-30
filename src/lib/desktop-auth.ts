import { createHash } from "node:crypto";

export const DESKTOP_AUTH_TTL = 5 * 60_000;
export const DESKTOP_MODES = ["signin", "google", "google-settings", "github"] as const;
export type DesktopMode = typeof DESKTOP_MODES[number];
export function validDesktopSecret(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}
export function desktopChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}
export function desktopUserCode(id: string): string {
  return `${id.slice(0, 4)}-${id.slice(4, 8)}`.toUpperCase();
}
