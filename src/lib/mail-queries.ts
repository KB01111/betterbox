import {
  useInfiniteQuery,
  useQueries,
  useQuery,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";
import type { ThreadRowEmail } from "@/components/mail/thread-row";
import { type Account, mergeAccountProfile } from "@/lib/account";
import { FOLDER_QUERY, type Folder } from "@/lib/folders";
import { isSendingDisabled } from "@/hooks/use-settings";
import { createRequestLimiter } from "@/lib/unified-mail";
import {
  isTestAccount,
  makeTestEmails,
  makeTestFullEmail,
  makeTestRawEmail,
  markTestAccountRead,
  markTestEmailsRead,
  removeTestLabel,
  setTestEmailLabel,
  testLabelEmails,
  upsertTestDraft,
  deleteTestEmail,
} from "@/lib/test-account";

export type FullEmail = ThreadRowEmail & {
  to: string;
  /** Original Cc recipients (carried over by reply-all). Absent on demo mail. */
  cc?: string;
  bcc?: string;
  replyTo?: string;
  inReplyTo?: string;
  /** cid → inline attachment, for rendering <img src="cid:…">. Absent on demo mail. */
  inlineAttachments?: Record<
    string,
    {
      attachmentId: string;
      mimeType: string;
      filename?: string;
      size?: number;
      data?: string;
    }
  >;
  /** Named, downloadable attachments (the paperclip kind). */
  attachments?: {
    attachmentId: string;
    filename: string;
    mimeType: string;
    size: number;
    data?: string;
    contentId?: string;
  }[];
  messageId: string;
  threadId: string;
  references: string;
  starred: boolean;
  body: string;
  bodyHtml?: string;
};

export type MessageAction =
  | "archive"
  | "trash"
  | "star"
  | "unstar"
  | "read"
  | "unread"
  | "restore"
  | "spam"
  | "unspam"
  | "inbox";

// Never stored by BetterBox — only held in TanStack Query cache.
export type Label = {
  id: string;
  name: string;
  color?: { backgroundColor?: string; textColor?: string };
};

const TEST_LABELS: Label[] = [
  { id: "Label_vip", name: "VIP" },
  { id: "Label_receipts", name: "Receipts" },
  { id: "Label_followup", name: "Follow up" },
];

export class MailRequestError extends Error {
  constructor(
    message: string,
    public status: number,
    public retryAfter = 0,
  ) {
    super(message);
  }
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const rawDelay = res.headers.get("retry-after") ?? "";
    const delay = /^\d+$/.test(rawDelay)
      ? Number(rawDelay) * 1000
      : Math.max(0, Date.parse(rawDelay) - Date.now()) || 0;
    throw new MailRequestError(
      data.error ?? `HTTP ${res.status}`,
      res.status,
      Math.min(delay, 60_000),
    );
  }
  return data as T;
}

/**
 * Demo accounts resolve in one tick, making folder switches flash. A small
 * artificial latency lets the skeleton paint, so demo loads like a real inbox.
 */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const LIST_LATENCY_MS = 480;
const READ_LATENCY_MS = 260;

export const accountsQueryKey = ["accounts"] as const;

export type Contact = { name: string; email: string };

// Generic, non-personal stand-ins for the demo's compose autocomplete.
const DEMO_CONTACTS: Contact[] = [
  { name: "Alex Rivera", email: "alex.rivera@example.com" },
  { name: "Jordan Lee", email: "jordan@example.com" },
  { name: "Sam Patel", email: "sam.patel@example.com" },
  { name: "Taylor Kim", email: "taylor.kim@example.com" },
  { name: "Morgan Diaz", email: "morgan@example.dev" },
  { name: "Casey Nguyen", email: "casey.nguyen@example.com" },
  { name: "Riley Chen", email: "riley@example.dev" },
];

/** People you've emailed, for compose To autocomplete. Demo: static set; real:
 *  /api/contacts (Sent). */
export function useContactsQuery(
  accountId: string | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["contacts", accountId ?? "default"],
    enabled,
    staleTime: 30 * 60_000,
    queryFn: async (): Promise<Contact[]> => {
      if (accountId && isTestAccount(accountId)) return DEMO_CONTACTS;
      const params = accountId
        ? `?accountId=${encodeURIComponent(accountId)}`
        : "";
      const data = await fetchJson<{ contacts?: Contact[] }>(
        `/api/contacts${params}`,
      );
      return data.contacts ?? [];
    },
  });
}

export function useAccountsQuery(enabled: boolean, userId?: string) {
  const query = useQuery({
    queryKey: [...accountsQueryKey, userId ?? "current"],
    enabled,
    queryFn: async () => {
      const data = await fetchJson<{ accounts?: Account[] }>("/api/accounts");
      return data.accounts ?? [];
    },
  });
  const profiles = useQueries({
    queries: (query.data ?? []).map((account) => ({
      queryKey: ["account-profile", account.accountId, userId ?? "current"],
      enabled,
      staleTime: 60_000,
      retry: mailRetry,
      retryDelay: mailRetryDelay,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        limitMailRequest(async () => {
          const data = await fetchJson<{ account: Partial<Account> }>(
            `/api/accounts?${new URLSearchParams({ accountId: account.accountId })}`,
            { signal },
          );
          return data.account;
        }, signal),
    })),
  });
  return {
    ...query,
    data: query.data?.map((account, index) =>
      profiles[index]?.data
        ? mergeAccountProfile(account, profiles[index].data)
        : profiles[index]?.isError
          ? {
              ...account,
              status: "unavailable" as const,
              error: profiles[index].error?.message,
            }
          : account,
    ),
  };
}

// Folder listing and in-pane search use separate cache keys so toggling search doesn't clobber the folder list.
export const emailsQueryKey = (
  accountId: string,
  folder: Folder = "inbox",
  q?: string,
) =>
  q?.trim()
    ? (["emails-search", accountId, folder, q.trim()] as const)
    : (["emails", accountId, folder] as const);

export type EmailsPage = { emails: ThreadRowEmail[]; nextPageToken?: string };
export type EmailsData = InfiniteData<EmailsPage>;

const limitMailRequest = createRequestLimiter(3);
export const mailRetry = (count: number, error: Error) =>
  count < 2 &&
  (!(error instanceof MailRequestError) ||
    error.status === 429 ||
    error.status >= 500);
export const mailRetryDelay = (attempt: number, error: Error) =>
  Math.max(
    error instanceof MailRequestError ? error.retryAfter : 0,
    Math.min(1000 * 2 ** attempt, 10_000),
  );

export function fetchEmailsPage({
  accountId,
  folder,
  q,
  pageToken,
  signal,
  globalSearch = false,
}: {
  accountId: string;
  folder: Folder;
  q?: string;
  pageToken?: string;
  signal?: AbortSignal;
  globalSearch?: boolean;
}): Promise<EmailsPage> {
  return limitMailRequest(async () => {
    signal?.throwIfAborted();
    if (isTestAccount(accountId)) {
      await sleep(LIST_LATENCY_MS);
      signal?.throwIfAborted();
      const emails = makeTestEmails(accountId, folder).map((email) => ({
        ...email,
        internalDate: email.internalDate ?? Date.parse(email.date),
      }));
      const matches = q
        ? emails.filter((email) =>
            [email.subject, email.from, email.snippet ?? ""].some((field) =>
              field.toLowerCase().includes(q.toLowerCase()),
            ),
          )
        : emails;
      const offset = Number(pageToken ?? 0);
      return {
        emails: matches.slice(offset, offset + 10),
        nextPageToken:
          matches.length > offset + 10 ? String(offset + 10) : undefined,
      };
    }
    const params = new URLSearchParams({ accountId, max: "10" });
    if (q?.trim())
      params.set(
        "q",
        globalSearch ? q.trim() : `${FOLDER_QUERY[folder]} ${q.trim()}`,
      );
    else params.set("folder", folder);
    if (pageToken) params.set("pageToken", pageToken);
    const data = await fetchJson<{
      emails?: ThreadRowEmail[];
      nextPageToken?: string | null;
    }>(`/api/emails?${params}`, { signal });
    if (pageToken && data.nextPageToken === pageToken)
      throw new MailRequestError(
        "Gmail did not advance to the next page. Retry this account.",
        502,
      );
    return {
      emails: data.emails ?? [],
      nextPageToken: data.nextPageToken ?? undefined,
    };
  }, signal);
}

export function invalidateMailQueries(client: QueryClient, accountId: string) {
  void client.invalidateQueries({ queryKey: ["account-profile", accountId] });
  for (const prefix of [
    "emails",
    "emails-search",
    "emails-label",
    "email",
    "thread",
    "unified-mail",
  ]) {
    void client.invalidateQueries({ queryKey: [prefix, accountId] });
  }
  void client.invalidateQueries({ queryKey: accountsQueryKey });
}

export const flattenEmails = (data: EmailsData | undefined) =>
  data?.pages.flatMap((page) => page.emails);

// Search is scoped to the current folder: FOLDER_QUERY[folder] is AND-ed with the user's q.
export function useEmailsQuery(
  accountId: string,
  folder: Folder = "inbox",
  q?: string,
) {
  const search = q?.trim();
  return useInfiniteQuery({
    queryKey: emailsQueryKey(accountId, folder, search),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: EmailsPage) => last.nextPageToken ?? undefined,
    retry: mailRetry,
    retryDelay: mailRetryDelay,
    queryFn: ({ pageParam, signal }) =>
      fetchEmailsPage({
        accountId,
        folder,
        q: search,
        pageToken: pageParam,
        signal,
      }),
  });
}

export function useLabelEmailsQuery(
  accountId: string,
  label: Label,
  enabled: boolean,
) {
  return useInfiniteQuery({
    queryKey: ["emails-label", accountId, label.id],
    enabled,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: EmailsPage) => last.nextPageToken ?? undefined,
    retry: mailRetry,
    retryDelay: mailRetryDelay,
    queryFn: async ({ pageParam, signal }): Promise<EmailsPage> => {
      if (isTestAccount(accountId)) {
        await sleep(READ_LATENCY_MS);
        return { emails: testLabelEmails(accountId, label.id) };
      }
      return fetchEmailsPage({
        accountId,
        folder: "labeled",
        q: `label:"${label.name.replace(/["\\]/g, "\\$&")}"`,
        pageToken: pageParam,
        signal,
        globalSearch: true,
      });
    },
  });
}

export async function fetchFullEmail(
  accountId: string,
  emailId: string,
): Promise<FullEmail> {
  if (isTestAccount(accountId)) return makeTestFullEmail(accountId, emailId);
  const data = await fetchJson<{ email: FullEmail }>(
    `/api/message?accountId=${accountId}&id=${encodeURIComponent(emailId)}`,
  );
  return data.email;
}

export function useFullEmailQuery(accountId: string, emailId: string | null) {
  return useQuery({
    queryKey: ["email", accountId, emailId],
    enabled: emailId !== null,
    queryFn: async (): Promise<FullEmail> => {
      if (emailId === null) throw new Error("emailId is required");
      if (isTestAccount(accountId)) await sleep(READ_LATENCY_MS);
      return fetchFullEmail(accountId, emailId);
    },
  });
}

/** A draft continuing an existing thread (vs. a new message) — opened in the
 *  thread reader rather than the standalone composer. */
export function isReplyDraft(email: {
  id: string;
  threadId?: string;
  references?: string;
  subject?: string;
}): boolean {
  return (
    (!!email.threadId && email.threadId !== email.id) ||
    !!email.references?.trim() ||
    /^re:/i.test(email.subject ?? "")
  );
}

export function useThreadQuery(
  accountId: string,
  threadId: string | null | undefined,
) {
  return useQuery({
    queryKey: ["thread", accountId, threadId],
    enabled: !!threadId,
    queryFn: async (): Promise<FullEmail[]> => {
      if (!threadId) throw new Error("threadId is required");
      if (isTestAccount(accountId)) {
        await sleep(READ_LATENCY_MS);
        return [makeTestFullEmail(accountId, threadId)];
      }
      const data = await fetchJson<{ messages: FullEmail[] }>(
        `/api/message?accountId=${accountId}&thread=${encodeURIComponent(threadId)}`,
      );
      return data.messages ?? [];
    },
  });
}

export function useRawEmailQuery(
  accountId: string,
  emailId: string | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["email-raw", accountId, emailId],
    enabled: enabled && emailId !== null,
    queryFn: async (): Promise<string> => {
      if (emailId === null) throw new Error("emailId is required");
      if (isTestAccount(accountId)) {
        await sleep(READ_LATENCY_MS);
        return makeTestRawEmail(accountId, emailId);
      }
      const data = await fetchJson<{ raw: string }>(
        `/api/message?accountId=${accountId}&id=${encodeURIComponent(emailId)}&format=raw`,
      );
      return data.raw;
    },
  });
}

export const labelsQueryKey = (accountId: string) =>
  ["labels", accountId] as const;

export function labelsQueryOptions(accountId: string) {
  return {
    queryKey: labelsQueryKey(accountId),
    queryFn: async (): Promise<Label[]> => {
      if (isTestAccount(accountId)) return TEST_LABELS;
      const data = await fetchJson<{
        labels?: {
          id: string;
          name: string;
          type?: string;
          color?: Label["color"];
        }[];
      }>(`/api/labels?accountId=${accountId}`);
      return (data.labels ?? [])
        .filter((label) => label.type === "user")
        .map(({ id, name, color }) => ({ id, name, color }));
    },
  };
}

export function useLabelsQuery(accountId: string) {
  return useQuery(labelsQueryOptions(accountId));
}

/** Labels across accounts, deduped by name (case-insensitive). */
export function useAccountsLabels(accountIds: string[]): Label[] {
  const results = useQueries({ queries: accountIds.map(labelsQueryOptions) });
  const seen = new Set<string>();
  const merged: Label[] = [];
  for (const result of results) {
    for (const label of result.data ?? []) {
      const key = label.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(label);
    }
  }
  return merged;
}

export async function createLabel(
  accountId: string,
  name: string,
): Promise<Label> {
  if (isTestAccount(accountId)) {
    return { id: `Label_${name.replace(/\s+/g, "_")}_${name.length}`, name };
  }
  const data = await fetchJson<{ label: Label }>("/api/labels", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accountId, op: "create", name }),
  });
  return data.label;
}

export async function renameLabel(
  accountId: string,
  labelId: string,
  name: string,
) {
  if (isTestAccount(accountId)) return;
  await fetchJson("/api/labels", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accountId, op: "rename", labelId, name }),
  });
}

export async function deleteLabel(accountId: string, labelId: string) {
  if (isTestAccount(accountId)) {
    removeTestLabel(accountId, labelId);
    return;
  }
  await fetchJson("/api/labels", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accountId, op: "delete", labelId }),
  });
}

export async function setEmailLabel(
  accountId: string,
  id: string,
  labelId: string,
  on: boolean,
) {
  if (isTestAccount(accountId)) {
    setTestEmailLabel(accountId, id, labelId, on);
    return;
  }
  await fetchJson("/api/labels", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      accountId,
      op: on ? "apply" : "remove",
      id,
      labelId,
    }),
  });
}

export async function sendNewEmail(options: {
  accountId: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  html?: string;
  inReplyTo?: string;
  references?: string;
  threadId?: string;
  draftId?: string;
  attachments?: {
    filename: string;
    mimeType: string;
    contentBase64: string;
    contentId?: string;
  }[];
}) {
  if (isTestAccount(options.accountId)) return { simulated: true };
  // Owner "Simulate send": resolve as success without hitting Gmail. The short
  // delay keeps the composer's "Sending…" state visible so the demo looks real.
  if (isSendingDisabled()) {
    await new Promise((resolve) => setTimeout(resolve, 600));
    return { simulated: true };
  }
  await fetchJson("/api/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(options),
  });
  return { simulated: false };
}

/** Save composer content to the same Gmail draft, without storing mail locally. */
export async function saveDraft(opts: {
  accountId: string;
  id?: string;
  /** Existing Gmail draft id — updates that draft instead of creating a new one. */
  draftId?: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  html: string;
  threadId?: string;
  inReplyTo?: string;
  references?: string;
  attachments?: {
    filename: string;
    mimeType: string;
    contentBase64: string;
    contentId?: string;
  }[];
}): Promise<{ draftId: string; messageId: string } | null> {
  if (isTestAccount(opts.accountId)) {
    const id = upsertTestDraft(opts);
    return { draftId: id, messageId: id };
  }
  try {
    const res = await fetchJson<{ id: string; messageId: string }>(
      "/api/draft",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accountId: opts.accountId,
          draftId: opts.draftId,
          to: opts.to,
          cc: opts.cc,
          bcc: opts.bcc,
          subject: opts.subject,
          html: opts.html,
          threadId: opts.threadId,
          inReplyTo: opts.inReplyTo,
          references: opts.references,
          attachments: opts.attachments,
        }),
      },
    );
    return { draftId: res.id, messageId: res.messageId };
  } catch {
    return null;
  }
}

/** Resolve the Gmail draft id behind an opened draft's message id so edits
 *  update it in place. Test accounts key drafts by message id directly. Null on
 *  any failure — the caller falls back to leaving the draft untouched. */
export async function resolveDraftId(
  accountId: string,
  messageId: string,
): Promise<string | null> {
  if (isTestAccount(accountId)) return messageId;
  try {
    const params = new URLSearchParams({ accountId, messageId });
    const res = await fetchJson<{ draftId: string | null }>(
      `/api/draft?${params}`,
    );
    return res.draftId;
  } catch {
    return null;
  }
}

/** Delete a draft so it leaves Drafts. Demo: drop from store. Real: trash the
 *  message (we don't track the Gmail draft id yet, but trashing removes it). */
export async function deleteDraft(accountId: string, emailId: string) {
  if (isTestAccount(accountId)) {
    deleteTestEmail(emailId);
    return;
  }
  await actOnEmail(accountId, emailId, "trash");
}

export async function actOnEmail(
  accountId: string,
  id: string,
  action: MessageAction,
) {
  if (isTestAccount(accountId)) return;
  await fetchJson("/api/message", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accountId, id, action }),
  });
}

export async function markEmailsRead(accountId: string, ids: string[]) {
  if (ids.length === 0) return;
  if (isTestAccount(accountId)) {
    markTestEmailsRead(ids);
    return;
  }
  await fetchJson(`/api/emails`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accountId, ids }),
  });
}

export async function markAllAccountRead(accountId: string) {
  if (isTestAccount(accountId)) {
    markTestAccountRead(accountId);
    return;
  }
  await fetchJson(`/api/emails`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accountId, all: true }),
  });
}
