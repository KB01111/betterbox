import {
  GmailApiError,
  getInboxUnread,
  gmailFetch,
  withGmailBudget,
} from "./gmail/api.server";
import { ApiInputError, stringField } from "./request-security";

export type NativeMailInput = {
  accountId: string;
  cursor?: string;
  pageToken?: string;
};
export type NativeMailResult = {
  accountId: string;
  cursor: string;
  pageToken?: string;
  unread: number;
  reset: boolean;
  messages: { id: string; sender: string; subject: string }[];
  truncated?: boolean;
};
type Continuation = { v: 1; p?: string; o: number };
const TOKEN_CONTROLS = /\p{Cc}/u;
// Strip controls and directional formatting before native notification display.
const HEADER_CONTROLS = /[\p{Cc}\p{Cf}\u2028\u2029]+/gu;
type HistoryPage = {
  historyId?: string;
  nextPageToken?: string;
  history?: {
    messagesAdded?: { message?: { id?: string } }[];
    labelsAdded?: { message?: { id?: string }; labelIds?: string[] }[];
  }[];
};

function continuation(token?: string): Continuation {
  if (!token) return { v: 1, o: 0 };
  try {
    if (!/^[A-Za-z0-9_-]{1,4096}$/.test(token)) throw new Error();
    const value: unknown = JSON.parse(
      Buffer.from(token, "base64url").toString("utf8"),
    );
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    const { v, p, o } = value as Continuation;
    if (
      v !== 1 ||
      !Number.isSafeInteger(o) ||
      o < 0 ||
      o > 1_000_000 ||
      (p !== undefined &&
        (typeof p !== "string" ||
          !p.length ||
          p.length > 2000 ||
          TOKEN_CONTROLS.test(p)))
    )
      throw new Error();
    return { v, p, o };
  } catch {
    throw new ApiInputError(400, "Invalid pageToken");
  }
}

export function validateNativeMailInput(body: unknown): NativeMailInput {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new ApiInputError(400, "JSON object is required");
  const fields = body as Record<string, unknown>;
  const accountId = stringField(fields, "accountId", 200, true);
  const cursor = stringField(fields, "cursor", 40);
  const pageToken = stringField(fields, "pageToken", 4096);
  if (!/^[A-Za-z0-9_-]+$/.test(accountId))
    throw new ApiInputError(400, "Invalid accountId");
  if (cursor !== undefined && !/^[0-9]{1,40}$/.test(cursor))
    throw new ApiInputError(400, "Invalid cursor");
  if (pageToken !== undefined) {
    if (!cursor || !pageToken)
      throw new ApiInputError(400, "Invalid pageToken");
    continuation(pageToken);
  }
  return { accountId, cursor, pageToken };
}

const plainHeader = (value: string) =>
  value.replace(HEADER_CONTROLS, " ").replace(/\s+/g, " ").trim().slice(0, 256);

/** HTTP-only summaries: the caller keeps cursors and deduplication in memory. */
export async function pollNativeMail(
  token: string,
  input: NativeMailInput,
): Promise<NativeMailResult> {
  return withGmailBudget(async () => {
    const baseline = async (): Promise<NativeMailResult> => {
      const response = await gmailFetch(token, "/profile?fields=historyId");
      if (!response.ok) throw new GmailApiError(response.status);
      const profile = (await response.json()) as { historyId?: string };
      if (!profile.historyId || !/^[0-9]{1,40}$/.test(profile.historyId))
        throw new GmailApiError(502);
      return {
        accountId: input.accountId,
        cursor: profile.historyId,
        unread: await getInboxUnread(token),
        reset: true,
        messages: [],
      };
    };
    if (!input.cursor) return baseline();
    const resume = continuation(input.pageToken);
    const params = new URLSearchParams({
      startHistoryId: input.cursor,
      maxResults: "10",
      fields:
        "historyId,nextPageToken,history(messagesAdded/message/id,labelsAdded(message/id,labelIds))",
    });
    params.append("historyTypes", "messageAdded");
    params.append("historyTypes", "labelAdded");
    if (resume.p) params.set("pageToken", resume.p);
    const response = await gmailFetch(token, `/history?${params}`);
    if (response.status === 404) return baseline();
    if (!response.ok) throw new GmailApiError(response.status);
    const page = (await response.json()) as HistoryPage;
    if (!page.historyId || !/^[0-9]{1,40}$/.test(page.historyId))
      throw new GmailApiError(502);
    const ids = new Set<string>();
    for (const record of page.history ?? []) {
      for (const added of record.messagesAdded ?? [])
        if (added.message?.id) ids.add(added.message.id);
      for (const added of record.labelsAdded ?? [])
        if (added.labelIds?.includes("INBOX") && added.message?.id)
          ids.add(added.message.id);
    }
    const candidates = [...ids];
    const messages: NativeMailResult["messages"] = [];
    // One history page + ten metadata reads + unread = 12 calls (36 with retries).
    for (const id of candidates.slice(resume.o, resume.o + 10)) {
      const metadata = await gmailFetch(
        token,
        `/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&fields=labelIds,payload/headers`,
      );
      if (metadata.status === 404) continue;
      if (!metadata.ok) throw new GmailApiError(metadata.status);
      const message = (await metadata.json()) as {
        labelIds?: string[];
        payload?: { headers?: { name: string; value: string }[] };
      };
      const labels = message.labelIds ?? [];
      if (
        !labels.includes("INBOX") ||
        !labels.includes("UNREAD") ||
        labels.includes("TRASH") ||
        labels.includes("SPAM")
      )
        continue;
      const header = (name: string) =>
        plainHeader(
          message.payload?.headers?.find(
            (item) => item.name.toLowerCase() === name,
          )?.value ?? "",
        );
      messages.push({ id, sender: header("from"), subject: header("subject") });
    }
    const moreInPage = candidates.length > resume.o + 10;
    // Resume inside a large history record by refetching this page; never drop IDs.
    const next: Continuation | undefined = moreInPage
      ? { v: 1, p: resume.p, o: resume.o + 10 }
      : page.nextPageToken
        ? { v: 1, p: page.nextPageToken, o: 0 }
        : undefined;
    return {
      accountId: input.accountId,
      cursor: next ? input.cursor : page.historyId,
      ...(next
        ? {
            pageToken: Buffer.from(JSON.stringify(next)).toString("base64url"),
            truncated: true,
          }
        : {}),
      unread: await getInboxUnread(token),
      reset: false,
      messages,
    };
  });
}
