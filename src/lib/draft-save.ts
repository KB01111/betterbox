export type DraftIdentity = { draftId: string; messageId: string };
export type DraftPayload = {
  accountId: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  html: string;
  threadId?: string;
  inReplyTo?: string;
  references?: string;
  attachments?: {
    filename: string;
    mimeType: string;
    contentBase64: string;
    contentId?: string;
  }[];
};
export class DraftSaveQueue {
  identity: DraftIdentity | null = null;
  started = false;
  active = true;
  private operation: "send" | "close" | "attachments" | null = null;
  private readonly listeners = new Set<() => void>();
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getOperation = () => this.operation;
  beginOperation(operation: "send" | "close" | "attachments"): boolean {
    if (!this.active || this.operation) return false;
    this.operation = operation;
    for (const listener of this.listeners) listener();
    return true;
  }
  endOperation() {
    this.operation = null;
    for (const listener of this.listeners) listener();
  }
  cancel() {
    this.active = false;
    this.endOperation();
  }
  private tail: Promise<unknown> = Promise.resolve();
  private resolving: Promise<DraftIdentity | null> | null = null;
  constructor(
    readonly accountId: string,
    private readonly persist: (
      payload: DraftPayload & { draftId?: string },
    ) => Promise<DraftIdentity | null>,
    private readonly resolveExisting?: () => Promise<DraftIdentity | null>,
  ) {}
  async ready(): Promise<DraftIdentity | null> {
    if (this.identity || !this.resolveExisting) return this.identity;
    this.resolving ??= this.resolveExisting();
    try {
      const resolved = await this.resolving;
      if (!resolved)
        throw new Error(
          "Could not find this draft. Reopen it from Drafts and try again.",
        );
      this.identity = resolved;
      return resolved;
    } finally {
      this.resolving = null;
    }
  }
  save(payload: DraftPayload): Promise<DraftIdentity> {
    if (!this.active)
      return Promise.reject(new Error("This composer is no longer active."));
    if (payload.accountId !== this.accountId) {
      return Promise.reject(
        new Error("The draft belongs to a different sending account."),
      );
    }
    this.started = true;
    const operation = this.tail.then(async () => {
      await this.ready();
      if (!this.active) throw new Error("This composer is no longer active.");
      const result = await this.persist({
        ...payload,
        draftId: this.identity?.draftId,
      });
      if (!result)
        throw new Error(
          "Could not save draft. Your message is still open; try again.",
        );
      this.identity = result;
      return result;
    });
    // A failed save stays visible to its caller while a later retry can proceed.
    this.tail = operation.catch(() => {});
    return operation;
  }
  async drain(): Promise<DraftIdentity | null> {
    await this.tail;
    return this.identity;
  }
}
export function resolveSender<T extends { accountId: string; email: string }>(
  accounts: T[],
  explicit: string | null,
  preferred?: string | null,
  primaryEmail?: string,
): T | null {
  if (explicit)
    return accounts.find((account) => account.accountId === explicit) ?? null;
  return (
    accounts.find((account) => account.accountId === preferred) ??
    accounts.find((account) => account.email === primaryEmail) ??
    accounts[0] ??
    null
  );
}
