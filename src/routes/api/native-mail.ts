import { auth } from "@/lib/auth/auth";
import { getGoogleToken } from "@/lib/gmail/accounts.server";
import { json, jsonError } from "@/lib/json-response";
import {
  pollNativeMail,
  validateNativeMailInput,
} from "@/lib/native-mail.server";
import { readJsonBody } from "@/lib/request-security";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/native-mail")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        try {
          const session = await auth.api.getSession({
            headers: request.headers,
          });
          if (!session)
            return json({ error: "Not signed in", code: "signed_out" }, 401);
          const input = validateNativeMailInput(
            await readJsonBody(request, 8192),
          );
          const token = await getGoogleToken(
            request.headers,
            session.user.id,
            input.accountId,
          );
          return json(await pollNativeMail(token, input));
        } catch (error) {
          return jsonError("native mail poll", error);
        }
      },
    },
  },
});
