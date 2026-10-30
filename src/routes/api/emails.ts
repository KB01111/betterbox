import { auth } from "@/lib/auth/auth";
import { GMAIL_PAGE_SIZE, listRecentEmails, markAccountRead, markEmailsRead } from "@/lib/gmail/api.server";
import { getGoogleToken } from "@/lib/gmail/accounts.server";
import { json, jsonError } from "@/lib/json-response";
import { createFileRoute } from "@tanstack/react-router";
import { FOLDER_QUERY, toFolder } from "@/lib/folders";
import { ApiInputError, queryIdentifier, readJsonBody, identifierField, stringField } from "@/lib/request-security";

export const Route = createFileRoute("/api/emails")({ server: { handlers: {
  GET: async ({ request }: { request: Request }) => {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) return json({ error: "Not signed in" }, 401);
    const url = new URL(request.url);
    const accountId = queryIdentifier(url, "accountId", true);
    const requested = Number(url.searchParams.get("max")) || GMAIL_PAGE_SIZE;
    const max = Math.min(Math.max(Math.floor(requested), 1), GMAIL_PAGE_SIZE);
    const pageToken = stringField(Object.fromEntries(url.searchParams), "pageToken", 4096);
    const q = stringField(Object.fromEntries(url.searchParams), "q", 2000)?.trim();
    const accessToken = await getGoogleToken(request.headers, session.user.id, accountId);
    try {
      const page = await listRecentEmails(accessToken, max, pageToken, q || FOLDER_QUERY[toFolder(url.searchParams.get("folder"))]);
      return json({ accountId, count: page.emails.length, emails: page.emails, nextPageToken: page.nextPageToken ?? null });
    } catch (error) { return jsonError("list emails", error); }
  },
  POST: async ({ request }: { request: Request }) => {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) return json({ error: "Not signed in" }, 401);
    const body = await readJsonBody(request);
    const accountId = identifierField(body, "accountId", true);
    if (body.all !== undefined && typeof body.all !== "boolean") throw new ApiInputError(400, "Invalid all");
    const ids = body.ids;
    if (!body.all && (!Array.isArray(ids) || !ids.length || ids.length > 1000 || ids.some((id) => typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(id)))) throw new ApiInputError(400, "Provide between 1 and 1000 valid message ids");
    const token = await getGoogleToken(request.headers, session.user.id, accountId);
    try {
      let count: number;
      if (body.all) count = await markAccountRead(token);
      else { await markEmailsRead(token, ids as string[]); count = (ids as string[]).length; }
      return json({ ok: true, count, bounded: body.all === true });
    } catch (error) { return jsonError("mark emails read", error); }
  },
} } });
