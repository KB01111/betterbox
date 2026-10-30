import { useEffect, useMemo, useRef, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import {
  FilterIcon,
  ListIcon,
  LayoutGridIcon,
  RefreshCwIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import type { Account } from "@/lib/account";
import { FOLDERS, FOLDER_QUERY, type Folder } from "@/lib/folders";
import { labelsQueryOptions } from "@/lib/mail-queries";
import { READER_PANE_ID } from "@/lib/layout-tree";
import { formatCount } from "@/lib/format";
import { useUnifiedMail } from "@/hooks/use-unified-mail";
import { updateSettings, useSettings } from "@/hooks/use-settings";
import { useIsMobile } from "@/hooks/use-mobile";
import { AccountDot } from "@/components/shell/account-dot";
import { linkGoogle } from "@/lib/auth/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ThreadRow } from "./thread-row";
import { ReaderPane } from "./panes/reader-pane";
import { FolderEmptyState, SkeletonRows } from "./thread-list-states";
import { TilesContext, type Reading, type TilesCtx } from "./tiles-context";

export function MailViewSwitch() {
  const { mailView } = useSettings();
  return (
    <fieldset
      className="flex items-center rounded-md border p-0.5"
      aria-label="Mailbox view"
    >
      <Button
        size="sm"
        variant={mailView === "unified" ? "secondary" : "ghost"}
        aria-pressed={mailView === "unified"}
        onClick={() => updateSettings({ mailView: "unified" })}
      >
        <ListIcon /> Unified
      </Button>
      <Button
        size="sm"
        variant={mailView === "board" ? "secondary" : "ghost"}
        aria-pressed={mailView === "board"}
        onClick={() => updateSettings({ mailView: "board" })}
      >
        <LayoutGridIcon /> Board
      </Button>
    </fieldset>
  );
}

export function UnifiedMailbox({
  accounts,
  scopeIds,
  folder,
  reading,
  onOpenEmail,
  onEditDraft,
  onCloseReader,
  onToggleScope,
  search,
  onSearchChange,
}: {
  accounts: Account[];
  scopeIds: string[];
  folder: Folder;
  reading: Reading | null;
  onOpenEmail: (accountId: string, emailId: string) => void;
  onEditDraft: (accountId: string, emailId: string) => void;
  onCloseReader: () => void;
  onToggleScope: (accountId: string | "all") => void;
  search: string;
  onSearchChange: (query: string) => void;
}) {
  const { density } = useSettings();
  const mobile = useIsMobile();
  const [debounced, setDebounced] = useState(search);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sender, setSender] = useState("");
  const [after, setAfter] = useState("");
  const [filterFolder, setFilterFolder] = useState<Folder | null>(null);
  const [unread, setUnread] = useState(false);
  const [attachments, setAttachments] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const query = [
    debounced,
    sender.trim() ? `from:(${sender.trim()})` : "",
    after ? `after:${after.replace(/-/g, "/")}` : "",
    filterFolder ? FOLDER_QUERY[filterFolder] : "",
    unread ? "is:unread" : "",
    attachments ? "has:attachment" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const ids = useMemo(
    () =>
      accounts
        .filter((account) => scopeIds.includes(account.accountId))
        .map((account) => account.accountId),
    [accounts, scopeIds],
  );
  const mail = useUnifiedMail(ids, folder, query);
  const labels = useQueries({
    queries: accounts.map((account) => labelsQueryOptions(account.accountId)),
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 600 });
  const rowHeight = density === "compact" ? 34 : 60;
  const windowed = mail.rows.length > 100;
  const start = windowed
    ? Math.max(0, Math.floor(viewport.top / rowHeight) - 8)
    : 0;
  const end = windowed
    ? Math.min(
        mail.rows.length,
        Math.ceil((viewport.top + viewport.height) / rowHeight) + 8,
      )
    : mail.rows.length;
  const visibleRows = mail.rows.slice(start, end);
  const scrollIdentity = JSON.stringify([ids, folder, query]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: A new mailbox scope resets the row window.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setViewport((current) => ({ ...current, top: 0 }));
  }, [scrollIdentity]);
  const keyboardRows = useRef({ count: 0, height: rowHeight });
  keyboardRows.current = { count: mail.rows.length, height: rowHeight };
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() =>
      setViewport((current) => ({ ...current, height: element.clientHeight })),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const typing =
        event.target instanceof HTMLElement &&
        event.target.closest("input,textarea,[contenteditable=true]");
      if (
        event.key === "/" &&
        !typing &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        event.preventDefault();
        inputRef.current?.focus();
      }
      if (
        (event.key === "ArrowDown" || event.key === "ArrowUp") &&
        scrollRef.current?.contains(document.activeElement)
      ) {
        const element =
          document.activeElement?.closest<HTMLElement>("[data-row-index]");
        if (!element) return;
        const target = Math.max(
          0,
          Math.min(
            keyboardRows.current.count - 1,
            Number(element.dataset.rowIndex) +
              (event.key === "ArrowDown" ? 1 : -1),
          ),
        );
        event.preventDefault();
        const focus = () =>
          scrollRef.current
            ?.querySelector<HTMLButtonElement>(
              `[data-row-index="${target}"] button`,
            )
            ?.focus();
        if (scrollRef.current.querySelector(`[data-row-index="${target}"]`))
          focus();
        else {
          const top = target * keyboardRows.current.height;
          scrollRef.current.scrollTop = top;
          setViewport((current) => ({ ...current, top }));
          requestAnimationFrame(() => requestAnimationFrame(focus));
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);
  const open = (accountId: string, emailId: string) =>
    folder === "drafts" && !query
      ? onEditDraft(accountId, emailId)
      : onOpenEmail(accountId, emailId);
  const context: TilesCtx = {
    accounts,
    removable: false,
    onRemovePane: () => {},
    folderFor: () => folder,
    setPaneFolder: () => {},
    openEmail: open,
    getOpenEmail: (accountId) =>
      reading?.accountId === accountId ? reading.emailId : null,
    paneSearch: {},
    openSearch: () => inputRef.current?.focus(),
    setSearch: (_account, value) => onSearchChange(value),
    closeSearch: () => onSearchChange(""),
  };
  const reader = reading && (
    <ReaderPane
      key={READER_PANE_ID}
      paneId={READER_PANE_ID}
      accountId={reading.accountId}
      emailId={reading.emailId}
      onClose={onCloseReader}
    />
  );
  const list = (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="flex h-10 shrink-0 items-center justify-between border-b px-3">
        <h1 className="truncate text-sm font-semibold">
          {query
            ? "Search all selected accounts"
            : folder === "inbox"
              ? "All inboxes"
              : folder[0].toUpperCase() + folder.slice(1)}
        </h1>
        <span
          className="font-mono text-[10px] text-muted-foreground"
          aria-live="polite"
        >
          {formatCount(mail.rows.length)} loaded
        </span>
      </div>
      {mail.errors.map((error) => (
        <div
          key={error.accountId}
          role="alert"
          className="flex flex-wrap items-center gap-2 border-b bg-destructive/5 px-3 py-2 text-xs"
        >
          <span className="min-w-0 flex-1">
            <span className="font-mono">
              {accounts.find((a) => a.accountId === error.accountId)?.email ||
                error.accountId}
            </span>
            : {error.message}. Showing available accounts.
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => mail.retryAccount(error.accountId)}
          >
            Retry
          </Button>
          <Button size="sm" variant="ghost" onClick={() => linkGoogle()}>
            Reconnect
          </Button>
        </div>
      ))}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto"
        onScroll={(event) =>
          setViewport({
            top: event.currentTarget.scrollTop,
            height: event.currentTarget.clientHeight,
          })
        }
      >
        {windowed && start > 0 && (
          <div aria-hidden="true" style={{ height: start * rowHeight }} />
        )}
        {mail.pending && mail.rows.length === 0 ? (
          <SkeletonRows density={density} />
        ) : !mail.rows.length && !mail.hasMore ? (
          query ? (
            <div className="px-6 py-12 text-center text-sm text-muted-foreground">
              No matching messages in the available accounts.
            </div>
          ) : (
            <FolderEmptyState folder={folder} />
          )
        ) : (
          visibleRows.map((email, offset) => {
            const index = accounts.findIndex(
              (account) => account.accountId === email.accountId,
            );
            const accountLabels = labels[index]?.data ?? [];
            return (
              <div
                key={JSON.stringify([email.accountId, email.id])}
                data-message-row
                data-row-index={start + offset}
                className="[&>div]:h-full [&>div>button]:h-full"
                style={{ height: rowHeight }}
              >
                <ThreadRow
                  email={email}
                  accountId={email.accountId}
                  accountEmail={accounts[index]?.email || email.accountId}
                  dotIndex={index}
                  density={density}
                  highlight={debounced}
                  labels={accountLabels
                    .filter((label) => email.labelIds?.includes(label.id))
                    .map((label) => label.name)}
                  selected={
                    reading?.accountId === email.accountId &&
                    reading.emailId === email.id
                  }
                  onClick={() =>
                    email.labelIds?.includes("DRAFT")
                      ? onEditDraft(email.accountId, email.id)
                      : open(email.accountId, email.id)
                  }
                />
              </div>
            );
          })
        )}
        {windowed && end < mail.rows.length && (
          <div
            aria-hidden="true"
            style={{ height: (mail.rows.length - end) * rowHeight }}
          />
        )}
        {mail.hasMore && (
          <div className="flex justify-center p-4">
            <Button
              variant="outline"
              size="sm"
              disabled={mail.loading}
              onClick={mail.loadMore}
            >
              {mail.loading ? "Loading…" : "Load more messages"}
            </Button>
          </div>
        )}
        {mail.loading && mail.rows.length > 0 && (
          <p
            role="status"
            className="p-3 text-center font-mono text-xs text-muted-foreground"
          >
            Refreshing…
          </p>
        )}
      </div>
    </div>
  );
  return (
    <TilesContext.Provider value={context}>
      <section className="relative flex h-full min-h-0 flex-col bg-background">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b p-2">
          <div className="relative min-w-40 flex-1">
            <SearchIcon className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" />
            <Input
              ref={inputRef}
              aria-label="Search all selected Gmail accounts"
              placeholder="Search all accounts · from:github.com, invoice…"
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              className="pr-9 pl-9"
            />
            {search && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => onSearchChange("")}
                className="absolute top-2.5 right-3"
              >
                <XIcon className="size-4" />
              </button>
            )}
          </div>
          <Button
            size="sm"
            variant="outline"
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen((current) => !current)}
          >
            <FilterIcon /> Filters
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Refresh mailbox"
            disabled={mail.loading}
            onClick={mail.refresh}
          >
            <RefreshCwIcon className={mail.loading ? "animate-spin" : ""} />
          </Button>
          <MailViewSwitch />
        </div>
        {filtersOpen && (
          <div className="grid shrink-0 grid-cols-2 items-center gap-2 border-b bg-muted/20 p-3 text-xs lg:grid-cols-5">
            <label htmlFor="mail-filter-sender" className="space-y-1">
              Sender
              <Input
                id="mail-filter-sender"
                value={sender}
                onChange={(event) => setSender(event.target.value)}
                placeholder="name@example.com"
              />
            </label>
            <label htmlFor="mail-filter-after" className="space-y-1">
              After date
              <Input
                id="mail-filter-after"
                type="date"
                value={after}
                onChange={(event) => setAfter(event.target.value)}
              />
            </label>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="outline" size="sm" />}
              >
                {filterFolder ?? "Any folder"}
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={() => setFilterFolder(null)}>
                  Any folder
                </DropdownMenuItem>
                {FOLDERS.map((value) => (
                  <DropdownMenuItem
                    key={value}
                    onClick={() => setFilterFolder(value)}
                  >
                    {value}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <label
              htmlFor="mail-filter-unread"
              className="flex items-center gap-2"
            >
              <Switch
                id="mail-filter-unread"
                checked={unread}
                onCheckedChange={setUnread}
              />
              Unread only
            </label>
            <label
              htmlFor="mail-filter-attachments"
              className="flex items-center gap-2"
            >
              <Switch
                id="mail-filter-attachments"
                checked={attachments}
                onCheckedChange={setAttachments}
              />
              Has attachments
            </label>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setSender("");
                setAfter("");
                setFilterFolder(null);
                setUnread(false);
                setAttachments(false);
              }}
            >
              Reset filters
            </Button>
          </div>
        )}
        <div className="no-scrollbar flex shrink-0 items-center gap-1.5 overflow-x-auto border-b px-3 py-2">
          <Button
            size="sm"
            variant={
              scopeIds.length === accounts.length ? "secondary" : "ghost"
            }
            onClick={() => onToggleScope("all")}
          >
            All accounts
          </Button>
          {accounts.map((account, index) => (
            <Button
              key={account.accountId}
              size="sm"
              variant={
                scopeIds.includes(account.accountId) ? "outline" : "ghost"
              }
              aria-pressed={scopeIds.includes(account.accountId)}
              onClick={() => onToggleScope(account.accountId)}
              className="max-w-60"
            >
              <AccountDot colorIndex={index} accountId={account.accountId} />
              <span className="truncate font-mono text-[10px]">
                {account.email || account.accountId}
              </span>
            </Button>
          ))}
        </div>
        <div className="relative min-h-0 flex-1">
          {mobile ? (
            <>
              {list}
              {reading && (
                <div className="absolute inset-0 z-10 bg-background">
                  {reader}
                </div>
              )}
            </>
          ) : (
            <ResizablePanelGroup orientation="horizontal">
              <ResizablePanel
                id="unified-list"
                defaultSize={reading ? "42%" : "100%"}
                minSize="25%"
              >
                {list}
              </ResizablePanel>
              {reading && (
                <>
                  <ResizableHandle withHandle />
                  <ResizablePanel
                    id={READER_PANE_ID}
                    defaultSize="58%"
                    minSize="30%"
                  >
                    {reader}
                  </ResizablePanel>
                </>
              )}
            </ResizablePanelGroup>
          )}
        </div>
      </section>
    </TilesContext.Provider>
  );
}
