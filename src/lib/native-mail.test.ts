import { afterEach, expect, test } from "bun:test";
import { pollNativeMail, validateNativeMailInput } from "./native-mail.server";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
function mailbox(history: unknown, labels = ["INBOX", "UNREAD"]) {
  const urls: URL[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    urls.push(url);
    if (url.pathname.endsWith("/profile"))
      return Response.json({ historyId: "900" });
    if (url.pathname.endsWith("/labels/INBOX"))
      return Response.json({ messagesUnread: 12 });
    if (url.pathname.endsWith("/history"))
      return history === 404
        ? new Response(null, { status: 404 })
        : Response.json(history);
    return Response.json({
      labelIds: labels,
      payload: {
        headers: [
          { name: "fRoM", value: "Sender\r\n\u202etest" },
          { name: "Subject", value: "Hi\u0000 there" },
        ],
      },
    });
  }) as typeof fetch;
  return urls;
}

test("initial polling returns a baseline and unread count without old mail", async () => {
  const urls = mailbox({});
  expect(await pollNativeMail("token", { accountId: "111" })).toEqual({
    accountId: "111",
    cursor: "900",
    unread: 12,
    reset: true,
    messages: [],
  });
  expect(urls.some((url) => url.pathname.endsWith("/history"))).toBe(false);
});
test("expired history resets quietly without fetching older mail", async () => {
  mailbox(404);
  expect(
    await pollNativeMail("token", { accountId: "111", cursor: "100" }),
  ).toEqual({
    accountId: "111",
    cursor: "900",
    unread: 12,
    reset: true,
    messages: [],
  });
});
test("deduplicates arrivals, accepts inbox additions and ignores read/unread relabels", async () => {
  const urls = mailbox({
    historyId: "901",
    history: [
      {
        messagesAdded: [{ message: { id: "a" } }, { message: { id: "a" } }],
        labelsAdded: [
          { message: { id: "a" }, labelIds: ["INBOX"] },
          { message: { id: "b" }, labelIds: ["UNREAD"] },
          { message: { id: "c" }, labelIds: ["INBOX"] },
        ],
      },
    ],
  });
  const result = await pollNativeMail("token", {
    accountId: "111",
    cursor: "100",
  });
  expect(result.messages).toEqual([
    { id: "a", sender: "Sender test", subject: "Hi there" },
    { id: "c", sender: "Sender test", subject: "Hi there" },
  ]);
  expect(result.cursor).toBe("901");
  for (const url of urls.filter((url) => url.pathname.includes("/messages/"))) {
    expect(url.searchParams.get("format")).toBe("metadata");
    expect(url.searchParams.getAll("metadataHeaders")).toEqual([
      "From",
      "Subject",
    ]);
    expect(url.searchParams.get("fields")).toBe("labelIds,payload/headers");
  }
});
test("current label filtering excludes messages read or removed from inbox", async () => {
  for (const labels of [["INBOX"], ["UNREAD"], ["INBOX", "UNREAD", "TRASH"]]) {
    mailbox(
      {
        historyId: "901",
        history: [{ messagesAdded: [{ message: { id: "a" } }] }],
      },
      labels,
    );
    expect(
      (await pollNativeMail("token", { accountId: "111", cursor: "100" }))
        .messages,
    ).toEqual([]);
  }
});
test("large records resume within the same page and retain the old cursor until all pages drain", async () => {
  const urls = mailbox({
    historyId: "901",
    nextPageToken: "gmail-next",
    history: [
      {
        messagesAdded: Array.from({ length: 13 }, (_, id) => ({
          message: { id: String(id) },
        })),
      },
    ],
  });
  const first = await pollNativeMail("token", {
    accountId: "111",
    cursor: "100",
  });
  expect(first.messages).toHaveLength(10);
  expect(first.cursor).toBe("100");
  expect(first.truncated).toBe(true);
  expect(urls).toHaveLength(12);
  const second = await pollNativeMail(
    "token",
    validateNativeMailInput({
      accountId: "111",
      cursor: first.cursor,
      pageToken: first.pageToken,
    }),
  );
  expect(second.messages.map((message) => message.id)).toEqual([
    "10",
    "11",
    "12",
  ]);
  expect(second.cursor).toBe("100");
  expect(
    urls
      .filter((url) => url.pathname.endsWith("/history"))[1]
      .searchParams.has("pageToken"),
  ).toBe(false);
  mailbox({ historyId: "902", history: [] });
  const last = await pollNativeMail("token", {
    accountId: "111",
    cursor: second.cursor,
    pageToken: second.pageToken,
  });
  expect(last.cursor).toBe("902");
  expect(last.pageToken).toBeUndefined();
});
test("validates bounded identifiers, history ids, continuation shape and cursor coupling", () => {
  expect(validateNativeMailInput({ accountId: "111", cursor: "100" })).toEqual({
    accountId: "111",
    cursor: "100",
    pageToken: undefined,
  });
  for (const value of [
    {},
    { accountId: "../x" },
    { accountId: "x".repeat(201) },
    { accountId: "111", cursor: "-1" },
    { accountId: "111", cursor: "9".repeat(41) },
    { accountId: "111", pageToken: "x" },
    { accountId: "111", cursor: "1", pageToken: "x".repeat(4097) },
    {
      accountId: "111",
      cursor: "1",
      pageToken: Buffer.from('{"offset":-1}').toString("base64url"),
    },
  ]) {
    expect(() => validateNativeMailInput(value)).toThrow();
  }
});

test("deleted arrivals are skipped and provider authentication failures fail the poll", async () => {
  const urls = mailbox({
    historyId: "901",
    history: [{ messagesAdded: [{ message: { id: "a" } }] }],
  });
  const baseFetch = globalThis.fetch;
  let status = 404;
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) =>
    String(input).includes("/messages/")
      ? new Response(null, { status })
      : baseFetch(input, init)) as typeof fetch;
  const result = await pollNativeMail("token", {
    accountId: "111",
    cursor: "100",
  });
  expect(result.messages).toEqual([]);
  expect(result.cursor).toBe("901");
  expect(urls).toHaveLength(2);
  status = 401;
  await expect(
    pollNativeMail("token", { accountId: "111", cursor: "100" }),
  ).rejects.toMatchObject({ status: 401 });
});

test("notification headers are bounded plain text with no attachment or body request", async () => {
  mailbox({
    historyId: "901",
    history: [{ messagesAdded: [{ message: { id: "a" } }] }],
  });
  const baseFetch = globalThis.fetch;
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) =>
    String(input).includes("/messages/")
      ? Response.json({
          labelIds: ["INBOX", "UNREAD"],
          payload: { headers: [{ name: "Subject", value: "x".repeat(1000) }] },
        })
      : baseFetch(input, init)) as typeof fetch;
  const result = await pollNativeMail("token", {
    accountId: "111",
    cursor: "100",
  });
  expect(result.messages[0]).toEqual({
    id: "a",
    sender: "",
    subject: "x".repeat(256),
  });
  expect(Object.keys(result.messages[0]).sort()).toEqual([
    "id",
    "sender",
    "subject",
  ]);
});
