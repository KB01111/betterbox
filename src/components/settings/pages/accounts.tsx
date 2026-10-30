import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, PlusIcon, Unplug } from "lucide-react";
import { toast } from "sonner";

import {
  authClient,
  linkGithub,
  linkGoogle,
  useSession,
} from "@/lib/auth/auth-client";
import { type Account, canDisconnectGoogleAccount } from "@/lib/account";
import { accountsQueryKey } from "@/lib/mail-queries";
import { isTestAccount } from "@/lib/test-account";
import { setAccountColor, useSettings } from "@/hooks/use-settings";
import { GithubMark } from "@/components/integrations/github-mark";
import { ACCOUNT_COLORS } from "@/components/shell/account-dot";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Page, PageSection, SettingRow, SoonTag, Tag } from "../primitives";

function GithubIntegration() {
  const queryClient = useQueryClient();
  const linked = useQuery({
    queryKey: ["linked-accounts"],
    queryFn: async () => {
      const res = await authClient.listAccounts();
      return res.data ?? [];
    },
  });
  const githubAccount = (linked.data ?? []).find(
    (a) => a.providerId === "github",
  );
  const isLinked = !!githubAccount;
  const unlink = useMutation({
    mutationFn: async () => {
      if (!githubAccount) throw new Error("No GitHub account is connected");
      const result = await authClient.unlinkAccount({
        accountId: githubAccount.id,
      });
      if (result.error)
        throw new Error(
          "Could not disconnect GitHub. Sign in again and retry.",
        );
    },
    onError: () =>
      toast.error("Could not disconnect GitHub. Sign in again and retry."),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["linked-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["pull-requests"] });
    },
  });

  return (
    <SettingRow
      label="GitHub"
      description="Powers the Pull requests page, read-only PR access"
    >
      {linked.isLoading ? (
        <span className="font-mono text-xs text-muted-foreground/60">…</span>
      ) : isLinked ? (
        <Button
          variant="outline"
          size="sm"
          disabled={unlink.isPending}
          onClick={() => unlink.mutate()}
        >
          {unlink.isPending ? "Unlinking…" : "Unlink"}
        </Button>
      ) : (
        <Button variant="outline" size="sm" onClick={() => linkGithub()}>
          <GithubMark className="size-3.5" /> Connect
        </Button>
      )}
    </SettingRow>
  );
}

/** Unlinks in Better Auth only — Gmail is untouched and can be re-added later. */
function DisconnectAccountButton({ account }: { account: Account }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const label = account.email || account.accountId;

  const disconnect = useMutation({
    mutationFn: async () => {
      if (!account.recordId)
        throw new Error(
          "Refresh connected accounts before disconnecting this mailbox.",
        );
      return authClient.unlinkAccount({ accountId: account.recordId });
    },
    onSuccess: (res) => {
      if (res?.error) {
        toast.error("Couldn’t disconnect account", {
          description: res.error.message,
        });
        return;
      }
      queryClient.invalidateQueries({ queryKey: accountsQueryKey });
      queryClient.removeQueries({
        predicate: (query) => query.queryKey[1] === account.accountId,
      });
      queryClient.invalidateQueries({ queryKey: ["linked-accounts"] });
      toast.success(`Disconnected ${label}`);
      setOpen(false);
    },
    onError: (error) => {
      toast.error("Couldn’t disconnect account", {
        description: error instanceof Error ? error.message : String(error),
      });
    },
  });

  return (
    <>
      <Hint label="Disconnect account">
        <button
          type="button"
          aria-label={`Disconnect ${label}`}
          onClick={() => setOpen(true)}
          className="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground opacity-70 transition-opacity hover:bg-muted hover:text-destructive hover:opacity-100"
        >
          <Unplug className="size-4" />
        </button>
      </Hint>
      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Disconnect this account?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Disconnect{" "}
            <span className="font-mono text-foreground">{label}</span> from
            KB OneMail. Its inbox, labels, and sending stop showing up here.
            Nothing in Gmail changes, and you can reconnect it anytime.
          </p>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={disconnect.isPending}
              onClick={() => disconnect.mutate()}
              className="bg-label-red text-white hover:bg-label-red/90"
            >
              {disconnect.isPending ? "Disconnecting…" : "Disconnect"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function AccountsPage({ accounts }: { accounts: Account[] }) {
  const { data: session } = useSession();
  const { accountColors } = useSettings();
  const primaryEmail = session?.user.email;

  return (
    <Page>
      <PageSection title="Connected accounts">
        <div className="flex flex-col gap-2.5">
          {accounts.map((account, index) => {
            const activeIndex =
              (accountColors[account.accountId] ?? index) %
              ACCOUNT_COLORS.length;
            const isPrimary = account.email === primaryEmail;
            return (
              <div
                key={account.accountId}
                className="flex items-center gap-3 rounded-lg border px-3.5 py-2.5 transition-colors hover:bg-muted/20"
              >
                <p className="min-w-0 truncate font-mono text-[13px]">
                  {account.email || account.accountId}
                </p>
                {isPrimary && <Tag>Primary</Tag>}
                <div className="ml-auto flex shrink-0 items-center gap-3">
                  {/* biome-ignore lint/a11y/useSemanticElements: a visual swatch group; a <fieldset> would impose default form styling in the row. */}
                  <div
                    role="group"
                    aria-label={`Color for ${account.email}`}
                    className="flex gap-1.5"
                  >
                    {ACCOUNT_COLORS.map((color, colorIndex) => (
                      <Hint key={color.label} label={color.label}>
                        <button
                          type="button"
                          aria-pressed={activeIndex === colorIndex}
                          onClick={() =>
                            setAccountColor(account.accountId, colorIndex)
                          }
                          className={cn(
                            "size-4.5 rounded-full transition-shadow",
                            activeIndex === colorIndex &&
                              "ring-2 ring-foreground ring-offset-2 ring-offset-background",
                          )}
                          style={{ background: color.value }}
                        />
                      </Hint>
                    ))}
                  </div>
                  {/* Dummy mailboxes cannot replace a real Google sign-in identity. */}
                  {primaryEmail &&
                    !isTestAccount(account.accountId) &&
                    (!canDisconnectGoogleAccount(
                      accounts,
                      account.accountId,
                    ) ? (
                      <Hint label="Keep at least one Google sign-in account connected">
                        <span className="inline-flex size-7 shrink-0 items-center justify-center text-muted-foreground opacity-70">
                          <Lock className="size-4" />
                        </span>
                      </Hint>
                    ) : (
                      <DisconnectAccountButton account={account} />
                    ))}
                </div>
              </div>
            );
          })}
          <div>
            <Button variant="outline" size="sm" onClick={() => linkGoogle()}>
              <PlusIcon /> Add Google account
            </Button>
          </div>
        </div>
      </PageSection>

      <PageSection title="Native Gmail signatures">
        <SettingRow
          label="Import Gmail signature"
          description="Optional: grant basic Gmail settings access to the account you choose. Existing KB OneMail signatures need no extra permission."
        >
          <Button variant="outline" size="sm" onClick={() => linkGoogle(true)}>
            Grant signature access
          </Button>
        </SettingRow>
      </PageSection>

      <PageSection title="Integrations">
        <GithubIntegration />
        <div className="opacity-60">
          <SettingRow
            label="Linear"
            description="Pull issues and project updates into your inbox"
          >
            <SoonTag />
          </SettingRow>
        </div>
      </PageSection>
    </Page>
  );
}
