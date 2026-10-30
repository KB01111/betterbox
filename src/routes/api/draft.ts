import { auth } from "@/lib/auth/auth";
import { findGmailDraftId, saveGmailDraft } from "@/lib/gmail/api.server";
import { getGoogleToken } from "@/lib/gmail/accounts.server";
import { json, jsonError } from "@/lib/json-response";
import {
  MAX_MAIL_JSON_BYTES,
  queryIdentifier,
  readJsonBody,
  validateOutgoing,
} from "@/lib/request-security";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/draft")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session) return json({ error: "Not signed in" }, 401);
        const url = new URL(request.url);
        const accountId = queryIdentifier(url, "accountId", true);
        const messageId = queryIdentifier(url, "messageId", true);
        try {
          const token = await getGoogleToken(
            request.headers,
            session.user.id,
            accountId,
          );
          if (!token) return json({ error: "No Google access token" }, 403);
          return json({ draftId: await findGmailDraftId(token, messageId) });
        } catch (error) {
          return jsonError("draft lookup", error);
        }
      },
      POST: async ({ request }: { request: Request }) => {
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session) return json({ error: "Not signed in" }, 401);
        const { accountId, ...message } = validateOutgoing(
          await readJsonBody(request, MAX_MAIL_JSON_BYTES),
        );
        try {
          const token = await getGoogleToken(
            request.headers,
            session.user.id,
            accountId,
          );
          if (!token) return json({ error: "No Google access token" }, 403);
          return json(await saveGmailDraft(token, message));
        } catch (error) {
          return jsonError("draft save", error);
        }
      },
    },
  },
});
