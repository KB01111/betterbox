import { afterEach, describe, expect, test } from "bun:test";
import { listRecentEmails, searchEmails, actOnEmail, saveGmailDraft, sendEmail } from "./api.server";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => handler(String(input), init)) as typeof fetch;
}

describe("bounded paged Gmail lists", () => {
  test("search carries independent page cursor and real internal timestamp", async () => {
    const urls: string[] = [];
    mockFetch((url) => {
      urls.push(url);
      if (url.includes("/messages?")) return Response.json({ messages: [{ id: "same-id" }], nextPageToken: "next-B" });
      return Response.json({ internalDate: "1780000000000", labelIds: ["STARRED", "UNREAD"], payload: { headers: [{name:"Date",value:"January 1, 2099"}, {name:"Subject",value:"Invoice"}] } });
    });
    const page = await searchEmails("token", "from:github.com", 10, "page-B");
    expect(page.nextPageToken).toBe("next-B");
    expect(page.emails[0].internalDate).toBe(1780000000000);
    expect(page.emails[0].starred).toBe(true);
    expect(urls[0]).toContain("pageToken=page-B");
    expect(urls[0]).toContain("from%3Agithub.com");
  });
  test("clamps a malicious page size below free subrequest limits", async () => {
    let calls = 0;
    mockFetch((url) => { calls++; if (url.includes("/messages?")) { const count = Number(new URL(url).searchParams.get("maxResults")); return Response.json({messages:Array.from({length:count},(_,i)=>({id:String(i)}))}); } return Response.json({internalDate:"1"}); });
    const page = await listRecentEmails("token", 999);
    expect(page.emails.length).toBeLessThanOrEqual(10);
    expect(calls).toBeLessThanOrEqual(11);
  });
  test("surfaces metadata failure instead of a fabricated empty message", async () => {
    mockFetch((url) => url.includes("/messages?") ? Response.json({messages:[{id:"a"}]}) : new Response("",{status:403}));
    await expect(listRecentEmails("token", 1)).rejects.toThrow();
  });
  test("includes spam/trash in folder searches", async () => {
    let requestURL = "";
    mockFetch((url) => { requestURL=url; return Response.json({messages:[]}); });
    await listRecentEmails("token", 10, undefined, "in:trash invoice");
    expect(requestURL).toContain("includeSpamTrash=true");
  });
});

test("read/unread and restoration modify the originating mailbox labels", async () => {
  const requests: {url:string; body:unknown}[] = [];
  mockFetch((url,init) => {requests.push({url,body:init?.body ? JSON.parse(String(init.body)) : null}); return Response.json({});});
  await actOnEmail("token", "id", "unread");
  await actOnEmail("token", "id", "restore");
  expect(requests[0].body).toEqual({addLabelIds:["UNREAD"]});
  expect(requests[1].url).toEndWith("/messages/id/untrash");
});

test("draft replacement preserves Bcc, attachments and reply headers", async () => {
  let raw = "";
  mockFetch((url,init) => {
    if (url.endsWith("/profile")) return Response.json({emailAddress:"sender@example.com"});
    const payload = JSON.parse(String(init?.body));
    raw = Buffer.from(payload.message.raw,"base64url").toString("utf8");
    return Response.json({id:"draft-A",message:{id:"message-A"}});
  });
  await saveGmailDraft("token", {draftId:"draft-A",to:"to@example.com",bcc:"hidden@example.com",subject:"Hello\r\nBcc: injected@example.com",body:"text",inReplyTo:"<reply-id>",references:"<reference>",attachments:[{filename:"report.txt",mimeType:"text/plain",contentBase64:"aGVsbG8="}]});
  expect(raw).toContain("Bcc: hidden@example.com");
  expect(raw).toContain("Content-Disposition: attachment; filename=\"report.txt\"");
  expect(raw).toContain("In-Reply-To: <reply-id>");
  expect(raw).not.toContain("\r\nBcc: injected@example.com");
});

test("sending a saved draft updates then sends that exact draft", async () => {
  const urls:string[]=[];
  mockFetch((url) => { urls.push(url); return Response.json(url.endsWith("/profile") ? {emailAddress:"sender@example.com"} : {id:"draft-A",message:{id:"m"}}); });
  await sendEmail("token",{draftId:"draft-A",to:"to@example.com",subject:"hello",body:"text"});
  expect(urls[1]).toEndWith("/drafts/draft-A");
  expect(urls[2]).toEndWith("/drafts/send");
  expect(urls.some((url)=>url.endsWith("/messages/send"))).toBe(false);
});
