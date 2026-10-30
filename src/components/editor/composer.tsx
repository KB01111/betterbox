import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  CheckIcon,
  ChevronDownIcon,
  EyeIcon,
  GripVerticalIcon,
  PaperclipIcon,
  PencilIcon,
  PenLineIcon,
  SendIcon,
  Trash2Icon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";

import { toast } from "sonner";
import {
  desktopBridge,
  desktopRequest,
  DESKTOP_QUIT_EVENT,
  reportDesktopLifecycle,
  saveBeforeDesktopExit,
  isDesktopDraftDirty,
} from "@/lib/auth/desktop-bridge";

import { useQueryClient } from "@tanstack/react-query";

import { useSession } from "@/lib/auth/auth-client";
import { useSettings } from "@/hooks/use-settings";
import { cn } from "@/lib/utils";
import type { Account } from "@/lib/account";
import {
  deleteDraft,
  invalidateMailQueries,
  resolveDraftId,
  saveDraft,
  sendNewEmail,
  useContactsQuery,
} from "@/lib/mail-queries";
import { isTestAccount } from "@/lib/test-account";
import { clearDraftBuffer } from "@/lib/draft-buffer";
import {
  DraftSaveQueue,
  resolveSender,
  type DraftPayload,
} from "@/lib/draft-save";
import { AccountDot } from "@/components/shell/account-dot";
import { RichTextEditor } from "@/components/editor/rich-text-editor";
import { IconButton } from "@/components/shared/icon-button";
import { serializeEmailHtml, type EmailNode } from "@/lib/email/serialize";
import { checkGuardrails } from "@/lib/email/guardrails";
import {
  countFillFields,
  firstUnfilledFieldPos,
} from "@/components/editor/editor-fill-fields";
import { useSnippetMap, openSnippetDraft } from "@/hooks/use-snippets";
import { DOMSerializer } from "@tiptap/pm/model";
import { NodeSelection } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { BookmarkPlusIcon } from "lucide-react";
import {
  appendSignature,
  appendSignatureHtml,
  resolveAccountSignature,
  useGmailSignatureQuery,
  useSignaturesQuery,
} from "@/hooks/use-signatures";
import { HtmlBody } from "@/components/mail/html-body";
import { Button } from "@/components/ui/button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Hint } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  FieldLabel,
  isValidRecipients,
  nameFromEmail,
  parseToEntry,
  RECIPIENT_ROW,
  RecipientField,
  shortName,
} from "@/components/editor/recipient-field";
import {
  ACCEPT_FILES,
  BLOCKED_EXT,
  readFileAsBase64,
  type StagedFile,
} from "@/components/editor/composer-attachments";
import { PreviewBody } from "@/components/editor/composer-preview";

// Feathers all four edges of the blur halo by 30px (intersected) so it fades out instead of a hard rectangle.
const HALO_FEATHER =
  "linear-gradient(to right, transparent, #000 30px, #000 calc(100% - 30px), transparent), linear-gradient(to bottom, transparent, #000 30px, #000 calc(100% - 30px), transparent)";
const NO_ATTACHMENTS: StagedFile[] = [];
const subscribeIdle = () => () => {};
const getIdleOperation = () => null;

/** Threading headers nesting a sent message under a conversation (set by reply/reply-all; null for fresh compose). */
export type ReplyContext = {
  inReplyTo?: string;
  references?: string;
  threadId?: string;
};

/** The composer's editable fields. Lifted to the parent (AppShell) so they survive
 *  remounts — switching pane↔popout, or navigating off the board. */
export type ComposerContent = {
  fromId: string | null;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  /** Present when the composer was opened as a reply-all (threads the send). */
  reply: ReplyContext | null;
  attachments?: StagedFile[];
  /** In-memory identity and pending saves survive pane/popout remounts. */
  draftSession?: DraftSaveQueue;
};

/** Docked composer for a new message (fixed bottom-right panel, not a Dialog). Borderless field
 *  rows, 44px label column, mono To / sans Subject, ⌘↵ sends. Replies share this draft lifecycle. */
export function Composer({
  open,
  onOpenChange,
  accounts,
  content,
  onContentChange,
  draft,
  inPane = false,
  onHeaderPointerDown,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: Account[];
  /** Editable fields, parent-owned so they survive composer remounts (pane↔popout). */
  content: ComposerContent;
  onContentChange: (patch: Partial<ComposerContent>) => void;
  /** Open an existing draft for editing — the parent seeds `content`. */
  draft?: { accountId: string; emailId: string } | null;
  /** Render to fill a tile (pane mode) instead of the floating popout. */
  inPane?: boolean;
  /** In pane mode, makes the header a drag handle for the tile board. */
  onHeaderPointerDown?: (event: React.PointerEvent) => void;
}) {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const { defaultSendFrom } = useSettings();
  // Any inbox with an address can be the From; test/demo accounts show in the picker but
  // sending from one is a sealed no-op (see `send`).
  const sendable = useMemo(() => accounts.filter((a) => a.email), [accounts]);

  const { fromId, to, cc, bcc, subject, body, reply } = content;
  // Cc/Bcc start hidden for a fresh compose; reply-all seeds cc, so reveal it then.
  const [ccShown, setCcShown] = useState(false);
  const [bccShown, setBccShown] = useState(false);
  const showCc = ccShown || cc.trim().length > 0;
  const showBcc = bccShown || bcc.trim().length > 0;
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Preview renders the body as the recipient sees it (rich text → HTML).
  const [preview, setPreview] = useState(false);
  // Files staged for this message, read to base64 in the browser.
  const files = content.attachments ?? NO_ATTACHMENTS;
  const setFiles = (next: StagedFile[]) =>
    onContentChange({ attachments: next });
  const filesRef = useRef(files);
  filesRef.current = files;
  const fileInputRef = useRef<HTMLInputElement>(null);
  // The editor's live doc model (TipTap JSON), serialized to email-safe HTML on send/preview.
  // Re-emitted by the editor on mount, so it survives composer remounts (pane↔popout).
  const [bodyDoc, setBodyDoc] = useState<EmailNode | null>(null);
  // Editor instance + selection's screen rect — drives the "save as snippet" bubble over a highlight.
  const [editorInstance, setEditorInstance] = useState<Editor | null>(null);
  const [snipRect, setSnipRect] = useState<{
    left: number;
    top: number;
  } | null>(null);
  // The popout's measured rect → drives a feathered blur halo behind it.
  const sectionRef = useRef<HTMLElement>(null);
  const [haloRect, setHaloRect] = useState<DOMRect | null>(null);
  // Undo-send: the dispatch is delayed by a cancel window; this holds the timer.
  const sendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Soft guardrails surface as a confirm popover above Send (not persistent pills).
  const [confirmOpen, setConfirmOpen] = useState(false);
  // True once Send was attempted with a hard blocker — turns on the inline field cues.
  const [triedSend, setTriedSend] = useState(false);
  const [closing, setClosing] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">(
    "idle",
  );

  // From: explicit pick (fromId) wins, then default send-from, then primary inbox, then first sendable.
  const from = resolveSender(
    sendable,
    draft?.accountId ?? fromId,
    defaultSendFrom,
    session?.user.email,
  );
  const availableAccountsRef = useRef(sendable);
  availableAccountsRef.current = sendable;
  const draftSession = useMemo(() => {
    if (content.draftSession) return content.draftSession;
    if (!from) return null;
    const existing = draft;
    return new DraftSaveQueue(
      from.accountId,
      saveDraft,
      existing
        ? async () => {
            const draftId = await resolveDraftId(
              existing.accountId,
              existing.emailId,
            );
            return draftId ? { draftId, messageId: existing.emailId } : null;
          }
        : undefined,
    );
  }, [content.draftSession, from, draft]);
  const operation = useSyncExternalStore(
    draftSession?.subscribe ?? subscribeIdle,
    draftSession?.getOperation ?? getIdleOperation,
    getIdleOperation,
  );
  const working = sending || closing || operation !== null;
  const senderLocked = !!draft || !!draftSession?.started;
  useEffect(() => {
    if (!open || !from || !draftSession) return;
    if (!fromId || !content.draftSession) {
      onContentChange({ fromId: from.accountId, draftSession });
    }
  }, [open, from, fromId, content.draftSession, draftSession, onContentChange]);
  // Retire the former disk recovery buffer; mailbox content stays in memory and Gmail.
  useEffect(() => {
    void clearDraftBuffer();
  }, []);
  useEffect(
    () => () => {
      if (sendTimerRef.current) {
        clearTimeout(sendTimerRef.current);
        sendTimerRef.current = null;
        draftSession?.endOperation();
        toast("Send cancelled", {
          description:
            "The composer moved. Review your message and send again.",
        });
      }
    },
    [draftSession],
  );

  // People you've emailed before — feeds the To autocomplete.
  const contacts = useContactsQuery(from?.accountId, open).data ?? [];
  // Snippets expand inline in the editor (e.g. "/ty "). Fetched only while open.
  const snippets = useSnippetMap(open, from?.accountId);

  // Variables for snippet `{{tokens}}`, from the first To: recipient. Name priority: saved contact →
  // display name typed in To: → guess from local part, so {{first_name}} resolves for fresh addresses
  // too. Empty (→ a fill field) when there's no usable name (e.g. a bare role address).
  const variables = useMemo<Record<string, string>>(() => {
    const firstEntry = to.split(",")[0]?.trim() ?? "";
    const { name: displayName, email } = parseToEntry(firstEntry);
    const contact = contacts.find(
      (c) => c.email.toLowerCase() === email.toLowerCase(),
    );
    const name = (
      contact?.name?.trim() ||
      displayName ||
      nameFromEmail(email)
    ).trim();
    const [first, ...rest] = name.split(/\s+/).filter(Boolean);
    return {
      name,
      first_name: first ?? "",
      last_name: rest.join(" "),
      email: contact?.email ?? email,
    };
  }, [to, contacts]);

  // Unfilled snippet tab-stops HARD-BLOCK send — you must fill them first.
  const unfilledFields = countFillFields(bodyDoc);
  // Soft last-second checks (no subject, "see attached" w/ nothing, leaving a work domain, big blast) — warn + gate, not block.
  const guardrails = useMemo(() => {
    if (!from) return [];
    return checkGuardrails({
      subject,
      bodyText: body.replace(/<[^>]+>/g, " "),
      to,
      cc,
      bcc,
      fromEmail: from.email,
      attachmentCount: files.length,
    });
  }, [from, subject, body, to, cc, bcc, files.length]);
  // Any edit that changes the warnings dismisses the open confirm popover.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-evaluate only when the warning set changes identity.
  useEffect(() => setConfirmOpen(false), [guardrails]);

  // Signature: read-only block below the editor (uneditable), appended to outgoing HTML at send/draft
  // unless removed for this message; the skip resets on From change. The native Gmail signature
  // (rich + images) is the source of truth when set, with a KB OneMail DB signature as fallback. The
  // Gmail HTML is Gmail-authored, so it's email-safe as-is.
  const sigData = useSignaturesQuery(open, from?.accountId).data;
  const dbSig = open ? resolveAccountSignature(sigData, from?.accountId) : null;
  const gmailSig =
    useGmailSignatureQuery(from?.accountId, from?.email, open).data ?? "";
  const useGmailSig = gmailSig.length > 0;

  const [signatureSkipped, setSignatureSkipped] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-arm the signature when the sending account changes, not on every render.
  useEffect(() => setSignatureSkipped(false), [from?.accountId]);
  const showSignature = (useGmailSig || dbSig !== null) && !signatureSkipped;

  const appendSig = (html: string) =>
    useGmailSig
      ? appendSignatureHtml(html, gmailSig)
      : dbSig
        ? appendSignature(html, dbSig.body)
        : html;

  // Send + preview go through the email-safe serializer (TipTap doc → table-based, inlined HTML).
  // Drafts save the raw editor body (round-trips back into TipTap; the signature is NOT baked in — it's
  // re-applied on open and on send, so reopening a draft can't double it). Falls back to raw body only
  // if the editor hasn't emitted a doc yet (never on a user-initiated send — emits on mount).
  const emailSafeBody = bodyDoc ? serializeEmailHtml(bodyDoc) : body;
  const emailSafeHtml = showSignature
    ? appendSig(emailSafeBody)
    : emailSafeBody;

  const draftPayload = useMemo<DraftPayload | null>(
    () =>
      from
        ? {
            accountId: from.accountId,
            to: to.trim(),
            cc: cc.trim() || undefined,
            bcc: bcc.trim() || undefined,
            subject,
            html: body,
            inReplyTo: reply?.inReplyTo,
            references: reply?.references,
            threadId: reply?.threadId,
            attachments: files.map((file) => ({
              filename: file.name,
              mimeType: file.type,
              contentBase64: file.base64,
              contentId: file.contentId,
            })),
          }
        : null,
    [from, to, cc, bcc, subject, body, reply, files],
  );
  const latestPayloadRef = useRef(draftPayload);
  const confirmedPayloadRef = useRef<DraftPayload | null>(null);
  latestPayloadRef.current = draftPayload;
  // biome-ignore lint/correctness/useExhaustiveDependencies: any content change makes the last confirmed save stale.
  useEffect(() => {
    setSaveStatus("idle");
  }, [draftPayload]);
  const persistDraft = useCallback(
    async (payload: DraftPayload) => {
      if (!draftSession)
        throw new Error("Choose a sending account before saving.");
      setSaveStatus("saving");
      try {
        const identity = await draftSession.save(payload);
        confirmedPayloadRef.current = payload;
        setSaveStatus(latestPayloadRef.current === payload ? "saved" : "idle");
        setError(null);
        queryClient.invalidateQueries({
          queryKey: ["emails", payload.accountId],
        });
        queryClient.invalidateQueries({
          queryKey: ["unified-mail", payload.accountId],
        });
        return identity;
      } catch (err) {
        setSaveStatus("idle");
        setError(
          err instanceof Error
            ? err.message
            : "Could not save draft. Your message is still open.",
        );
        throw err;
      }
    },
    [draftSession, queryClient],
  );
  const desktopDirty = isDesktopDraftDirty(
    open,
    saveStatus === "saved" && confirmedPayloadRef.current === draftPayload,
    !!(to || cc || bcc || subject || body || files.length),
    !!draft || !!draftSession?.started,
  );
  useEffect(() => {
    if (open) reportDesktopLifecycle(working, desktopDirty);
  }, [open, working, desktopDirty]);
  useEffect(() => {
    if (!open || !desktopBridge("lifecycle")) return;
    const saveBeforeQuit = (event: Event) => {
      const { requestId } = (event as CustomEvent<{ requestId: string }>)
        .detail;
      if (!requestId) return;
      void (async () => {
        const allow = await saveBeforeDesktopExit({
          busy: working,
          dirty: desktopDirty,
          payload: latestPayloadRef.current,
          current: () =>
            draftSession?.active ? latestPayloadRef.current : null,
          save: async (payload) => {
            if (!draftSession?.beginOperation("close"))
              throw new Error("Composer is busy.");
            setClosing(true);
            try {
              await persistDraft(payload);
            } finally {
              setClosing(false);
              draftSession.endOperation();
            }
          },
        });
        if (!allow)
          toast.error(
            "KB OneMail stayed open. Finish the current action or save/discard your draft before quitting.",
          );
        await desktopRequest("quit-response", { requestId, allow }).catch(
          () => {},
        );
      })();
    };
    window.addEventListener(DESKTOP_QUIT_EVENT, saveBeforeQuit);
    return () => window.removeEventListener(DESKTOP_QUIT_EVENT, saveBeforeQuit);
  }, [open, working, desktopDirty, draftSession, persistDraft]);
  useEffect(() => {
    const has = !!(
      to.trim() ||
      cc.trim() ||
      bcc.trim() ||
      subject.trim() ||
      body ||
      files.length
    );
    if (
      !open ||
      sending ||
      closing ||
      !draftPayload ||
      (!has && !draftSession?.started && !draft)
    )
      return;
    const timer = setTimeout(() => {
      void persistDraft(draftPayload).catch(() => {});
    }, 2000);
    return () => clearTimeout(timer);
  }, [
    open,
    sending,
    closing,
    draftPayload,
    draftSession,
    draft,
    to,
    cc,
    bcc,
    subject,
    body,
    files.length,
    persistDraft,
  ]);
  useEffect(() => {
    if (
      !open ||
      saveStatus === "saved" ||
      !(to || cc || bcc || subject || body || files.length)
    )
      return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [open, saveStatus, to, cc, bcc, subject, body, files.length]);

  // Show the "save as snippet" bubble while a non-empty passage is selected. Positioned from the live
  // DOM selection rect; cleared on collapse/blur (the bubble preventDefaults mousedown to keep the selection).
  useEffect(() => {
    const ed = editorInstance;
    if (!ed) return;
    const sync = () => {
      if (ed.state.selection.empty || !ed.isFocused) return setSnipRect(null);
      // A single selected chip (fill-field/date node) isn't a passage to save.
      if (ed.state.selection instanceof NodeSelection) return setSnipRect(null);
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return setSnipRect(null);
      const r = sel.getRangeAt(0).getBoundingClientRect();
      if (r.width < 1 && r.height < 1) return setSnipRect(null);
      setSnipRect({ left: r.left + r.width / 2, top: r.top });
    };
    const clear = () => setSnipRect(null);
    ed.on("selectionUpdate", sync);
    ed.on("blur", clear);
    return () => {
      ed.off("selectionUpdate", sync);
      ed.off("blur", clear);
    };
  }, [editorInstance]);

  // Measure the popout so a feathered blur halo can sit behind its edges. Skipped in pane mode and full-screen mobile.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the composer opens; inPane covers the only other trigger.
  useEffect(() => {
    const el = sectionRef.current;
    if (inPane || !el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setHaloRect(r.width >= window.innerWidth - 8 ? null : r);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [inPane, open]);

  useEffect(() => {
    if (!open) return;
    const savePending = (event: Event) => {
      const done = (event as CustomEvent<{ done: (saved: boolean) => void }>)
        .detail?.done;
      if (!done) return;
      if (working) {
        done(false);
        return;
      }
      if (!hasContent && !draft && !draftSession?.started) {
        reset();
        done(true);
        return;
      }
      if (!draftPayload || !draftSession?.beginOperation("close")) {
        done(false);
        return;
      }
      setClosing(true);
      void persistDraft(draftPayload)
        .then(() => {
          if (
            latestPayloadRef.current !== draftPayload ||
            !draftSession.active
          ) {
            done(false);
            return;
          }
          refreshDrafts(draftPayload.accountId);
          reset();
          done(true);
        })
        .catch(() => done(false))
        .finally(() => {
          setClosing(false);
          draftSession.endOperation();
        });
    };
    window.addEventListener("kb-onemail:save-before-compose", savePending);
    return () =>
      window.removeEventListener("kb-onemail:save-before-compose", savePending);
  });

  if (!open) return null;

  // Save the highlighted passage as a reusable snippet: capture the selection's HTML (formatting kept)
  // and hand it to Settings → Snippets, which opens a new snippet pre-filled (trigger set in the real editor).
  const saveAsSnippet = () => {
    const ed = editorInstance;
    if (!ed) return;
    const { from: selFrom, to: selTo } = ed.state.selection;
    if (selFrom === selTo) return;
    const tmp = document.createElement("div");
    tmp.appendChild(
      DOMSerializer.fromSchema(ed.schema).serializeFragment(
        ed.state.selection.content().content,
      ),
    );
    setSnipRect(null);
    openSnippetDraft(tmp.innerHTML);
  };

  // Require ≥1 well-formed address (comma-separated allowed) before Send enables, so "d" can't be sent.
  // Cc/Bcc are optional but must be valid when present.
  const recipientsValid = isValidRecipients(to);
  const ccValid = cc.trim().length === 0 || isValidRecipients(cc);
  const bccValid = bcc.trim().length === 0 || isValidRecipients(bcc);

  const hasContent = !!(
    to.trim() ||
    cc.trim() ||
    bcc.trim() ||
    subject.trim() ||
    body ||
    files.length
  );

  const refreshDrafts = (accountId: string) => {
    invalidateMailQueries(queryClient, accountId);
  };

  const reset = () => {
    onContentChange({
      fromId: null,
      to: "",
      cc: "",
      bcc: "",
      subject: "",
      body: "",
      reply: null,
      attachments: [],
      draftSession: undefined,
    });
    setBccShown(false);
    setCcShown(false);
    setError(null);
    setSending(false);
    setClosing(false);
    setPreview(false);
    setBodyDoc(null);
    setConfirmOpen(false);
    setTriedSend(false);
    if (sendTimerRef.current) {
      clearTimeout(sendTimerRef.current);
      sendTimerRef.current = null;
    }
    setSaveStatus("idle");
    setSignatureSkipped(false);
    draftSession?.endOperation();
    onOpenChange(false);
  };

  // Closing joins the autosave queue and only clears editable content after Gmail confirms it.
  const close = async () => {
    if (working) return;
    if (!hasContent && !draft && !draftSession?.started) return reset();
    if (!draftPayload) {
      setError(
        "The sending account is disconnected. Reconnect it to save this message.",
      );
      return;
    }
    if (!draftSession?.beginOperation("close")) return;
    setClosing(true);
    try {
      await persistDraft(draftPayload);
      if (!draftSession.active) return;
      refreshDrafts(draftPayload.accountId);
      reset();
    } catch {
      setClosing(false);
      draftSession.endOperation();
    }
  };

  const discard = async () => {
    if (working) return;
    if (
      hasContent &&
      !window.confirm("Discard this draft? This cannot be undone.")
    )
      return;
    if (draftSession && !draftSession.beginOperation("close")) return;
    setClosing(true);
    try {
      const saved = await draftSession?.drain();
      if (draftSession && !draftSession.active) return;
      const messageId = saved?.messageId ?? draft?.emailId;
      const accountId = draftSession?.accountId ?? draft?.accountId;
      if (accountId && messageId) {
        await deleteDraft(accountId, messageId);
        if (draftSession && !draftSession.active) return;
        refreshDrafts(accountId);
      }
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not discard draft.");
      setClosing(false);
      draftSession?.endOperation();
    }
  };

  const onPickFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = ""; // let the same file be picked again later
    if (picked.length === 0) return;
    const blocked = picked.filter((f) => BLOCKED_EXT.test(f.name));
    const allowed = picked.filter((f) => !BLOCKED_EXT.test(f.name));
    if (blocked.length > 0) {
      toast.error("Some files can’t be sent", {
        description: `Gmail blocks ${blocked.map((f) => f.name).join(", ")}.`,
      });
    }
    if (allowed.length === 0) return;
    if (!draftSession?.beginOperation("attachments")) return;
    try {
      const staged = await Promise.all(allowed.map(readFileAsBase64));
      if (draftSession && !draftSession.active) return;
      {
        const next = [...filesRef.current, ...staged];
        // ~25 MB decoded ≈ 34 MB of base64 — Gmail's send ceiling.
        if (next.reduce((s, f) => s + f.base64.length, 0) > 34_000_000) {
          toast.error("Attachments too large", { description: "25 MB max." });
          return;
        }
        setFiles(next);
      }
    } catch {
      toast.error("Couldn’t read that file");
    } finally {
      draftSession.endOperation();
    }
  };
  const removeFile = (id: string) => setFiles(files.filter((f) => f.id !== id));

  // The actual dispatch, fired after the undo window elapses.
  const doSend = async () => {
    if (!from || !draftPayload) return;
    setSending(true);
    setError(null);
    try {
      if (
        !availableAccountsRef.current.some(
          (account) => account.accountId === from.accountId,
        )
      ) {
        throw new Error(
          "The sending account is disconnected. Reconnect it before sending.",
        );
      }
      const saved = await persistDraft({
        ...draftPayload,
        html: emailSafeHtml,
      });
      if (!draftSession?.active)
        throw new Error("This composer is no longer active.");
      const result = await sendNewEmail({
        accountId: from.accountId,
        draftId: saved.draftId,
        to: to.trim(),
        cc: cc.trim() || undefined,
        bcc: bcc.trim() || undefined,
        subject,
        body: "",
        html: emailSafeHtml,
        inReplyTo: reply?.inReplyTo,
        references: reply?.references,
        threadId: reply?.threadId,
        attachments: files.map((f) => ({
          filename: f.name,
          mimeType: f.type,
          contentBase64: f.base64,
          contentId: f.contentId,
        })),
      });
      if (!draftSession.active) return;
      refreshDrafts(from.accountId);
      if (result.simulated) {
        toast("Simulation: message not sent", {
          description: "Your message is saved in Drafts. Nothing was sent.",
        });
      } else {
        toast.success("Message sent", { description: `To ${to.trim()}` });
      }
      // Sent — drop the local backstop.
      void clearDraftBuffer();
      setSending(false);
      draftSession?.endOperation();
      reset();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.error("Couldn’t send message", { description: message });
      setSending(false);
      draftSession?.endOperation();
    }
  };

  // Undo-send: hold the message for a few seconds with a cancel toast before it goes out.
  const UNDO_MS = 5000;
  const scheduleSend = () => {
    if (
      working ||
      sendTimerRef.current ||
      !draftSession?.beginOperation("send")
    )
      return;
    setSending(true);
    const timer = setTimeout(() => {
      sendTimerRef.current = null;
      void doSend();
    }, UNDO_MS);
    sendTimerRef.current = timer;
    toast("Sending…", {
      description: `To ${to.trim()}`,
      duration: UNDO_MS,
      action: {
        label: "Undo",
        onClick: () => {
          clearTimeout(timer);
          sendTimerRef.current = null;
          setSending(false);
          draftSession.endOperation();
        },
      },
    });
  };

  // Pull the next blank into view and pulse it, so "what's left" is obvious.
  const flashFirstUnfilledField = () => {
    const ed = editorInstance;
    if (!ed) return;
    const pos = firstUnfilledFieldPos(ed);
    if (pos == null) return;
    ed.chain().focus().setNodeSelection(pos).scrollIntoView().run();
    const dom = ed.view.dom;
    dom.classList.add("flash-fields");
    window.setTimeout(() => dom.classList.remove("flash-fields"), 700);
  };

  // Hard blockers (bad recipient / unfilled fields) guide you to the field; soft
  // guardrails (no subject, external recipient…) open a confirm popover above Send.
  const blocked =
    !recipientsValid || !ccValid || !bccValid || unfilledFields > 0;
  const send = () => {
    if (!from || working) return;
    if (blocked) {
      setTriedSend(true);
      flashFirstUnfilledField();
      return;
    }
    if (guardrails.length > 0 && !confirmOpen) {
      setConfirmOpen(true);
      return;
    }
    scheduleSend();
  };

  // Inline cues — the field itself goes red, not a footer pill. To: only after a
  // send attempt (or once it holds something invalid); cc/bcc whenever invalid.
  const toInvalid = !recipientsValid && (triedSend || to.trim().length > 0);
  const ccInvalid = !ccValid;
  const bccInvalid = !bccValid;

  return (
    <>
      {haloRect && (
        // A feathered backdrop-blur halo hugging + fading past the popout's edges, lifting the card off
        // the inbox. A sibling (not a child) so it isn't clipped by the section's overflow + rounding.
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-30 hidden sm:block"
          style={{
            left: haloRect.left - 26,
            top: haloRect.top - 26,
            width: haloRect.width + 52,
            height: haloRect.height + 52,
            borderRadius: 28,
            backdropFilter: "blur(14px) saturate(1.2)",
            WebkitBackdropFilter: "blur(14px) saturate(1.2)",
            maskImage: HALO_FEATHER,
            WebkitMaskImage: HALO_FEATHER,
            maskComposite: "intersect",
            WebkitMaskComposite: "source-in",
          }}
        />
      )}
      <section
        ref={sectionRef}
        aria-label="New message"
        inert={working}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            event.stopPropagation();
            void send();
          }
          if (event.key === "Escape" && !sending) {
            event.stopPropagation();
            if (confirmOpen) setConfirmOpen(false);
            else close();
          }
        }}
        className={cn(
          "flex flex-col overflow-hidden bg-secondary",
          inPane
            ? "h-full w-full"
            : // Full-screen on phones; floating bottom-right popout on sm+ (the blur halo above does the lifting).
              "fixed inset-0 z-50 w-full rounded-none border-0 sm:inset-auto sm:right-5 sm:bottom-5 sm:z-40 sm:w-[520px] sm:max-w-[calc(100vw-2.5rem)] sm:rounded-xl sm:border sm:border-input sm:shadow-[0_32px_90px_-20px_rgba(0,0,0,0.7)]",
        )}
      >
        <header
          onPointerDown={onHeaderPointerDown}
          className={cn(
            "flex items-center gap-2 border-b bg-popover",
            // Match the account/reader pane header height (h-9) in pane mode.
            inPane ? "h-9 px-2.5" : "px-3.5 py-[11px]",
            onHeaderPointerDown &&
              "cursor-grab touch-none select-none active:cursor-grabbing",
          )}
        >
          {onHeaderPointerDown && (
            <GripVerticalIcon className="size-3.5 shrink-0 text-muted-foreground/70" />
          )}
          <PencilIcon className="size-3.5 text-muted-foreground" />
          <span className="text-[14.5px] font-semibold tracking-[-0.2px]">
            {draft ? "Edit draft" : "New message"}
          </span>
          <Hint
            label={
              from && isTestAccount(from.accountId)
                ? "Close, saves to drafts"
                : "Close"
            }
          >
            <button
              type="button"
              onClick={close}
              className="ml-auto inline-flex size-5 cursor-pointer items-center justify-center rounded text-muted-foreground/70 hover:bg-muted hover:text-foreground"
            >
              <XIcon className="size-[15px]" />
            </button>
          </Hint>
        </header>

        <div className="flex h-[42px] items-center gap-2.5 border-b px-4">
          <FieldLabel>From</FieldLabel>
          {from ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                disabled={senderLocked}
                title={
                  senderLocked
                    ? "Saved drafts keep their sending account"
                    : "Choose sending account"
                }
                className="inline-flex min-w-0 cursor-pointer items-center gap-2 rounded-[7px] border bg-card px-2.5 py-1 hover:bg-muted disabled:cursor-default"
              >
                <AccountDot
                  colorIndex={accounts.findIndex(
                    (a) => a.accountId === from.accountId,
                  )}
                  accountId={from.accountId}
                />
                <span className="shrink-0 text-[13px]">
                  {shortName(from.email)}
                </span>
                <span className="truncate font-mono text-[11.5px] text-muted-foreground">
                  {from.email}
                </span>
                <ChevronDownIcon className="size-[13px] shrink-0 text-muted-foreground/70" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-72">
                {sendable.map((account) => (
                  <DropdownMenuItem
                    key={account.accountId}
                    onClick={() =>
                      onContentChange({
                        fromId: account.accountId,
                        draftSession: undefined,
                      })
                    }
                  >
                    <AccountDot
                      colorIndex={accounts.findIndex(
                        (a) => a.accountId === account.accountId,
                      )}
                      accountId={account.accountId}
                    />
                    <span className="shrink-0 text-[13px]">
                      {shortName(account.email)}
                    </span>
                    <span className="ml-auto truncate font-mono text-[11.5px] text-muted-foreground">
                      {account.email}
                    </span>
                    {account.accountId === from.accountId && (
                      <CheckIcon className="size-3.5 shrink-0 text-primary" />
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <span className="text-xs text-muted-foreground">
              {fromId
                ? "Sending account disconnected — reconnect to continue"
                : "No sendable account linked"}
            </span>
          )}
        </div>

        <div
          className={cn(RECIPIENT_ROW, toInvalid && "border-b-label-red/70")}
        >
          <FieldLabel invalid={toInvalid}>To</FieldLabel>
          <RecipientField
            value={to}
            onChange={(next) => onContentChange({ to: next })}
            contacts={contacts}
          />
          {(!showCc || !showBcc) && (
            <span className="flex shrink-0 items-center gap-0.5">
              {!showCc && (
                <button
                  type="button"
                  onClick={() => setCcShown(true)}
                  className="cursor-pointer rounded px-1 text-[12px] text-muted-foreground/70 hover:text-foreground"
                >
                  Cc
                </button>
              )}
              {!showBcc && (
                <button
                  type="button"
                  onClick={() => setBccShown(true)}
                  className="cursor-pointer rounded px-1 text-[12px] text-muted-foreground/70 hover:text-foreground"
                >
                  Bcc
                </button>
              )}
            </span>
          )}
        </div>

        {showCc && (
          <div
            className={cn(
              "group",
              RECIPIENT_ROW,
              ccInvalid && "border-b-label-red/70",
            )}
          >
            <FieldLabel invalid={ccInvalid}>Cc</FieldLabel>
            <RecipientField
              value={cc}
              onChange={(next) => onContentChange({ cc: next })}
              contacts={contacts}
            />
            <button
              type="button"
              aria-label="Remove Cc"
              onClick={() => {
                setCcShown(false);
                onContentChange({ cc: "" });
              }}
              className="shrink-0 rounded p-1 text-muted-foreground/60 opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground"
            >
              <XIcon className="size-3.5" />
            </button>
          </div>
        )}

        {showBcc && (
          <div
            className={cn(
              "group",
              RECIPIENT_ROW,
              bccInvalid && "border-b-label-red/70",
            )}
          >
            <FieldLabel invalid={bccInvalid}>Bcc</FieldLabel>
            <RecipientField
              value={bcc}
              onChange={(next) => onContentChange({ bcc: next })}
              contacts={contacts}
            />
            <button
              type="button"
              aria-label="Remove Bcc"
              onClick={() => {
                setBccShown(false);
                onContentChange({ bcc: "" });
              }}
              className="shrink-0 rounded p-1 text-muted-foreground/60 opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground"
            >
              <XIcon className="size-3.5" />
            </button>
          </div>
        )}

        <div className="flex h-10 items-center gap-2.5 border-b px-4">
          <FieldLabel>Subject</FieldLabel>
          <input
            value={subject}
            onChange={(event) =>
              onContentChange({ subject: event.target.value })
            }
            placeholder="Add a subject line"
            className="min-w-0 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-muted-foreground/60"
          />
        </div>

        <div
          className={cn(
            // Pane + full-screen mobile: editor grows to fill. Desktop popout (sm+): content-sized.
            inPane
              ? "flex min-h-0 flex-1 flex-col"
              : "flex min-h-0 flex-1 flex-col sm:block sm:flex-none",
            preview && "overflow-y-auto",
          )}
        >
          {preview ? (
            <PreviewBody html={emailSafeHtml} minHeight={inPane ? 320 : 200} />
          ) : (
            <RichTextEditor
              value={body}
              onChange={(next) => onContentChange({ body: next })}
              onDocChange={setBodyDoc}
              onEditorReady={setEditorInstance}
              snippets={snippets}
              variables={variables}
              placeholder="Write your message…"
              minHeight={inPane ? 320 : 200}
              // Editor fills edge-to-edge in both modes — drop the rounded border and go transparent so
              // the body shares the composer's surface (one unified surface) instead of a darker inset void.
              className={cn(
                "rounded-none border-0 bg-transparent",
                inPane ? "h-full" : "h-full sm:h-auto",
              )}
            />
          )}
        </div>

        {!preview && showSignature && (
          <div className="border-t px-3.5 py-2">
            <div className="mb-1 flex items-center justify-between">
              <span className="font-mono text-[10px] tracking-[0.5px] text-muted-foreground/60 uppercase">
                Signature
              </span>
              <button
                type="button"
                onClick={() => setSignatureSkipped(true)}
                aria-label="Remove signature"
                className="inline-flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
              >
                <XIcon className="size-3.5" />
              </button>
            </div>
            {useGmailSig ? (
              // Render the Gmail signature as it'll send — white canvas, images proxied — via the shared email renderer.
              <div className="overflow-hidden rounded-md border">
                <HtmlBody html={gmailSig} accountId={from?.accountId} />
              </div>
            ) : (
              <div className="text-[13px] leading-[1.6] whitespace-pre-line text-muted-foreground">
                {dbSig?.body}
              </div>
            )}
          </div>
        )}

        {files.length > 0 && (
          <div className="flex flex-wrap gap-2 border-t px-3.5 py-2.5">
            {files.map((f) => (
              <span
                key={f.id}
                className="inline-flex items-center gap-2 rounded-lg border bg-secondary px-2.5 py-1.5 text-[12px]"
              >
                <PaperclipIcon className="size-3.5 flex-none text-muted-foreground" />
                <span className="max-w-[180px] truncate font-medium text-foreground">
                  {f.name}
                </span>
                <button
                  type="button"
                  onClick={() => removeFile(f.id)}
                  aria-label={`Remove ${f.name}`}
                  className="flex-none text-muted-foreground transition-colors hover:text-foreground"
                >
                  <XIcon className="size-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPT_FILES}
          onChange={onPickFiles}
          className="hidden"
        />

        {/* Clean footer — hard blockers show on the fields, soft warnings confirm above Send. */}
        <footer className="relative flex min-h-[58px] items-center gap-3 border-t px-3.5 pt-[11px] pb-[max(11px,env(safe-area-inset-bottom))] sm:pb-[11px]">
          {confirmOpen && (
            <>
              {/* biome-ignore lint/a11y/noStaticElementInteractions: a backdrop that only dismisses the confirm. */}
              {/* biome-ignore lint/a11y/useKeyWithClickEvents: Escape dismisses it (section keydown). */}
              <div
                className="fixed inset-0 z-40"
                onClick={() => setConfirmOpen(false)}
              />
              <div className="absolute bottom-full left-3.5 z-50 mb-2 w-[290px] rounded-lg border border-input bg-popover p-3 text-popover-foreground shadow-xl ring-1 ring-foreground/10">
                <p className="mb-2 text-[12.5px] font-medium">Send anyway?</p>
                <ul className="mb-3 space-y-1.5">
                  {guardrails.map((g) => (
                    <li
                      key={g.id}
                      className="flex items-start gap-1.5 text-[12px] text-muted-foreground"
                    >
                      <TriangleAlertIcon className="mt-px size-3.5 shrink-0 text-label-yellow" />
                      {g.message}
                    </li>
                  ))}
                </ul>
                <div className="flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      setConfirmOpen(false);
                      scheduleSend();
                    }}
                  >
                    Send anyway
                  </Button>
                </div>
              </div>
            </>
          )}
          <Button
            size="sm"
            className="shrink-0"
            disabled={!from || working || !hasContent}
            onClick={() => send()}
          >
            <SendIcon data-icon="inline-start" />
            {sending ? "Sending…" : "Send"}
          </Button>
          <KbdGroup className="hidden shrink-0 text-muted-foreground/45 sm:inline-flex">
            <Kbd>⌘</Kbd>
            <Kbd>↵</Kbd>
          </KbdGroup>

          <div className="flex min-w-0 flex-1 items-center">
            {operation === "attachments" ? (
              <span role="status" className="text-[12px] text-muted-foreground">
                Preparing attachments…
              </span>
            ) : error ? (
              <span className="truncate text-[12px] text-label-red">
                {error}
              </span>
            ) : saveStatus !== "idle" ? (
              <span className="hidden items-center gap-1.5 font-mono text-[10.5px] text-muted-foreground/45 sm:inline-flex">
                {saveStatus === "saving" ? (
                  "Saving…"
                ) : (
                  <>
                    <span className="size-1.5 rounded-full bg-success" />
                    Saved
                  </>
                )}
              </span>
            ) : null}
          </div>

          <span className="inline-flex shrink-0 gap-0.5">
            <FooterIcon
              icon={preview ? PenLineIcon : EyeIcon}
              title={preview ? "Back to editing" : "Preview"}
              active={preview}
              onClick={() => setPreview((p) => !p)}
            />
            <FooterIcon
              icon={PaperclipIcon}
              title="Attach files"
              onClick={() => fileInputRef.current?.click()}
            />
            <FooterIcon
              icon={Trash2Icon}
              title={draft ? "Delete draft" : "Discard"}
              onClick={discard}
            />
          </span>
        </footer>

        {snipRect && !preview && (
          // Floating over a text selection. mousedown preventDefault keeps the selection from collapsing
          // before the click lands — a positioning wrapper, not an interactive control (the button inside is).
          // biome-ignore lint/a11y/noStaticElementInteractions: mousedown only guards the selection; the real action is the button.
          <div
            className="fixed z-60 -translate-x-1/2 -translate-y-full"
            style={{ left: snipRect.left, top: snipRect.top - 10 }}
            onMouseDown={(event) => event.preventDefault()}
          >
            <button
              type="button"
              onClick={saveAsSnippet}
              className="inline-flex items-center gap-1.5 rounded-lg border border-input bg-popover px-2.5 py-1.5 text-[12px] text-foreground shadow-xl ring-1 ring-foreground/10 transition-colors hover:bg-muted"
            >
              <BookmarkPlusIcon className="size-3.5 text-muted-foreground" />
              Save as snippet
            </button>
          </div>
        )}
      </section>
    </>
  );
}

/** Escape a plain-text draft and keep its line breaks so it seeds the rich editor (HTML content) without dropping `<addr>` or runs. */
export function plainToHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .split("\n")
    .join("<br>");
}

function FooterIcon({
  icon: Icon,
  title,
  onClick,
  disabled = false,
  active = false,
  className,
}: {
  icon: typeof PaperclipIcon;
  title: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  className?: string;
}) {
  return (
    <IconButton
      label={title}
      active={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "hover:bg-popover data-[active=true]:bg-popover",
        className,
      )}
    >
      <Icon />
    </IconButton>
  );
}
