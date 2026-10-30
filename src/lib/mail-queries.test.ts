import { afterEach, expect, test } from "bun:test";
import { canDisconnectGoogleAccount, mergeAccountProfile } from "./account";

test("dummy mailboxes do not unlock disconnect for the last real Google account", () => {
  const real = {
    accountId: "google-sub",
    email: "owner@example.test",
    unread: 0,
  };
  const dummy = {
    accountId: "test-owner",
    email: "demo@example.test",
    unread: 0,
  };
  expect(canDisconnectGoogleAccount([real, dummy], real.accountId)).toBe(false);
  expect(
    canDisconnectGoogleAccount(
      [real, dummy, { ...real, accountId: "another-google" }],
      real.accountId,
    ),
  ).toBe(true);
  expect(canDisconnectGoogleAccount([real, dummy], dummy.accountId)).toBe(
    false,
  );
});
import {
  createLabel,
  deleteLabel,
  labelsQueryOptions,
  renameLabel,
} from "./mail-queries";

test("demo label changes survive refetches without affecting another account or calling Gmail", async () => {
  globalThis.fetch = (async () => {
    throw new Error("Demo must not contact Gmail");
  }) as unknown as typeof fetch;
  const account = "test-label-review";
  const other = "test-label-other";
  await renameLabel(account, "Label_vip", "Important");
  expect(await labelsQueryOptions(account).queryFn()).toContainEqual({
    id: "Label_vip",
    name: "Important",
  });
  const created = await createLabel(account, "Review");
  expect(await labelsQueryOptions(account).queryFn()).toContainEqual(created);
  await deleteLabel(account, "Label_vip");
  expect(
    (await labelsQueryOptions(account).queryFn()).some(
      (label) => label.id === "Label_vip",
    ),
  ).toBe(false);
  expect(await labelsQueryOptions(other).queryFn()).toContainEqual({
    id: "Label_vip",
    name: "VIP",
  });
});
import {
  fetchEmailsPage,
  mailRetry,
  mailRetryDelay,
  MailRequestError,
} from "./mail-queries";

const originalFetch = globalThis.fetch;
test("failed profile refresh preserves the verified sender and record identity", () => {
  const account = {
    accountId: "google-sub",
    recordId: "record",
    email: "verified@example.com",
    unread: 7,
  };
  expect(
    mergeAccountProfile(account, { email: "", status: "unavailable" }),
  ).toEqual({ ...account, status: "unavailable" });
  expect(
    mergeAccountProfile(account, { unread: 2, email: "verified@example.com" })
      .unread,
  ).toBe(2);
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("global search preserves operators, account and its independent cursor", async () => {
  let requested = "";
  let receivedSignal: AbortSignal | null | undefined;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requested = String(input);
    receivedSignal = init?.signal;
    return Response.json({ emails: [], nextPageToken: "next-b" });
  }) as unknown as typeof fetch;
  const controller = new AbortController();
  const page = await fetchEmailsPage({
    accountId: "a&b",
    folder: "inbox",
    q: "from:github.com has:attachment",
    globalSearch: true,
    pageToken: "page-a",
    signal: controller.signal,
  });
  const params = new URL(requested, "https://app.example").searchParams;
  expect(params.get("accountId")).toBe("a&b");
  expect(params.get("q")).toBe("from:github.com has:attachment");
  expect(params.get("pageToken")).toBe("page-a");
  expect(params.get("max")).toBe("10");
  expect(page.nextPageToken).toBe("next-b");
  expect(receivedSignal).toBe(controller.signal);
});

test("rate-limit responses retain bounded Retry-After and do not retry authorization failures", async () => {
  globalThis.fetch = (async () =>
    Response.json(
      { error: "Wait before trying again" },
      { status: 429, headers: { "retry-after": "12" } },
    )) as unknown as typeof fetch;
  let failure: Error | undefined;
  try {
    await fetchEmailsPage({ accountId: "real", folder: "inbox" });
  } catch (error) {
    failure = error as Error;
  }
  expect(failure).toBeInstanceOf(MailRequestError);
  expect(mailRetryDelay(0, failure as Error)).toBe(12_000);
  expect(mailRetry(0, failure as Error)).toBe(true);
  expect(mailRetry(2, failure as Error)).toBe(false);
  expect(mailRetry(0, new MailRequestError("Reconnect", 403))).toBe(false);
});

test("a repeated cursor becomes a retryable partial failure instead of a stuck load button", async () => {
  globalThis.fetch = (async () =>
    Response.json({
      emails: [],
      nextPageToken: "same",
    })) as unknown as typeof fetch;
  await expect(
    fetchEmailsPage({ accountId: "real", folder: "inbox", pageToken: "same" }),
  ).rejects.toThrow("did not advance");
});
