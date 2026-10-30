import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const METADATA_HEADERS = ["Subject", "From", "Date"];
export const GMAIL_PAGE_SIZE = 10;
const budgets = new AsyncLocalStorage<{ remaining: number; signal?: AbortSignal }>();
export function withGmailBudget<T>(run: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  return budgets.getStore() ? run() : budgets.run({ remaining: 40, signal }, run);
}
export class GmailApiError extends Error {
  constructor(public status: number) {
    super(status === 401 || status === 403 ? "Reconnect this Google account and grant Gmail access." : status === 429 ? "Gmail is rate limited. Wait before retrying." : "Gmail is temporarily unavailable. Retry this account.");
  }
}

export type Email = {
  id: string;
  from: string;
  subject: string;
  date: string;
  internalDate: number;
  starred: boolean;
  hasAttachment: boolean;
  snippet?: string;
  unread?: boolean;
  /** Never persisted. */
  labelIds?: string[];
};

export type GmailLabel = {
  id: string;
  name: string;
  type?: "system" | "user";
  color?: { backgroundColor?: string; textColor?: string };
};

export async function listLabels(accessToken: string): Promise<GmailLabel[]> {
  const res = await gmailFetch(accessToken, "/labels");
  if (!res.ok) throw new GmailApiError(res.status);
  const { labels = [] } = (await res.json()) as { labels?: GmailLabel[] };
  return labels;
}

export async function createLabel(
  accessToken: string,
  name: string,
): Promise<GmailLabel> {
  const res = await gmailFetch(accessToken, "/labels", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name,
      labelListVisibility: "labelShow",
      messageListVisibility: "show",
    }),
  });
  if (!res.ok) throw new GmailApiError(res.status);
  return (await res.json()) as GmailLabel;
}

export async function renameLabel(
  accessToken: string,
  id: string,
  name: string,
): Promise<GmailLabel> {
  const res = await gmailFetch(accessToken, `/labels/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new GmailApiError(res.status);
  return (await res.json()) as GmailLabel;
}

/** Deleting a label also strips it from every message (Gmail API side-effect). */
export async function deleteLabel(
  accessToken: string,
  id: string,
): Promise<void> {
  const res = await gmailFetch(accessToken, `/labels/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new GmailApiError(res.status);
}

export async function modifyMessageLabels(
  accessToken: string,
  id: string,
  add: string[],
  remove: string[],
): Promise<void> {
  const res = await gmailFetch(accessToken, `/messages/${id}/modify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ addLabelIds: add, removeLabelIds: remove }),
  });
  if (!res.ok) throw new GmailApiError(res.status);
}

export async function getEmailAddress(accessToken: string): Promise<string> {
  const res = await gmailFetch(accessToken, "/profile");
  if (!res.ok) throw new GmailApiError(res.status);
  const { emailAddress } = (await res.json()) as { emailAddress?: string };
  return emailAddress ?? "";
}

/** The account's native Gmail signature HTML (from sendAs settings; Gmail doesn't
 *  auto-append it to API sends). Prefers the identity matching `email`, else
 *  default/primary. Empty when unset. Needs gmail.settings.basic scope. */
export async function getGmailSignature(
  accessToken: string,
  email?: string,
): Promise<string> {
  const res = await gmailFetch(accessToken, "/settings/sendAs");
  if (!res.ok) return "";
  const { sendAs } = (await res.json()) as {
    sendAs?: {
      sendAsEmail?: string;
      signature?: string;
      isPrimary?: boolean;
      isDefault?: boolean;
    }[];
  };
  if (!sendAs?.length) return "";
  const match =
    (email &&
      sendAs.find(
        (s) => s.sendAsEmail?.toLowerCase() === email.toLowerCase(),
      )) ||
    sendAs.find((s) => s.isDefault) ||
    sendAs.find((s) => s.isPrimary) ||
    sendAs[0];
  return match?.signature?.trim() ?? "";
}

export async function getInboxUnread(accessToken: string): Promise<number> {
  const res = await gmailFetch(accessToken, "/labels/INBOX");
  if (!res.ok) throw new GmailApiError(res.status);
  const { messagesUnread } = (await res.json()) as { messagesUnread?: number };
  return messagesUnread ?? 0;
}

export async function listRecentEmails(
  accessToken: string,
  max = GMAIL_PAGE_SIZE,
  pageToken?: string,
  q?: string,
): Promise<{ emails: Email[]; nextPageToken?: string }> {
  return withGmailBudget(async () => {
  const { ids, nextPageToken } = await listMessageIds(
    accessToken,
    Math.min(Math.max(Math.floor(max) || GMAIL_PAGE_SIZE, 1), GMAIL_PAGE_SIZE),
    pageToken,
    q,
  );
  const emails = await mapPool(ids, 3, (id) => fetchEmail(accessToken, id));
  emails.sort((a, b) => b.internalDate - a.internalDate || a.id.localeCompare(b.id));
  return { emails, nextPageToken };
  });
}

export async function searchEmails(
  accessToken: string,
  q: string,
  max = GMAIL_PAGE_SIZE,
  pageToken?: string,
): Promise<{ emails: Email[]; nextPageToken?: string }> {
  return listRecentEmails(accessToken, max, pageToken, q);
}

export type Contact = { name: string; email: string };

/** People you've emailed before — recipients pulled from recent Sent messages,
 *  ranked by how often they appear. Powers the compose To autocomplete. */
export async function listContacts(accessToken: string): Promise<Contact[]> {
  const { ids } = await listMessageIds(accessToken, 10, undefined, "in:sent");
  const lists = await mapPool(ids, 3, (id) => fetchRecipients(accessToken, id));
  const byEmail = new Map<string, { name: string; email: string; n: number }>();
  for (const recipients of lists) {
    for (const r of recipients) {
      const key = r.email.toLowerCase();
      const hit = byEmail.get(key);
      if (hit) {
        hit.n++;
        if (!hit.name && r.name) hit.name = r.name;
      } else {
        byEmail.set(key, { name: r.name, email: r.email, n: 1 });
      }
    }
  }
  return [...byEmail.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, 100)
    .map(({ name, email }) => ({ name, email }));
}

async function fetchRecipients(
  accessToken: string,
  id: string,
): Promise<Contact[]> {
  const res = await gmailFetchOk(
    accessToken,
    `/messages/${id}?format=metadata&metadataHeaders=To&metadataHeaders=Cc`,
  );
  if (!res.ok) return [];
  const message = (await res.json()) as {
    payload?: { headers?: { name: string; value: string }[] };
  };
  const header = (name: string) =>
    message.payload?.headers?.find(
      (h) => h.name.toLowerCase() === name.toLowerCase(),
    )?.value ?? "";
  return [...parseAddressList(header("To")), ...parseAddressList(header("Cc"))];
}

function parseAddressList(raw: string): Contact[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((part) => {
      const angled = part.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/);
      if (angled) {
        return { name: angled[1].trim(), email: angled[2].trim() };
      }
      const bare = part.trim();
      return { name: "", email: bare };
    })
    .filter((c) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email));
}

async function listMessageIds(
  accessToken: string,
  max: number,
  pageToken?: string,
  q?: string,
): Promise<{ ids: string[]; nextPageToken?: string }> {
  const query =
    `/messages?maxResults=${max}&includeSpamTrash=true` +
    (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "") +
    (q ? `&q=${encodeURIComponent(q)}` : "");
  const res = await gmailFetch(accessToken, query);
  if (!res.ok) throw new GmailApiError(res.status);
  const { messages = [], nextPageToken } = (await res.json()) as {
    messages?: { id: string }[];
    nextPageToken?: string;
  };
  return { ids: messages.map((message) => message.id), nextPageToken };
}

async function fetchEmail(accessToken: string, id: string): Promise<Email> {
  const headers = METADATA_HEADERS.map((h) => `metadataHeaders=${h}`).join("&");
  const res = await gmailFetchOk(
    accessToken,
    `/messages/${encodeURIComponent(id)}?format=full&fields=id,internalDate,snippet,labelIds,payload(headers,filename,parts(filename,parts(filename,parts(filename))))&${headers}`,
  );
  if (!res.ok) {
    throw new GmailApiError(res.status);
  }
  const message = (await res.json()) as {
    snippet?: string;
    labelIds?: string[];
    internalDate?: string;
    payload?: MessagePart;
  };
  // Gmail keeps headers in sender-chosen casing, so match case-insensitively —
  // else some messages render as "(no subject)" with no sender.
  const header = (name: string) =>
    message.payload?.headers?.find(
      (h) => h.name.toLowerCase() === name.toLowerCase(),
    )?.value ?? "";

  return {
    id,
    from: header("From"),
    subject: header("Subject"),
    date: header("Date"),
    internalDate: Number(message.internalDate) || 0,
    starred: message.labelIds?.includes("STARRED") ?? false,
    hasAttachment: message.payload ? hasAttachmentPart(message.payload) : false,
    snippet: message.snippet
      ? decodeEntities(message.snippet)
      : message.snippet,
    unread: message.labelIds?.includes("UNREAD") ?? false,
    labelIds: message.labelIds ?? [],
  };
}

export type FullEmail = Email & {
  to: string;
  cc: string;
  bcc: string;
  replyTo: string;
  inReplyTo: string;
  messageId: string;
  /** Used to thread replies. */
  threadId: string;
  references: string;
  starred: boolean;
  labelIds: string[];
  hasAttachment: boolean;
  /** cid (Content-ID, sans angle brackets) → attachment, for inline
   *  <img src="cid:…"> images. */
  inlineAttachments: Record<string, InlineAttachment>;
  /** Named, downloadable attachments (excludes inline cid: images). */
  attachments: AttachmentMeta[];
  body: string;
  bodyHtml?: string;
};

type MessagePart = {
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: MessagePart[];
};

/** An inline (Content-ID) attachment — fetched on demand to render cid: images. */
export type InlineAttachment = { attachmentId: string; mimeType: string; filename?: string; size?: number; data?: string };

/** A named, downloadable attachment (the paperclip kind, not inline images). */
export type AttachmentMeta = {
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
  contentId?: string;
  data?: string;
};

type RawMessage = {
  id?: string;
  snippet?: string;
  labelIds?: string[];
  threadId?: string;
  internalDate?: string;
  payload?: MessagePart & { headers?: { name: string; value: string }[] };
};

function parseMessage(message: RawMessage): FullEmail {
  const header = (name: string) =>
    message.payload?.headers?.find(
      (h) => h.name.toLowerCase() === name.toLowerCase(),
    )?.value ?? "";

  return {
    id: message.id ?? "",
    from: header("From"),
    to: header("To"),
    cc: header("Cc"),
    bcc: header("Bcc"),
    replyTo: header("Reply-To"),
    inReplyTo: header("In-Reply-To"),
    subject: header("Subject"),
    date: header("Date"),
    internalDate: Number(message.internalDate) || 0,
    messageId: header("Message-ID"),
    threadId: message.threadId ?? "",
    references: header("References"),
    starred: message.labelIds?.includes("STARRED") ?? false,
    labelIds: message.labelIds ?? [],
    hasAttachment: message.payload ? hasAttachmentPart(message.payload) : false,
    inlineAttachments: message.payload ? collectInline(message.payload) : {},
    attachments: message.payload ? collectAttachments(message.payload) : [],
    snippet: message.snippet
      ? decodeEntities(message.snippet)
      : message.snippet,
    unread: message.labelIds?.includes("UNREAD") ?? false,
    ...extractBody(message.payload),
  };
}

/** True if any MIME part is a named attachment (has a filename). */
function hasAttachmentPart(part: MessagePart): boolean {
  if (part.filename && part.filename.length > 0) return true;
  return (part.parts ?? []).some(hasAttachmentPart);
}

/** Walk the MIME tree for parts with a Content-ID + fetchable attachmentId —
 *  these back <img src="cid:…"> inline images. */
function collectInline(
  part: MessagePart,
  out: Record<string, InlineAttachment> = {},
): Record<string, InlineAttachment> {
  const cid = part.headers?.find(
    (h) => h.name.toLowerCase() === "content-id",
  )?.value;
  if (cid && (part.body?.attachmentId || part.body?.data)) {
    const key = cid.trim().replace(/^<|>$/g, "");
    out[key] = {
      attachmentId: part.body.attachmentId ?? "",
      mimeType: part.mimeType ?? "application/octet-stream",
      filename: part.filename,
      size: part.body.size,
      data: part.body.data,
    };
  }
  for (const child of part.parts ?? []) collectInline(child, out);
  return out;
}

/** Walk the MIME tree for named downloadable attachments (filename + fetchable
 *  attachmentId). Skips inline images (those carry a Content-ID, rendered in the
 *  body rather than listed). */
function collectAttachments(
  part: MessagePart,
  out: AttachmentMeta[] = [],
): AttachmentMeta[] {
  const hasCid = part.headers?.some(
    (h) => h.name.toLowerCase() === "content-id",
  );
  if (part.filename && (part.body?.attachmentId || part.body?.data) && !hasCid) {
    out.push({
      attachmentId: part.body.attachmentId ?? "",
      filename: part.filename,
      mimeType: part.mimeType ?? "application/octet-stream",
      size: part.body.size ?? 0,
      data: part.body.data,
    });
  }
  for (const child of part.parts ?? []) collectAttachments(child, out);
  return out;
}

/** Raw bytes of one attachment (Gmail base64url-decoded). */
export async function getAttachment(
  accessToken: string,
  messageId: string,
  attachmentId: string,
): Promise<ArrayBuffer> {
  const res = await gmailFetch(
    accessToken,
    `/messages/${messageId}/attachments/${attachmentId}`,
  );
  if (!res.ok) throw new GmailApiError(res.status);
  const { data = "" } = (await res.json()) as { data?: string };
  const buf = Buffer.from(data, "base64url");
  return buf.buffer.slice(
    buf.byteOffset,
    buf.byteOffset + buf.byteLength,
  ) as ArrayBuffer;
}

export async function getFullEmail(
  accessToken: string,
  id: string,
): Promise<FullEmail> {
  const res = await gmailFetch(accessToken, `/messages/${id}?format=full`);
  if (!res.ok) throw new GmailApiError(res.status);
  return parseMessage(await res.json());
}

export async function getThread(
  accessToken: string,
  threadId: string,
): Promise<FullEmail[]> {
  const res = await gmailFetch(accessToken, `/threads/${threadId}?format=full`);
  if (!res.ok) throw new GmailApiError(res.status);
  const data = (await res.json()) as { messages?: RawMessage[] };
  return (data.messages ?? []).map(parseMessage);
}

function extractBody(payload?: MessagePart): {
  body: string;
  bodyHtml?: string;
} {
  if (!payload) return { body: "" };
  const html = findPart(payload, "text/html");
  const bodyHtml = html ? decodePart(html) : undefined;
  const plain = findPart(payload, "text/plain");
  const body = plain ? decodePart(plain) : bodyHtml ? stripHtml(bodyHtml) : "";
  return { body, bodyHtml };
}

function findPart(part: MessagePart, mimeType: string): MessagePart | null {
  if (part.mimeType === mimeType && part.body?.data) return part;
  for (const child of part.parts ?? []) {
    const found = findPart(child, mimeType);
    if (found) return found;
  }
  return null;
}

function decodePart(part: MessagePart): string {
  return Buffer.from(part.body?.data ?? "", "base64url").toString("utf8");
}

function stripHtml(html: string): string {
  return (
    html
      .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      // Table-heavy HTML leaves heavy indentation and blank runs — collapse
      // inline whitespace, trim lines, squeeze blank lines so exports aren't
      // mostly empty space.
      .split("\n")
      .map((line) => line.replace(/[ \t]+/g, " ").trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/** Decode HTML entities Gmail leaves in `snippet`. Regex-based (server + client):
 *  numeric refs first, then named, with `&amp;` last to avoid double-decoding. */
function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (m, h) => {
      const cp = parseInt(h, 16);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    })
    .replace(/&#(\d+);/g, (m, d) => {
      const cp = parseInt(d, 10);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    })
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export async function getRawEmail(
  accessToken: string,
  id: string,
): Promise<string> {
  const res = await gmailFetch(accessToken, `/messages/${id}?format=raw`);
  if (!res.ok) throw new GmailApiError(res.status);
  const { raw = "" } = (await res.json()) as { raw?: string };
  return Buffer.from(raw, "base64url").toString("utf8");
}

/** Outgoing message. `html` → multipart/alternative with plain-text fallback;
 *  inReplyTo/references/threadId thread it as a real reply. */
type OutgoingMessage = {
  draftId?: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  html?: string;
  inReplyTo?: string;
  references?: string;
  threadId?: string;
  attachments?: { filename: string; mimeType: string; contentBase64: string; contentId?: string }[];
};

/** Build the raw base64url MIME for a message — shared by send + draft save. */
async function buildRawMessage(
  accessToken: string,
  options: OutgoingMessage,
): Promise<string> {
  const from = await getEmailAddress(accessToken);
  if (!from) throw new Error("Could not resolve sender address");

  // Strip CR/LF so a value can't inject extra headers (e.g. a hidden Bcc).
  // Matters most for In-Reply-To/References, copied from the replied-to
  // message — attacker-controlled if they sent it.
  const headerSafe = (value: string) => value.replace(/[\r\n]+/g, " ").trim();

  const headerLines = [
    `From: ${headerSafe(from)}`,
    `To: ${headerSafe(options.to)}`,
    `Subject: ${encodeSubject(headerSafe(options.subject))}`,
    "MIME-Version: 1.0",
  ];
  // Cc is visible to every recipient (unlike Bcc); reply-all carries it over.
  if (options.cc?.trim())
    headerLines.splice(2, 0, `Cc: ${headerSafe(options.cc)}`);
  // Bcc: Gmail delivers then strips the header, keeping them hidden from To/Cc.
  if (options.bcc?.trim())
    headerLines.splice(2, 0, `Bcc: ${headerSafe(options.bcc)}`);
  // Threading headers nest the reply under the original conversation.
  if (options.inReplyTo)
    headerLines.push(`In-Reply-To: ${headerSafe(options.inReplyTo)}`);
  if (options.references)
    headerLines.push(`References: ${headerSafe(options.references)}`);

  // base64 the part bodies so UTF-8 (emoji, accents) survives intact.
  const b64 = (s: string) =>
    Buffer.from(s, "utf8")
      .toString("base64")
      .replace(/(.{76})/g, "$1\r\n");

  // Body as a single MIME part: text/plain, or multipart/alternative (plain +
  // html). `bodyType` is its Content-Type value; `bodyRest` is everything after.
  let bodyType: string;
  let bodyRest: string[];
  if (options.html?.trim()) {
    const text = options.body.trim() ? options.body : stripHtml(options.html);
    const altBoundary = `bbalt_${randomUUID()}`;
    bodyType = `multipart/alternative; boundary="${altBoundary}"`;
    bodyRest = [
      "",
      `--${altBoundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      b64(text),
      `--${altBoundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      b64(options.html),
      `--${altBoundary}--`,
    ];
  } else {
    bodyType = 'text/plain; charset="UTF-8"';
    bodyRest = ["Content-Transfer-Encoding: base64", "", b64(options.body)];
  }

  const attachments = options.attachments ?? [];
  let mime: string;
  if (attachments.length === 0) {
    mime = [...headerLines, `Content-Type: ${bodyType}`, ...bodyRest].join(
      "\r\n",
    );
  } else {
    // Wrap the body part and the attachments in a multipart/mixed envelope.
    const mixed = `bbmix_${randomUUID()}`;
    const lines = [
      ...headerLines,
      `Content-Type: multipart/mixed; boundary="${mixed}"`,
      "",
      `--${mixed}`,
      `Content-Type: ${bodyType}`,
      ...bodyRest,
    ];
    for (const att of attachments) {
      // Strip CR/LF/quotes from filename so it can't break out of the header;
      // keep only valid base64 chars, then wrap at 76 columns.
      const name = att.filename.replace(/[\r\n"]+/g, "_");
      const data = att.contentBase64
        .replace(/[^A-Za-z0-9+/=]/g, "")
        .replace(/(.{76})/g, "$1\r\n");
      lines.push(
        `--${mixed}`,
        `Content-Type: ${headerSafe(att.mimeType || "application/octet-stream")}; name="${name}"`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: ${att.contentId ? "inline" : "attachment"}; filename="${name}"`,
        ...(att.contentId ? [`Content-ID: <${headerSafe(att.contentId).replace(/[<>]/g, "")}>`] : []),
        "",
        data,
      );
    }
    lines.push(`--${mixed}--`);
    mime = lines.join("\r\n");
  }

  return Buffer.from(mime).toString("base64url");
}

/** Send a message: build the raw MIME, then hand it to Gmail. */
export async function sendEmail(
  accessToken: string,
  options: OutgoingMessage,
): Promise<void> {
  if (options.draftId) {
    await saveGmailDraft(accessToken, options);
    const sent = await gmailFetch(accessToken, "/drafts/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: options.draftId }) });
    if (!sent.ok) throw new GmailApiError(sent.status);
    return;
  }
  const raw = await buildRawMessage(accessToken, options);
  const payload: { raw: string; threadId?: string } = { raw };
  if (options.threadId) payload.threadId = options.threadId;
  const res = await gmailFetch(accessToken, "/messages/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new GmailApiError(res.status);
}

/** Create or update a Gmail draft. Returns draft + message ids so later autosaves
 *  UPDATE the same draft and the composer can trash it by message id. */
export async function saveGmailDraft(
  accessToken: string,
  options: OutgoingMessage & { draftId?: string },
): Promise<{ id: string; messageId: string }> {
  const raw = await buildRawMessage(accessToken, options);
  const message: { raw: string; threadId?: string } = { raw };
  if (options.threadId) message.threadId = options.threadId;
  const path = options.draftId ? `/drafts/${options.draftId}` : "/drafts";
  const res = await gmailFetch(accessToken, path, {
    method: options.draftId ? "PUT" : "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(
      options.draftId ? { id: options.draftId, message } : { message },
    ),
  });
  if (!res.ok) throw new GmailApiError(res.status);
  const data = (await res.json()) as { id: string; message?: { id: string } };
  return { id: data.id, messageId: data.message?.id ?? "" };
}

/** Resolve the Gmail draft id whose current message is `messageId`. Drafts are
 *  listed by message id, but updating one in place needs the draft id (a draft
 *  update re-mints the message id, so the mapping is only stable via this list).
 *  Null when no draft matches. */
export async function findGmailDraftId(
  accessToken: string,
  messageId: string,
): Promise<string | null> {
  // Cap the scan: a miss would otherwise page through the entire Drafts folder
  // on every composer-open. 10 pages × 100 = 1000 drafts; past that, give up
  // (the caller treats null as "leave the draft untouched").
  let pageToken: string | undefined;
  for (let page = 0; page < 10; page++) {
    const params = new URLSearchParams({
      maxResults: "100",
      fields: "drafts(id,message/id),nextPageToken",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await gmailFetch(accessToken, `/drafts?${params}`);
    if (!res.ok) throw new GmailApiError(res.status);
    const data = (await res.json()) as {
      drafts?: { id: string; message?: { id: string } }[];
      nextPageToken?: string;
    };
    const hit = data.drafts?.find((d) => d.message?.id === messageId);
    if (hit) return hit.id;
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return null;
}

export type MessageAction = "archive" | "trash" | "star" | "unstar" | "read" | "unread" | "restore" | "spam" | "unspam" | "inbox";

export async function actOnEmail(
  accessToken: string,
  id: string,
  action: MessageAction,
): Promise<void> {
  const labels = {
    archive: { removeLabelIds: ["INBOX"] }, star: { addLabelIds: ["STARRED"] }, unstar: { removeLabelIds: ["STARRED"] }, read: { removeLabelIds: ["UNREAD"] }, unread: { addLabelIds: ["UNREAD"] }, spam: { addLabelIds: ["SPAM"], removeLabelIds: ["INBOX"] }, unspam: { removeLabelIds: ["SPAM"], addLabelIds: ["INBOX"] }, inbox: { addLabelIds: ["INBOX"], removeLabelIds: ["SPAM", "TRASH"] },
  };
  const direct = action === "trash" || action === "restore";
  const path = `/messages/${encodeURIComponent(id)}/${action === "trash" ? "trash" : action === "restore" ? "untrash" : "modify"}`;
  const body = direct ? undefined : JSON.stringify(labels[action]);

  const res = await gmailFetch(accessToken, path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  if (!res.ok) throw new GmailApiError(res.status);
}

/** RFC 2047 encoded-word for non-ASCII subjects. */
function encodeSubject(subject: string): string {
  return /^[\x20-\x7e]*$/.test(subject)
    ? subject
    : `=?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`;
}

/** batchModify caps at 1000 ids. */
export async function markEmailsRead(
  accessToken: string,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return;
  const res = await gmailFetch(accessToken, "/messages/batchModify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ids: ids.slice(0, 1000),
      removeLabelIds: ["UNREAD"],
    }),
  });
  if (!res.ok) throw new GmailApiError(res.status);
}

/** Pages through all is:unread messages; capped at 10 000 to avoid hanging on a large mailbox. */
export async function markAccountRead(accessToken: string): Promise<number> {
  let total = 0;
  for (let page = 0; page < 15; page++) {
    const { ids } = await listMessageIds(
      accessToken,
      500,
      undefined,
      "is:unread",
    );
    if (ids.length === 0) break;
    await markEmailsRead(accessToken, ids);
    total += ids.length;
  }
  return total;
}

async function gmailFetch(accessToken: string, path: string, init?: RequestInit): Promise<Response> {
  const budget = budgets.getStore();
  const signal = budget?.signal ? AbortSignal.any([budget.signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000);
  const attempts = !init?.method || init.method === "GET" ? 3 : 1;
  for (let attempt = 0; ; attempt++) {
    if (budget) {
      if (budget.remaining <= 0) throw new GmailApiError(429);
      budget.remaining--;
    }
    const response = await fetch(`${GMAIL}${path}`, {
    ...init,
    signal,
    cache: "no-store",
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...init?.headers,
    },
    });
    if ((response.status !== 429 && response.status < 500) || attempt + 1 >= attempts) return response;
    const retryAfter = Number(response.headers.get("retry-after"));
    await response.body?.cancel();
    const delay = Math.min(2000, Math.max(250 * 2 ** attempt, Number.isFinite(retryAfter) ? retryAfter * 1000 : 0));
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(signal.reason); };
      const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, delay);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  }
}

/** gmailFetch that retries 429 / 5xx with backoff — burst rate-limit failures
 *  otherwise make list rows come back with no sender/subject. */
async function gmailFetchOk(
  accessToken: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return gmailFetch(accessToken, path, init);
}

async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}
