import { auth } from "@/lib/auth/auth";
import prisma from "@/lib/db/prisma.server";
import {
  getEmailAddress,
  getInboxUnread,
  GmailApiError,
} from "@/lib/gmail/api.server";
import { getGoogleToken } from "@/lib/gmail/accounts.server";
import { json } from "@/lib/json-response";
import { queryIdentifier } from "@/lib/request-security";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/accounts")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session) return json({ error: "Not signed in" }, 401);
        const accountId = queryIdentifier(new URL(request.url), "accountId");
        if (accountId) {
          const token = await getGoogleToken(
            request.headers,
            session.user.id,
            accountId,
          );
          try {
            const [email, unread] = await Promise.all([
              getEmailAddress(token),
              getInboxUnread(token),
            ]);
            return json({
              account: { accountId, email, unread, status: "connected" },
            });
          } catch (error) {
            return json({
              account: {
                accountId,
                status:
                  error instanceof GmailApiError &&
                  [401, 403].includes(error.status)
                    ? "reconnect_required"
                    : "unavailable",
                error: "Could not refresh this mailbox. Retry or reconnect it.",
              },
            });
          }
        }
        // Listing linked identities never fans out into a Gmail request per account.
        const records = await prisma.account.findMany({
          where: { userId: session.user.id, providerId: "google" },
          select: { id: true, accountId: true, email: true },
          orderBy: { createdAt: "asc" },
        });
        const accounts = records.map((account) => ({
          recordId: account.id,
          accountId: account.accountId,
          email: account.email ?? "",
          unread: 0,
          status: account.email ? "connected" : "connecting",
        }));
        accounts.sort(
          (a, b) =>
            Number(b.email.toLowerCase() === session.user.email.toLowerCase()) -
            Number(a.email.toLowerCase() === session.user.email.toLowerCase()),
        );
        return json({ count: accounts.length, accounts });
      },
    },
  },
});
