import { auth } from "@/lib/auth/auth";
import prisma from "@/lib/db/prisma.server";
import { getRuntimeConfig } from "@/lib/runtime.server";
import { isAllowedEmail } from "@/lib/runtime-config";
import { ApiInputError } from "@/lib/request-security";
import { getEmailAddress, GmailApiError } from "./api.server";

/** All Google accounts linked to the signed-in user. */
export async function listGoogleAccounts(headers: Headers) {
  const accounts = await auth.api.listUserAccounts({ headers });
  return accounts.filter((a) => a.providerId === "google");
}

/**
 * Fresh access token for one Google account. Pass `accountId` (the provider's
 * account id, i.e. Google's `sub` — the `accountId` column, not the record id)
 * to pick a specific linked account; omit it to use the user's default Google
 * account. Auto-refreshes via the stored refresh token.
 */
export async function getGoogleToken(
  headers: Headers,
  userId: string,
  accountId?: string,
) {
  const session = await auth.api.getSession({ headers });
  if (!session || session.user.id !== userId || !isAllowedEmail(getRuntimeConfig(), session.user.email)) throw new ApiInputError(403, "This mailbox is not available to this session.");
  if (accountId !== undefined && (typeof accountId !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(accountId))) throw new ApiInputError(400, "Invalid accountId");
  const account = await prisma.account.findFirst({ where: { userId, providerId: "google", ...(accountId ? { accountId } : {}) }, orderBy: { createdAt: "asc" }, select: { id: true, accountId: true, email: true } });
  if (!account || (account.email && !isAllowedEmail(getRuntimeConfig(), account.email))) throw new ApiInputError(403, "This mailbox is not available to this session.");
  let accessToken: string | undefined;
  try {
  ({ accessToken } = await auth.api.getAccessToken({
    body: { userId, accountId: account.id },
    headers,
  }));
  } catch { throw new GmailApiError(401); }
  if (!accessToken) throw new GmailApiError(401);
  // Older imported rows have no metadata: validate the live identity before
  // allowing any read or mutation, without storing Gmail message contents.
  if (!account.email && !isAllowedEmail(getRuntimeConfig(), await getEmailAddress(accessToken))) throw new ApiInputError(403, "Add this Gmail address to the instance access list before reconnecting it.");
  return accessToken;
}
