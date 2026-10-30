import type { DesktopAuthMode } from "./desktop-client";

export type DesktopCapability =
  "auth" | "lifecycle" | "settings" | "updates" | "mail" | "appearance";
export type DesktopState = {
  version: string;
  notifications: boolean;
  previews: boolean;
  launchAtLogin: boolean;
  backgroundStatus: string;
  signedUpdates: boolean;
  translucency?: boolean;
  backdrop?: boolean;
  update: {
    status: "idle" | "checking" | "available" | "current" | "error";
    version?: string;
    error?: string;
  };
};
export function isDesktopState(value: unknown): value is DesktopState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<DesktopState>;
  return (
    typeof state.version === "string" &&
    typeof state.backgroundStatus === "string" &&
    [
      state.notifications,
      state.previews,
      state.launchAtLogin,
      state.signedUpdates,
    ].every((flag) => typeof flag === "boolean") &&
    !!state.update &&
    ["idle", "checking", "available", "current", "error"].includes(
      state.update.status,
    ) &&
    (state.update.version === undefined ||
      typeof state.update.version === "string") &&
    (state.update.error === undefined || typeof state.update.error === "string")
  );
}
type Preferences = Partial<
  Pick<
    DesktopState,
    "notifications" | "previews" | "launchAtLogin" | "translucency"
  >
>;
type Requests = {
  appearance: { theme: "dark" | "light"; transparency: boolean };
  state: Record<string, never>;
  preferences: Preferences;
  lifecycle: { busy: boolean; dirty: boolean };
  ready: { authenticated?: boolean };
  "check-mail": Record<string, never>;
  "check-updates": Record<string, never>;
  "install-update": Record<string, never>;
  "default-apps": Record<string, never>;
  "quit-response": { requestId: string; allow: boolean };
};
export type DesktopBridge = {
  version: 1;
  capabilities: DesktopCapability[];
  authenticate(mode: DesktopAuthMode): Promise<unknown>;
  request<T extends keyof Requests>(
    action: T,
    payload: Requests[T],
  ): Promise<unknown>;
};
declare global {
  interface Window {
    __KB_ONEMAIL_DESKTOP__?: DesktopBridge;
  }
}
export function hasDesktopCapability(
  value: unknown,
  capability: DesktopCapability,
): value is DesktopBridge {
  if (!value || typeof value !== "object") return false;
  const bridge = value as Partial<DesktopBridge>;
  return (
    bridge.version === 1 &&
    Array.isArray(bridge.capabilities) &&
    bridge.capabilities.includes(capability) &&
    (capability === "auth"
      ? typeof bridge.authenticate === "function"
      : typeof bridge.request === "function")
  );
}
export function desktopBridge(capability: DesktopCapability) {
  const value =
    typeof window === "undefined" ? undefined : window.__KB_ONEMAIL_DESKTOP__;
  return hasDesktopCapability(value, capability) ? value : undefined;
}
const CAPABILITY: Record<keyof Requests, DesktopCapability> = {
  appearance: "appearance",
  state: "settings",
  preferences: "settings",
  lifecycle: "lifecycle",
  ready: "lifecycle",
  "check-mail": "mail",
  "check-updates": "updates",
  "install-update": "updates",
  "default-apps": "settings",
  "quit-response": "lifecycle",
};
export async function desktopRequest<T extends keyof Requests>(
  action: T,
  payload: Requests[T],
) {
  const bridge = desktopBridge(CAPABILITY[action]);
  if (!bridge)
    throw new Error(
      "This desktop feature is unavailable. Update KB OneMail and try again.",
    );
  return bridge.request(action, payload);
}
export type ComposeActivation = Partial<
  Record<"to" | "cc" | "bcc" | "subject" | "body", string>
>;
export type DesktopAction =
  | { kind: "compose"; payload: ComposeActivation }
  | { kind: "quit-request"; requestId: string }
  | { kind: "settings" | "refresh" | "inbox" };
export function desktopAction(value: unknown): DesktopAction | null {
  if (!value || typeof value !== "object") return null;
  const action = value as Record<string, unknown>;
  if (action.kind === "quit-request")
    return typeof action.requestId === "string" && action.requestId.length > 0
      ? { kind: action.kind, requestId: action.requestId }
      : null;
  if (
    action.kind === "settings" ||
    action.kind === "refresh" ||
    action.kind === "inbox"
  )
    return { kind: action.kind };
  if (action.kind !== "compose") return null;
  if (
    action.payload !== undefined &&
    (!action.payload || typeof action.payload !== "object")
  )
    return null;
  const input = (action.payload ?? {}) as Record<string, unknown>;
  const payload: ComposeActivation = {};
  for (const key of ["to", "cc", "bcc", "subject", "body"] as const) {
    if (input[key] !== undefined) {
      if (
        typeof input[key] !== "string" ||
        input[key].length > 100_000 ||
        input[key].includes("\0")
      )
        return null;
      payload[key] = input[key];
    }
  }
  return { kind: "compose", payload };
}
export const DESKTOP_ACTION_EVENT = "kb-onemail:action";
export const DESKTOP_REFRESH_EVENT = "kb-onemail:refresh";
export const DESKTOP_QUIT_EVENT = "kb-onemail:save-before-quit";
let authenticationBlocked = false;
export function desktopAuthenticationBlocked() {
  return authenticationBlocked;
}
export function reportDesktopLifecycle(busy: boolean, dirty: boolean) {
  authenticationBlocked = busy || dirty;
  if (desktopBridge("lifecycle"))
    void desktopRequest("lifecycle", { busy, dirty }).catch(() => {});
}
export function isDesktopDraftDirty(
  open: boolean,
  saved: boolean,
  hasContent: boolean,
  existing: boolean,
) {
  return open && !saved && (hasContent || existing);
}
export function canActivateDesktopCompose(guard: { pending: boolean }) {
  return !guard.pending;
}
/** Gmail confirmation must still describe the latest editable content. */
export async function saveBeforeDesktopExit<T>({
  busy,
  dirty,
  payload,
  current,
  save,
}: {
  busy: boolean;
  dirty: boolean;
  payload: T | null;
  current: () => T | null;
  save: (payload: T) => Promise<unknown>;
}): Promise<boolean> {
  if (busy) return false;
  if (!dirty) return true;
  if (!payload) return false;
  try {
    await save(payload);
    return current() === payload;
  } catch {
    return false;
  }
}
