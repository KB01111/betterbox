import { BadgeCheckIcon, PaperclipIcon, StarIcon } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { AccountDot, useAccountColor } from "@/components/shell/account-dot";
import { SenderAvatar } from "@/components/mail/sender-avatar";
import { useSettings } from "@/hooks/use-settings";
import { isVerifiedSender } from "@/lib/email/verified-senders";
import { cn } from "@/lib/utils";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuGroup,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";

export type ThreadRowEmail = {
  id: string;
  from: string;
  subject: string;
  date: string;
  internalDate?: number;
  starred?: boolean;
  hasAttachment?: boolean;
  snippet?: string;
  unread?: boolean;
  /** Gmail label ids on the message (tags are the user-created ones). */
  labelIds?: string[];
};

export type Density = "comfortable" | "compact";

function senderName(from: string): string {
  const match = from.match(/^\s*"?([^"<]*)"?\s*</);
  const name = match?.[1]?.trim();
  return name || from.replace(/[<>]/g, "").trim();
}

function senderAddress(from: string): string {
  return from.match(/<([^>]+)>/)?.[1]?.trim() || from.trim();
}

function shortTime(raw: string, hour12: boolean): string {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], {
      hour: hour12 ? "numeric" : "2-digit",
      minute: "2-digit",
      hour12,
    });
  }
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  }
  return date.toLocaleDateString([], { month: "short", year: "2-digit" });
}

import {
  actOnEmail,
  invalidateMailQueries,
  markEmailsRead,
} from "@/lib/mail-queries";

export function ThreadRow({
  email,
  density = "comfortable",
  selected = false,
  dotIndex,
  accountId,
  onClick,
  portalContainer,
  accountEmail,
  highlight,
  labels,
}: {
  email: ThreadRowEmail;
  density?: Density;
  selected?: boolean;
  dotIndex: number;
  accountId?: string;
  onClick?: () => void;
  /** Portal target for the right-click menu — set in the landing demo so it
   *  stays inside (and scaled with) the demo box instead of escaping to body. */
  portalContainer?: React.RefObject<HTMLElement | null>;
  accountEmail?: string;
  highlight?: string;
  labels?: string[];
}) {
  const queryClient = useQueryClient();
  const run = async (task: () => Promise<void>) => {
    if (!accountId) return false;
    try {
      await task();
      invalidateMailQueries(queryClient, accountId);
      return true;
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not update message",
      );
      return false;
    }
  };
  const runMarkRead = async () => {
    if (!accountId) return;
    await run(() =>
      email.unread
        ? markEmailsRead(accountId, [email.id])
        : actOnEmail(accountId, email.id, "unread"),
    );
  };

  const runTrash = async () => {
    if (!accountId) return;
    const succeeded = await run(() => actOnEmail(accountId, email.id, "trash"));
    if (succeeded)
      toast("Moved to trash", {
        action: {
          label: "Undo",
          onClick: () =>
            void run(() => actOnEmail(accountId, email.id, "restore")),
        },
      });
  };

  // Open the reader, then signal it. The ReaderPane mounts on the next render
  // and attaches its start-reply/start-forward listener in a passive effect
  // (after paint), so a synchronous dispatch would miss it — wait two frames.
  const openThen = (eventName: "start-reply" | "start-forward") => {
    if (onClick) onClick();
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        window.dispatchEvent(
          new CustomEvent(eventName, {
            detail: { accountId, emailId: email.id },
          }),
        ),
      ),
    );
  };

  const runReply = () => openThen("start-reply");
  const runForward = () => openThen("start-forward");

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(email.id);
      toast("Copied message ID");
    } catch {
      toast.error("Couldn't copy ID.");
    }
  };

  const { previewFont, showPreview, clock, inboxAvatars } = useSettings();
  const accountColor = useAccountColor(dotIndex, accountId);
  const unread = email.unread ?? false;
  const subject = email.subject || "(no subject)";
  const mark = (text: string) => {
    const query = highlight?.trim();
    const index =
      query && !query.includes(":")
        ? text.toLowerCase().indexOf(query.toLowerCase())
        : -1;
    return index < 0 || !query ? (
      text
    ) : (
      <>
        {text.slice(0, index)}
        <mark className="rounded bg-primary/20 text-inherit">
          {text.slice(index, index + query.length)}
        </mark>
        {text.slice(index + query.length)}
      </>
    );
  };

  const avatar = (size: string) =>
    inboxAvatars ? (
      <SenderAvatar
        name={senderName(email.from)}
        address={senderAddress(email.from)}
        color={accountColor}
        className={cn("shrink-0", size)}
      />
    ) : null;
  // The selected accent is an inset box-shadow, not a left border — a real
  // border-left miters against border-b and leaves a diagonal notch at the
  // bottom-left corner of every row.
  const rowClass = cn(
    "w-full min-w-0 cursor-pointer overflow-hidden border-b border-border text-left hover:bg-muted",
    selected && "bg-accent shadow-[inset_2px_0_0_var(--color-primary)]",
  );
  const verified = isVerifiedSender(senderAddress(email.from));
  const sender = (
    <span className="flex min-w-0 items-center gap-1">
      <span
        className={cn(
          "truncate",
          unread
            ? "font-semibold text-foreground"
            : "font-normal text-foreground/70",
        )}
      >
        {mark(senderName(email.from))}
      </span>
      {verified && (
        <BadgeCheckIcon
          aria-label="Verified sender"
          className="size-3 shrink-0 text-label-blue"
        />
      )}
    </span>
  );
  const time = (
    <span
      className={cn(
        "shrink-0 font-mono text-[10.5px] whitespace-nowrap",
        unread ? "text-muted-foreground" : "text-muted-foreground/70",
      )}
    >
      {email.starred && (
        <StarIcon
          aria-label="Starred"
          className="mr-1 inline size-3 text-label-yellow"
          fill="currentColor"
        />
      )}
      {email.hasAttachment && (
        <PaperclipIcon
          aria-label="Has attachments"
          className="mr-1 inline size-3"
        />
      )}
      {shortTime(
        email.internalDate
          ? new Date(email.internalDate).toISOString()
          : email.date,
        clock === "12h",
      )}
    </span>
  );
  const subjectSnippet = (
    <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted-foreground/70">
      <span
        className={cn(
          unread ? "font-medium text-foreground" : "text-muted-foreground",
        )}
      >
        {mark(subject)}
      </span>
      {showPreview && email.snippet && (
        <span
          className={cn(
            "text-muted-foreground/70",
            previewFont === "mono" && "font-mono text-[11px]",
          )}
        >
          {"  —  "}
          {mark(email.snippet)}
        </span>
      )}
      {labels?.length ? (
        <span className="ml-2 text-[10px] text-primary">
          {labels.slice(0, 2).join(" · ")}
        </span>
      ) : null}
    </span>
  );

  if (density === "compact") {
    return (
      <div className="relative">
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <button
              type="button"
              onClick={onClick}
              className={cn(
                rowClass,
                "flex h-[34px] items-center gap-[9px] px-3.5",
              )}
            >
              <AccountDot
                colorIndex={dotIndex}
                accountId={accountId}
                unread={unread}
              />
              {avatar("size-[18px]")}
              <span className="flex w-28 shrink-0 text-[12.5px]">{sender}</span>
              {subjectSnippet}
              {accountEmail && (
                <span
                  className="max-w-28 truncate rounded bg-muted px-1 font-mono text-[9px] text-muted-foreground"
                  title={accountEmail}
                >
                  {accountEmail}
                </span>
              )}
              <span className="min-w-[54px] shrink-0 text-right">{time}</span>
            </button>
          </ContextMenuTrigger>
          <ContextMenuContent container={portalContainer}>
            <ContextMenuGroup>
              <ContextMenuItem onClick={runMarkRead}>
                {email.unread ? "Mark as read" : "Mark as unread"}
              </ContextMenuItem>
              <ContextMenuItem onClick={runReply}>Reply</ContextMenuItem>
              <ContextMenuItem onClick={runForward}>Forward</ContextMenuItem>
            </ContextMenuGroup>
            <ContextMenuSeparator />
            <ContextMenuGroup>
              <ContextMenuItem onClick={runTrash} variant="destructive">
                Trash
              </ContextMenuItem>
              <ContextMenuItem onClick={copyId}>Copy id</ContextMenuItem>
            </ContextMenuGroup>
          </ContextMenuContent>
        </ContextMenu>
      </div>
    );
  }

  return (
    <div className="relative">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            type="button"
            onClick={onClick}
            className={cn(rowClass, "flex gap-2.5 px-3.5 py-2")}
          >
            {inboxAvatars ? (
              <span className="flex items-center gap-2 pt-[3px]">
                <AccountDot
                  colorIndex={dotIndex}
                  accountId={accountId}
                  unread={unread}
                />
                {avatar("size-7")}
              </span>
            ) : (
              <span className="pt-[5px]">
                <AccountDot
                  colorIndex={dotIndex}
                  accountId={accountId}
                  unread={unread}
                />
              </span>
            )}
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex items-center gap-2 text-[13px]">
                <span className="flex min-w-0 flex-1 text-left">{sender}</span>
                {accountEmail && (
                  <span
                    className="max-w-28 truncate font-mono text-[9px] text-muted-foreground"
                    title={accountEmail}
                  >
                    {accountEmail}
                  </span>
                )}
                {time}
              </span>
              {subjectSnippet}
            </span>
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent container={portalContainer}>
          <ContextMenuGroup>
            <ContextMenuItem onClick={runMarkRead}>
              {email.unread ? "Mark as read" : "Mark as unread"}
            </ContextMenuItem>
            <ContextMenuItem onClick={runReply}>Reply</ContextMenuItem>
            <ContextMenuItem onClick={runForward}>Forward</ContextMenuItem>
          </ContextMenuGroup>
          <ContextMenuSeparator />
          <ContextMenuGroup>
            <ContextMenuItem onClick={runTrash} variant="destructive">
              Trash
            </ContextMenuItem>
            <ContextMenuItem onClick={copyId}>Copy id</ContextMenuItem>
          </ContextMenuGroup>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
}
