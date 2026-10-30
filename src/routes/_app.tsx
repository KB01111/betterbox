import {
  createFileRoute,
  Navigate,
  Outlet,
  redirect,
  useLocation,
  useMatchRoute,
  useNavigate,
} from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MailIcon, PenLineIcon, SearchIcon } from "lucide-react";
import { useAccountScope } from "@/hooks/use-account-scope";
import { useIsMobile } from "@/hooks/use-mobile";
import type { Account } from "@/lib/account";
import {
  updateSettings,
  useApplyAccent,
  useSettings,
} from "@/hooks/use-settings";
import {
  accountsQueryKey,
  fetchFullEmail,
  invalidateMailQueries,
  markAllAccountRead,
  useAccountsQuery,
} from "@/lib/mail-queries";
import { toFolder, type Folder } from "@/lib/folders";
import { makeDemoAccounts, makeTestAccount } from "@/lib/test-account";
import { useSession } from "@/lib/auth/auth-client";
import { fetchSession } from "@/lib/auth/auth-session";
import { ComposerOpenGuard } from "@/lib/composer-open";
import { draftReplyContext } from "@/lib/email/reply";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { CommandMenu } from "@/components/shell/command-menu";
import {
  Composer,
  plainToHtml,
  type ComposerContent,
  type ReplyContext,
} from "@/components/editor/composer";
import {
  InboxTiles,
  panelPaneId,
  type Reading,
} from "@/components/mail/inbox-tiles";
import {
  MailViewSwitch,
  UnifiedMailbox,
} from "@/components/mail/unified-mailbox";
import {
  fetchDraftAttachments,
  type StagedFile,
} from "@/components/editor/composer-attachments";
import { SEARCH_INBOX_EVENT, type SearchInboxDetail } from "@/lib/layout-tree";
import { toast } from "sonner";
import {
  SettingsDialog,
  type PageId,
} from "@/components/settings/settings-dialog";
import {
  OPEN_SNIPPET_DRAFT_EVENT,
  type OpenSnippetDraftDetail,
} from "@/hooks/use-snippets";
import { SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import {
  desktopAction,
  desktopBridge,
  desktopRequest,
  DESKTOP_ACTION_EVENT,
  DESKTOP_REFRESH_EVENT,
  DESKTOP_QUIT_EVENT,
  reportDesktopLifecycle,
  type ComposeActivation,
  canActivateDesktopCompose,
} from "@/lib/auth/desktop-bridge";

export const Route = createFileRoute("/_app")({
  ssr: false,
  // Resolve session in a cached loader, not beforeLoad (which re-runs every nav,
  // adding a 2-5s remote-DB round-trip per open/switch). Loader resolves once for
  // first paint + auth guard; client useSession() gives live updates after.
  loader: async () => {
    const session = await fetchSession();
    // Self-hosted has no marketing layer: unauthenticated → sign-in, not landing.
    if (!session) {
      throw redirect({ to: "/sign-in" });
    }
    return { session };
  },
  staleTime: Infinity,
  component: AppShell,
});

const FOLDER_PATH = {
  inbox: "/",
  unread: "/unread",
  starred: "/starred",
  labeled: "/labeled",
  sent: "/sent",
  drafts: "/drafts",
  archived: "/archived",
  spam: "/spam",
  trash: "/trash",
} as const satisfies Record<Folder, string>;

const PATH_FOLDER: Record<string, Folder> = {
  "/": "inbox",
  "/unread": "unread",
  "/starred": "starred",
  "/labeled": "labeled",
  "/sent": "sent",
  "/drafts": "drafts",
  "/archived": "archived",
  "/spam": "spam",
  "/trash": "trash",
};

const DEV_PATHS = new Set(["/pull-requests", "/webhooks", "/api"]);

const EMPTY_COMPOSE: ComposerContent = {
  fromId: null,
  to: "",
  cc: "",
  bcc: "",
  subject: "",
  body: "",
  reply: null,
};

function AppShell() {
  useApplyAccent();
  const isMobile = useIsMobile();
  const { devTools, demoMode, composerMode, mailView } = useSettings();
  // Use the loader's session until the client query settles, so the auth branch
  // is correct on the very first paint.
  const { session: serverSession } = Route.useLoaderData();
  const { data: clientSession, isPending } = useSession();
  const session = isPending ? serverSession : clientSession;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const matchRoute = useMatchRoute();
  const location = useLocation();
  const [cmdOpen, setCmdOpen] = useState(false);
  const { data: accounts } = useAccountsQuery(!!session, session?.user.id);
  const [globalSearch, setGlobalSearch] = useState("");
  const [testAccounts, setTestAccounts] = useState<Account[]>([]);

  // Fresh sign-in: the OAuth callback lands here once a session exists.
  // Invalidate ["accounts"] so the linked primary inbox refetches even if
  // something cached an empty list.
  const signedInUserId = session?.user?.id;
  const previousUser = useRef(signedInUserId);
  const currentUser = useRef(signedInUserId);
  currentUser.current = signedInUserId;
  const composerOpenGuard = useRef(new ComposerOpenGuard());
  const addTestAccount = useCallback(() => {
    setTestAccounts((current) => [
      ...current,
      makeTestAccount(current.length + 1),
    ]);
  }, []);

  const isOwner = session?.user.role === "OWNER";
  const onAddTestAccount = isOwner && devTools ? addTestAccount : undefined;

  /* Gated on demoMode alone, not isOwner: reading session role here would flip
     back to real mail for the split second useSession() re-pends. */
  const demoAccounts = useMemo(() => makeDemoAccounts(), []);
  const demo = demoMode;
  const allAccounts = useMemo(() => {
    if (demo) return demoAccounts;
    return accounts === undefined ? null : [...accounts, ...testAccounts];
  }, [demo, demoAccounts, accounts, testAccounts]);
  const accountIds = useMemo(
    () => (allAccounts ?? []).map((account) => account.accountId),
    [allAccounts],
  );
  const { scopeIds, allOn, toggle, only } = useAccountScope(accountIds);
  const scopedAccounts = useMemo(
    () => (allAccounts ?? []).filter((a) => scopeIds.includes(a.accountId)),
    [allAccounts, scopeIds],
  );

  /* The reader is URL state (/email/$id?account=… — deep-linkable, docks as a
     pane). Settings stays a local overlay: routing it would reset folder to
     inbox and close the reader. */
  const emailMatch = matchRoute({ to: "/email/$id" });
  const search = location.search as { account?: string; folder?: string };
  const reading: Reading | null =
    emailMatch && search.account
      ? { accountId: search.account, emailId: emailMatch.id }
      : null;
  const [settingsOpen, setSettingsOpen] = useState(false);
  // ⌘K can deep-link Settings to a specific page (Manage snippets / signatures).
  const [settingsPage, setSettingsPage] = useState<PageId | undefined>(
    undefined,
  );
  // Composer "Save as snippet" hands a body here → open Settings/Snippets pre-filled.
  const [snippetDraft, setSnippetDraft] = useState<string | null>(null);
  useEffect(() => {
    const onDraft = (event: Event) => {
      const detail = (event as CustomEvent<OpenSnippetDraftDetail>).detail;
      if (!detail?.text) return;
      setSnippetDraft(detail.text);
      setSettingsOpen(true);
    };
    window.addEventListener(OPEN_SNIPPET_DRAFT_EVENT, onDraft);
    return () => window.removeEventListener(OPEN_SNIPPET_DRAFT_EVENT, onDraft);
  }, []);
  // Integration panels (GitHub PRs, …) the user has dropped onto the board.
  const [openPanels, setOpenPanels] = useState<string[]>([]);
  const togglePanel = useCallback(
    (key: string) =>
      setOpenPanels((panels) =>
        panels.includes(key)
          ? panels.filter((k) => k !== key)
          : [...panels, key],
      ),
    [],
  );
  const closePanelPane = useCallback(
    (paneId: string) =>
      setOpenPanels((panels) =>
        panels.filter((k) => panelPaneId(k) !== paneId),
      ),
    [],
  );

  const folder: Folder = emailMatch
    ? toFolder(search.folder)
    : (PATH_FOLDER[location.pathname] ?? "inbox");
  const folderSearch = folder === "inbox" ? {} : { folder };

  const onDevPage = DEV_PATHS.has(location.pathname);

  // biome-ignore lint/correctness/useExhaustiveDependencies: folderSearch is derived from folder; depend on folder so the link rebuilds when the folder changes.
  const openEmail = useCallback(
    (accountId: string, emailId: string) =>
      navigate({
        to: "/email/$id",
        params: { id: emailId },
        search: { account: accountId, ...folderSearch },
      }),
    [navigate, folder],
  );
  const closeReader = useCallback(
    () => navigate({ to: FOLDER_PATH[folder] }),
    [navigate, folder],
  );
  const openFolder = useCallback(
    (next: Folder) => {
      setGlobalSearch("");
      return navigate({ to: FOLDER_PATH[next] });
    },
    [navigate],
  );
  const openSettings = useCallback((page?: PageId) => {
    // Some callers wire this straight to a click handler (NavUser, sidebar via
    // `after`), forwarding a DOM event — only honour a real page string.
    setSettingsPage(typeof page === "string" ? page : undefined);
    setSettingsOpen(true);
  }, []);
  // ⌘K "Open GitHub …" — add the panel to the board (no-op if already open).
  const openPanel = useCallback((key: string) => {
    updateSettings({ mailView: "board" });
    setOpenPanels((panels) =>
      panels.includes(key) ? panels : [...panels, key],
    );
  }, []);

  const [composeOpen, setComposeOpen] = useState(false);
  const [draftOpening, setDraftOpening] = useState(false);
  const [pendingActivations, setPendingActivations] = useState<
    ComposeActivation[]
  >([]);
  const pendingActivation = pendingActivations[0];
  const [activationSaving, setActivationSaving] = useState(false);
  const activateCompose = useCallback((payload: ComposeActivation) => {
    if (!canActivateDesktopCompose(composerOpenGuard.current)) {
      toast("Wait for the current draft to finish opening.");
      return;
    }
    nativeState.current.composeOpen = true;
    setComposeContent({
      ...EMPTY_COMPOSE,
      ...payload,
      body: plainToHtml(payload.body ?? ""),
    });
    setDraftRef(null);
    setComposeOpen(true);
    setPendingActivations((queue) => queue.slice(1));
  }, []);
  /* Composer fields live here (not in Composer) so they survive remounts:
     pane↔popout switches, or pages where the compose pane isn't mounted. */
  const [composeContent, setComposeContent] =
    useState<ComposerContent>(EMPTY_COMPOSE);
  const patchComposeContent = useCallback(
    (patch: Partial<ComposerContent>) =>
      setComposeContent((current) => ({ ...current, ...patch })),
    [],
  );
  // A draft being edited (opened from the Drafts folder).
  const [draftRef, setDraftRef] = useState<{
    accountId: string;
    emailId: string;
  } | null>(null);
  const nativeState = useRef({ composeOpen, booting: true, pending: false });
  nativeState.current = {
    composeOpen,
    pending: pendingActivations.length > 0,
    booting:
      isPending || allAccounts === null || composerOpenGuard.current.pending,
  };
  const nativeActions = useRef({ openSettings, openFolder, activateCompose });
  nativeActions.current = { openSettings, openFolder, activateCompose };
  useEffect(() => {
    if (!desktopBridge("lifecycle")) return;
    const handle = (event: Event) => {
      const action = desktopAction((event as CustomEvent).detail);
      if (!action) return;
      if (action.kind === "compose") {
        if (
          nativeState.current.composeOpen ||
          nativeState.current.booting ||
          nativeState.current.pending ||
          composerOpenGuard.current.pending
        )
          setPendingActivations((queue) => [...queue, action.payload]);
        else nativeActions.current.activateCompose(action.payload);
      } else if (action.kind === "settings")
        nativeActions.current.openSettings("desktop");
      else if (action.kind === "inbox")
        void nativeActions.current.openFolder("inbox");
      else if (action.kind === "refresh")
        window.dispatchEvent(new Event(DESKTOP_REFRESH_EVENT));
      else if (action.kind === "quit-request") {
        if (nativeState.current.composeOpen)
          window.dispatchEvent(
            new CustomEvent(DESKTOP_QUIT_EVENT, {
              detail: { requestId: action.requestId },
            }),
          );
        else
          void desktopRequest("quit-response", {
            requestId: action.requestId,
            allow:
              !nativeState.current.booting &&
              !composerOpenGuard.current.pending,
          }).catch(() => {});
      }
    };
    window.addEventListener(DESKTOP_ACTION_EVENT, handle);
    // The native side keeps activations queued until this acknowledgement.
    reportDesktopLifecycle(true, false);
    void desktopRequest("ready", {}).catch(() => {});
    return () => window.removeEventListener(DESKTOP_ACTION_EVENT, handle);
  }, []);
  useEffect(() => {
    if (!composeOpen)
      reportDesktopLifecycle(
        isPending || allAccounts === null || draftOpening,
        false,
      );
  }, [composeOpen, isPending, allAccounts, draftOpening]);
  useEffect(() => {
    if (previousUser.current !== signedInUserId) {
      composerOpenGuard.current.cancel();
      composeContent.draftSession?.cancel();
      void queryClient.cancelQueries();
      queryClient.clear();
      setTestAccounts([]);
      setComposeContent(EMPTY_COMPOSE);
      setComposeOpen(false);
      setDraftRef(null);
      previousUser.current = signedInUserId;
    }
  }, [signedInUserId, queryClient, composeContent.draftSession]);
  useEffect(() => {
    if (signedInUserId)
      void queryClient.invalidateQueries({ queryKey: accountsQueryKey });
  }, [signedInUserId, queryClient]);
  const openCompose = useCallback(() => {
    if (composeOpen || composerOpenGuard.current.pending) {
      toast("Close or send the current message before starting another.");
      return;
    }
    setComposeContent(EMPTY_COMPOSE);
    setDraftRef(null);
    setComposeOpen(true);
  }, [composeOpen]);
  const editDraft = useCallback(
    async (accountId: string, emailId: string) => {
      if (composeOpen || composerOpenGuard.current.pending) {
        toast("Close the current message before opening another draft.");
        return;
      }
      const ticket = composerOpenGuard.current.begin(signedInUserId);
      if (!ticket) return;
      setDraftOpening(true);
      reportDesktopLifecycle(true, false);
      const loadingToast = toast.loading("Opening draft…");
      try {
        const full = await fetchFullEmail(accountId, emailId);
        const attachments = await fetchDraftAttachments(accountId, full);
        if (!composerOpenGuard.current.canCommit(ticket, currentUser.current))
          return;
        // Seed the composer from the draft (the fetch already happened here).
        setComposeContent({
          fromId: accountId,
          to: full.to ?? "",
          cc: full.cc ?? "",
          bcc: full.bcc ?? "",
          subject:
            !full.subject || full.subject === "(no subject)"
              ? ""
              : full.subject,
          body: full.bodyHtml ?? (full.body ? plainToHtml(full.body) : ""),
          reply: draftReplyContext(full),
          attachments,
        });
        setDraftRef({ accountId, emailId });
        setComposeOpen(true);
        return;
      } catch (error) {
        if (!composerOpenGuard.current.canCommit(ticket, currentUser.current))
          return;
        toast.error("Could not open draft", {
          description:
            error instanceof Error
              ? error.message
              : "Try again. Your Gmail draft is unchanged.",
        });
      } finally {
        composerOpenGuard.current.finish(ticket);
        setDraftOpening(false);
        toast.dismiss(loadingToast);
      }
    },
    [composeOpen, signedInUserId],
  );
  useEffect(() => {
    const onOpenCompose = (e: Event) => {
      if (composeOpen || composerOpenGuard.current.pending) {
        toast("Close or send the current message before starting another.");
        return;
      }
      const detail = (e as CustomEvent)?.detail as
        | {
            accountId?: string;
            to?: string;
            cc?: string;
            subject?: string;
            /** Plain text (gets escaped) — used by forward. */
            body?: string;
            /** Pre-built HTML (used as-is) — reply-all's quoted body. */
            html?: string;
            reply?: ReplyContext;
            attachments?: StagedFile[];
          }
        | undefined;
      setComposeContent({
        fromId: detail?.accountId ?? null,
        to: detail?.to ?? "",
        cc: detail?.cc ?? "",
        bcc: "",
        subject: detail?.subject ?? "",
        body: detail?.html ?? (detail?.body ? plainToHtml(detail.body) : ""),
        reply: detail?.reply ?? null,
        attachments: detail?.attachments ?? [],
      });
      setDraftRef(null);
      setComposeOpen(true);
    };
    window.addEventListener("open-compose", onOpenCompose);
    return () => window.removeEventListener("open-compose", onOpenCompose);
  }, [composeOpen]);
  useEffect(() => {
    const onSearch = (event: Event) => {
      const detail = (event as CustomEvent<SearchInboxDetail>).detail;
      if (!detail) return;
      if (detail.accountId !== "all") only(detail.accountId);
      updateSettings({ mailView: "unified" });
      setGlobalSearch(detail.query);
    };
    window.addEventListener(SEARCH_INBOX_EVENT, onSearch);
    return () => window.removeEventListener(SEARCH_INBOX_EVENT, onSearch);
  }, [only]);

  const markAccountRead = useCallback(
    async (accountId: string) => {
      await markAllAccountRead(accountId);
      invalidateMailQueries(queryClient, accountId);
    },
    [queryClient],
  );

  /* Keyboard: ⌘K palette · G then I → inbox (all) · ⌥1–9 → switch account
     (⌥, since ⌘1–9 is browser-reserved for tabs). */
  const lastGPress = useRef(0);
  useEffect(() => {
    const isTyping = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      target.closest("input, textarea, [contenteditable='true']") !== null;

    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setCmdOpen((o) => !o);
        return;
      }
      if (e.altKey && /^Digit[1-9]$/.test(e.code)) {
        const id = accountIds[Number(e.code.slice(5)) - 1];
        if (id) {
          e.preventDefault();
          only(id);
        }
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (e.key === "c") {
        e.preventDefault();
        openCompose();
        return;
      }
      if (e.key === "g") {
        lastGPress.current = Date.now();
        return;
      }
      if (e.key === "i" && Date.now() - lastGPress.current < 1000) {
        toggle("all");
        openFolder("inbox");
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [accountIds, only, toggle, openCompose, openFolder]);

  // Pending activations also wait until a draft has finished opening.
  const booting = isPending || allAccounts === null || draftOpening;

  if (!session) {
    // The cached loader guard won't re-trigger on client-side sign-out, so
    // handle it here: self-host → sign-in, hosted → marketing landing.
    return <Navigate to="/sign-in" />;
  }

  return (
    <>
      <CommandMenu
        open={cmdOpen}
        onOpenChange={setCmdOpen}
        onOpenSettings={openSettings}
        onGoFolder={openFolder}
        onCompose={openCompose}
        onMarkAccountRead={markAccountRead}
        onAddTestAccount={onAddTestAccount}
        onOpenPanel={openPanel}
        isOwner={isOwner}
        accounts={allAccounts ?? []}
        searchAccounts={scopedAccounts}
      />
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        accounts={allAccounts ?? []}
        snippetDraft={snippetDraft}
        onSnippetDraftConsumed={() => setSnippetDraft(null)}
        initialPage={settingsPage}
      />
      {/* Pane mode docks the composer in the board (below), but the board isn't
          mounted on dev pages and mobile has no room — fall back to the popout. */}
      {(mailView === "unified" ||
        composerMode === "popout" ||
        onDevPage ||
        isMobile) && (
        <Composer
          open={composeOpen}
          onOpenChange={setComposeOpen}
          accounts={allAccounts ?? []}
          content={composeContent}
          onContentChange={patchComposeContent}
          draft={draftRef}
        />
      )}
      <AppSidebar
        accounts={allAccounts ?? []}
        scopeIds={scopeIds}
        allOn={allOn}
        folder={folder}
        onFolder={openFolder}
        onToggleScope={toggle}
        onOpenCommand={() => setCmdOpen(true)}
        onOpenSettings={openSettings}
        onCompose={openCompose}
        onTogglePanel={togglePanel}
        openPanels={openPanels}
        onAddTestAccount={onAddTestAccount}
        loading={isPending || allAccounts === null}
      />
      <SidebarInset className="h-svh min-w-0">
        {pendingActivation && (
          <div
            role="status"
            className="flex items-center gap-3 border-b bg-muted p-3 text-sm"
          >
            <span>
              {pendingActivations.length} new{" "}
              {pendingActivations.length === 1 ? "message is" : "messages are"}{" "}
              waiting to open.
            </span>
            <Button
              size="sm"
              disabled={booting || activationSaving}
              onClick={() => {
                if (!composeOpen) {
                  activateCompose(pendingActivation);
                  return;
                }
                setActivationSaving(true);
                window.dispatchEvent(
                  new CustomEvent("kb-onemail:save-before-compose", {
                    detail: {
                      done: (saved: boolean) => {
                        setActivationSaving(false);
                        if (saved) activateCompose(pendingActivation);
                        else
                          toast.error(
                            "Save the current draft before opening the waiting message.",
                          );
                      },
                    },
                  }),
                );
              }}
            >
              {composeOpen ? "Save draft and open message" : "Open message"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={activationSaving}
              onClick={() => setPendingActivations((queue) => queue.slice(1))}
            >
              Dismiss
            </Button>
          </div>
        )}
        {/* Mobile chrome: hamburger (sidebar sheet) + search + compose.
            Hidden on md+, where the persistent sidebar is shown. */}
        <header className="flex h-[calc(3rem+env(safe-area-inset-top))] shrink-0 items-center gap-1 border-b px-2 pt-[env(safe-area-inset-top)] md:hidden">
          <SidebarTrigger className="size-9" />
          <div className="flex items-center gap-2 pl-1">
            <span className="flex size-5.5 items-center justify-center rounded-md bg-[#2563EB] text-white">
              <MailIcon className="size-3.5" />
            </span>
            <span className="font-mono text-[13px] font-semibold">
              KB OneMail
            </span>
          </div>
          <button
            type="button"
            aria-label="Search"
            onClick={() => setCmdOpen(true)}
            className="ml-auto inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <SearchIcon className="size-4.5" />
          </button>
          <button
            type="button"
            aria-label="Compose"
            onClick={openCompose}
            className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <PenLineIcon className="size-4.5" />
          </button>
        </header>
        <div className="relative min-h-0 w-full max-w-full flex-1 overflow-hidden">
          {onDevPage ? null : allAccounts === null ? (
            <LoadingScreen label="Loading accounts" fill />
          ) : mailView === "unified" ? (
            <UnifiedMailbox
              accounts={allAccounts}
              scopeIds={scopeIds}
              folder={folder}
              reading={reading}
              onOpenEmail={openEmail}
              onEditDraft={editDraft}
              onCloseReader={closeReader}
              onToggleScope={toggle}
              search={globalSearch}
              onSearchChange={setGlobalSearch}
            />
          ) : (
            <div className="flex h-full min-h-0 flex-col">
              <div className="flex shrink-0 justify-end border-b p-2">
                <MailViewSwitch />
              </div>
              <div className="min-h-0 flex-1">
                <InboxTiles
                  accounts={allAccounts}
                  scopeIds={scopeIds}
                  folder={folder}
                  reading={reading}
                  onOpenEmail={openEmail}
                  onEditDraft={editDraft}
                  onCloseReader={closeReader}
                  onRemovePane={toggle}
                  extraPaneIds={openPanels.map(panelPaneId)}
                  onClosePanel={closePanelPane}
                  compose={
                    composerMode === "pane" && !isMobile
                      ? {
                          open: composeOpen,
                          draftRef,
                          content: composeContent,
                          onContentChange: patchComposeContent,
                          onOpenChange: setComposeOpen,
                        }
                      : null
                  }
                />
              </div>
            </div>
          )}
          <Outlet />
        </div>
      </SidebarInset>
      <Toaster />
    </>
  );
}

// `fill` fits a parent container; otherwise covers the viewport.
function LoadingScreen({
  label = "Loading",
  fill = false,
}: {
  label?: string;
  fill?: boolean;
}) {
  return (
    <div
      className={`grid w-full place-items-center bg-background ${
        fill ? "h-full" : "min-h-svh"
      }`}
    >
      <div className="flex flex-col items-center gap-3">
        <span className="inline-flex size-11 animate-pulse items-center justify-center rounded-[10px] bg-[#2563EB] text-white">
          <MailIcon className="size-6" />
        </span>
        <span className="font-mono text-[11px] tracking-wide text-ink-tertiary">
          {label}…
        </span>
      </div>
    </div>
  );
}
