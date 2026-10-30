import { isTestAccount } from "./test-account";

export function canDisconnectGoogleAccount(
  accounts: Account[],
  accountId: string,
): boolean {
  return (
    !isTestAccount(accountId) &&
    accounts.filter((account) => !isTestAccount(account.accountId)).length > 1
  );
}

/** A connected Gmail account as returned by GET /api/accounts. */
export type Account = {
  accountId: string;
  recordId?: string;
  email: string;
  unread: number;
  status?: "connecting" | "connected" | "reconnect_required" | "unavailable";
  error?: string;
};

/** A failed profile/count refresh must not erase the verified linked identity. */
export function mergeAccountProfile(
  account: Account,
  profile: Partial<Account>,
): Account {
  return {
    ...account,
    ...profile,
    accountId: account.accountId,
    recordId: account.recordId,
    email: profile.email?.trim() || account.email,
  };
}
