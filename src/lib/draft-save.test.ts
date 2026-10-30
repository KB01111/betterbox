import { describe, expect, test } from "bun:test";
import { ComposerOpenGuard } from "./composer-open";
import { DraftSaveQueue, resolveSender } from "./draft-save";

test("late draft loads cannot replace a new user's composer", () => {
  const guard = new ComposerOpenGuard();
  const first = guard.begin("first-user");
  expect(first).not.toBeNull();
  expect(guard.pending).toBe(true);
  expect(guard.begin("first-user")).toBeNull();
  guard.cancel();
  const second = guard.begin("second-user");
  if (!first || !second) throw new Error("Expected pending loads");
  guard.finish(first);
  expect(guard.pending).toBe(true);
  expect(guard.canCommit(first, "second-user")).toBe(false);
  expect(guard.canCommit(second, "second-user")).toBe(true);
});

describe("draft ownership and saves", () => {
  test("a disconnected explicit sender never falls back to another account", () => {
    const accounts = [{ accountId: "other", email: "other@example.com" }];
    expect(resolveSender(accounts, "disconnected", "other")).toBeNull();
    expect(resolveSender(accounts, null, "other")?.accountId).toBe("other");
  });

  test("overlapping saves reuse the first created draft and await the newest content", async () => {
    let finishFirst!: () => void;
    const gate = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const persisted: { html: string; draftId?: string }[] = [];
    const queue = new DraftSaveQueue("account-a", async (payload) => {
      persisted.push({ html: payload.html, draftId: payload.draftId });
      markStarted();
      if (persisted.length === 1) await gate;
      return { draftId: "draft-a", messageId: `message-${persisted.length}` };
    });
    const first = queue.save({
      accountId: "account-a",
      to: "",
      subject: "",
      html: "old",
    });
    const newest = queue.save({
      accountId: "account-a",
      to: "",
      subject: "",
      html: "new",
    });
    await started;
    expect(persisted).toHaveLength(1);
    finishFirst();
    await first;
    expect(await newest).toEqual({
      draftId: "draft-a",
      messageId: "message-2",
    });
    expect(persisted).toEqual([
      { html: "old", draftId: undefined },
      { html: "new", draftId: "draft-a" },
    ]);
  });

  test("rejects an account change before issuing a Gmail write", async () => {
    let writes = 0;
    const queue = new DraftSaveQueue("account-a", async () => {
      writes += 1;
      return { draftId: "a", messageId: "a" };
    });
    await expect(
      queue.save({
        accountId: "account-b",
        to: "",
        subject: "",
        html: "private",
      }),
    ).rejects.toThrow("sending account");
    expect(writes).toBe(0);
  });

  test("failed updates retain identity and allow a retry without creating a duplicate", async () => {
    let attempt = 0;
    const queue = new DraftSaveQueue("account-a", async ({ draftId }) => {
      attempt += 1;
      if (attempt === 2) throw new Error("offline");
      return { draftId: draftId ?? "draft-a", messageId: `message-${attempt}` };
    });
    const payload = {
      accountId: "account-a",
      to: "",
      subject: "",
      html: "work",
    };
    await queue.save(payload);
    await expect(queue.save(payload)).rejects.toThrow("offline");
    expect(await queue.save(payload)).toEqual({
      draftId: "draft-a",
      messageId: "message-3",
    });
  });

  test("an existing draft must resolve before saving and cannot be recreated when missing", async () => {
    let writes = 0;
    const queue = new DraftSaveQueue(
      "account-a",
      async () => {
        writes += 1;
        return { draftId: "duplicate", messageId: "duplicate" };
      },
      async () => null,
    );
    await expect(
      queue.save({ accountId: "account-a", to: "", subject: "", html: "work" }),
    ).rejects.toThrow("draft");
    expect(writes).toBe(0);
  });
  test("a remounted composer cannot begin another send while one is pending", () => {
    const queue = new DraftSaveQueue("account-a", async () => null);
    expect(queue.beginOperation("send")).toBe(true);
    expect(queue.beginOperation("send")).toBe(false);
    expect(queue.beginOperation("close")).toBe(false);
    queue.endOperation();
    expect(queue.beginOperation("close")).toBe(true);
  });
  test("a cancelled composer cannot save or send under another signed-in session", async () => {
    let writes = 0;
    const queue = new DraftSaveQueue("account-a", async () => {
      writes += 1;
      return { draftId: "a", messageId: "a" };
    });
    queue.cancel();
    expect(queue.beginOperation("send")).toBe(false);
    await expect(
      queue.save({
        accountId: "account-a",
        to: "",
        subject: "",
        html: "private",
      }),
    ).rejects.toThrow("active");
    expect(writes).toBe(0);
  });
});
