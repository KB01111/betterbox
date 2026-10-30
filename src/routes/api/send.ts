import { auth } from "@/lib/auth/auth";
import { sendEmail } from "@/lib/gmail/api.server";
import { getGoogleToken } from "@/lib/gmail/accounts.server";
import { json, jsonError } from "@/lib/json-response";
import {
  MAX_MAIL_JSON_BYTES,
  readJsonBody,
  validateOutgoing,
} from "@/lib/request-security";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/send")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session) return json({ error: "Not signed in" }, 401);
        const { accountId, ...message } = validateOutgoing(
          await readJsonBody(request, MAX_MAIL_JSON_BYTES),
          true,
        );
        try {
          const token = await getGoogleToken(
            request.headers,
            session.user.id,
            accountId,
          );
          if (!token) return json({ error: "No Google access token" }, 403);
          await sendEmail(token, message);
          return json({ ok: true });
        } catch (error) {
          return jsonError("send message", error);
        }
      },
    },
  },
});
