import { expect, test } from "bun:test";
import { ComposerOpenGuard } from "../composer-open";
import {
  desktopAction,
  hasDesktopCapability,
  saveBeforeDesktopExit,
  isDesktopDraftDirty,
  canActivateDesktopCompose,
  desktopAuthenticationBlocked,
  reportDesktopLifecycle,
  isDesktopState,
} from "./desktop-bridge";

test("desktop capabilities require the supported version and callable request", () => {
  expect(
    hasDesktopCapability(
      { version: 2, capabilities: ["mail"], request() {} },
      "mail",
    ),
  ).toBe(false);
  expect(
    hasDesktopCapability({ version: 1, capabilities: ["mail"] }, "mail"),
  ).toBe(false);
  expect(
    hasDesktopCapability(
      { version: 1, capabilities: ["mail"], request() {} },
      "mail",
    ),
  ).toBe(true);
});
test("desktop state rejects partial or incompatible host responses", () => {
  expect(isDesktopState({ backgroundStatus: "running" })).toBe(false);
  const state = {
    version: "0.1.0",
    notifications: true,
    previews: true,
    launchAtLogin: false,
    backgroundStatus: "running",
    signedUpdates: false,
    update: { status: "idle" },
  };
  expect(isDesktopState(state)).toBe(true);
  expect(isDesktopState({ ...state, update: { status: "unknown" } })).toBe(
    false,
  );
});
test("linking waits for composer actions and unsaved Gmail changes", () => {
  reportDesktopLifecycle(false, true);
  expect(desktopAuthenticationBlocked()).toBe(true);
  reportDesktopLifecycle(true, false);
  expect(desktopAuthenticationBlocked()).toBe(true);
  reportDesktopLifecycle(false, false);
  expect(desktopAuthenticationBlocked()).toBe(false);
});
test("a pending draft load blocks mailto activation until that generation finishes", () => {
  const guard = new ComposerOpenGuard();
  const ticket = guard.begin("user");
  expect(ticket).not.toBeNull();
  if (!ticket) throw new Error("Expected a pending draft generation");
  expect(canActivateDesktopCompose(guard)).toBe(false);
  expect(guard.canCommit(ticket, "user")).toBe(true);
  guard.finish(ticket);
  expect(canActivateDesktopCompose(guard)).toBe(true);
});
test("clearing an existing draft still requires Gmail confirmation before quit", async () => {
  const dirty = isDesktopDraftDirty(true, false, false, true);
  expect(dirty).toBe(true);
  expect(isDesktopDraftDirty(true, false, false, false)).toBe(false);
  expect(isDesktopDraftDirty(true, true, false, true)).toBe(false);
  expect(
    await saveBeforeDesktopExit({
      busy: false,
      dirty,
      payload: { subject: "", body: "" },
      current: () => null,
      save: async () => {
        throw new Error("offline");
      },
    }),
  ).toBe(false);
});
test("quit blocks busy, failed saves, and edits arriving during the Gmail save", async () => {
  const payload = { subject: "draft" };
  let current = payload;
  let calls = 0;
  const save = async () => {
    calls++;
  };
  expect(
    await saveBeforeDesktopExit({
      busy: true,
      dirty: false,
      payload,
      current: () => current,
      save,
    }),
  ).toBe(false);
  expect(calls).toBe(0);
  expect(
    await saveBeforeDesktopExit({
      busy: false,
      dirty: true,
      payload,
      current: () => current,
      save: async () => {
        throw new Error("offline");
      },
    }),
  ).toBe(false);
  expect(
    await saveBeforeDesktopExit({
      busy: false,
      dirty: true,
      payload,
      current: () => current,
      save: async () => {
        current = { subject: "new edit" };
      },
    }),
  ).toBe(false);
  current = payload;
  expect(
    await saveBeforeDesktopExit({
      busy: false,
      dirty: true,
      payload,
      current: () => current,
      save,
    }),
  ).toBe(true);
  expect(calls).toBe(1);
});
test("native activation rejects untrusted shapes and strips unknown mail fields", () => {
  expect(desktopAction({ kind: "compose", payload: { to: 123 } })).toBeNull();
  expect(desktopAction({ kind: "quit-request" })).toBeNull();
  expect(
    desktopAction({
      kind: "compose",
      payload: { to: "a@example.com", send: true },
    }),
  ).toEqual({ kind: "compose", payload: { to: "a@example.com" } });
  expect(desktopAction({ kind: "quit-request", requestId: "q" })).toEqual({
    kind: "quit-request",
    requestId: "q",
  });
});
