type OpenTicket = { userId: string | undefined };

/** An async draft load owns the next composer until it finishes or its user leaves. */
export class ComposerOpenGuard {
  private ticket: OpenTicket | null = null;

  get pending() {
    return this.ticket !== null;
  }
  begin(userId: string | undefined): OpenTicket | null {
    if (this.ticket) return null;
    this.ticket = { userId };
    return this.ticket;
  }
  canCommit(ticket: OpenTicket, userId: string | undefined): boolean {
    return this.ticket === ticket && ticket.userId === userId;
  }
  finish(ticket: OpenTicket) {
    if (this.ticket === ticket) this.ticket = null;
  }
  cancel() {
    this.ticket = null;
  }
}
