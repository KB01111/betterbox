import { auth } from "@/lib/auth/auth";
import {
  actOnEmail,
  getAttachment,
  getFullEmail,
  getRawEmail,
  getThread,
  type MessageAction,
} from "@/lib/gmail/api.server";
import { getGoogleToken } from "@/lib/gmail/accounts.server";
import { json, jsonError } from "@/lib/json-response";
import {
  enumField,
  identifierField,
  queryIdentifier,
  readJsonBody,
  attachmentResponse,
} from "@/lib/request-security";
import { createFileRoute } from "@tanstack/react-router";

const ACTIONS = [
  "archive",
  "trash",
  "star",
  "unstar",
  "read",
  "unread",
  "restore",
  "spam",
  "unspam",
  "inbox",
] as const satisfies readonly MessageAction[];

export const Route = createFileRoute("/api/message")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session) return json({ error: "Not signed in" }, 401);
        const url = new URL(request.url);
        const accountId = queryIdentifier(url, "accountId", true);
        const thread = queryIdentifier(url, "thread");
        const id = queryIdentifier(url, "id");
        const attachment = queryIdentifier(url, "attachment");
        if (!thread && !id) return json({ error: "id is required" }, 400);
        try {
          const token = await getGoogleToken(
            request.headers,
            session.user.id,
            accountId,
          );
          if (!token) return json({ error: "No Google access token" }, 403);
          if (thread) return json({ messages: await getThread(token, thread) });
          if (attachment && id) {
            const bytes = await getAttachment(token, id, attachment);
            return attachmentResponse(
              bytes,
              url.searchParams.get("mime") ?? "",
              url.searchParams.get("download") === "1",
              url.searchParams.get("filename") ?? "attachment",
              url.searchParams.get("view") === "1",
            );
          }
          if (!id) return json({ error: "id is required" }, 400);
          if (url.searchParams.get("format") === "raw")
            return json({ raw: await getRawEmail(token, id) });
          return json({ email: await getFullEmail(token, id) });
        } catch (error) {
          return jsonError("read message", error);
        }
      },
      POST: async ({ request }: { request: Request }) => {
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session) return json({ error: "Not signed in" }, 401);
        const body = await readJsonBody(request);
        const accountId = identifierField(body, "accountId", true);
        const id = identifierField(body, "id", true);
        const action = enumField(body, "action", ACTIONS);
        try {
          const token = await getGoogleToken(
            request.headers,
            session.user.id,
            accountId,
          );
          if (!token) return json({ error: "No Google access token" }, 403);
          await actOnEmail(token, id, action);
          return json({ ok: true });
        } catch (error) {
          return jsonError("change message", error);
        }
      },
    },
  },
});
