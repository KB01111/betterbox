export type MailRow = { id: string; internalDate?: number };
export type MailPageSource<T extends MailRow = MailRow> = {
  accountId: string;
  pages: { emails: T[]; nextPageToken?: string }[];
  failed?: boolean;
};

export function mergeMailPages<T extends MailRow>(
  sources: MailPageSource<T>[],
): {
  rows: (T & { accountId: string })[];
  advanceAccountIds: string[];
} {
  const frontiers = sources
    .filter((source) => !source.failed)
    .map((source) => {
      const last = source.pages.at(-1);
      if (!last) return { accountId: source.accountId, date: Infinity };
      if (!last.nextPageToken)
        return { accountId: source.accountId, date: -Infinity };
      const tail = last.emails.at(-1);
      return {
        accountId: source.accountId,
        date: tail?.internalDate ?? Infinity,
      };
    });
  const threshold = Math.max(
    -Infinity,
    ...frontiers.map((frontier) => frontier.date),
  );
  const rows: (T & { accountId: string })[] = [];
  for (const source of sources) {
    const seen = new Set<string>();
    for (const page of source.pages) {
      for (const email of page.emails) {
        if (seen.has(email.id)) continue;
        seen.add(email.id);
        if ((email.internalDate ?? 0) > threshold)
          rows.push({ ...email, accountId: source.accountId });
      }
    }
  }
  rows.sort(
    (a, b) =>
      (b.internalDate ?? 0) - (a.internalDate ?? 0) ||
      a.accountId.localeCompare(b.accountId) ||
      a.id.localeCompare(b.id),
  );
  return {
    rows,
    // Strictly newer than the tail: an unseen next page can contain equal timestamps.
    advanceAccountIds: frontiers
      .filter(
        (frontier) => frontier.date === threshold && frontier.date > -Infinity,
      )
      .map((frontier) => frontier.accountId),
  };
}

export function createRequestLimiter(maximum: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return function run<T>(
    task: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const abort = () => {
        const index = queue.indexOf(start);
        if (index >= 0) queue.splice(index, 1);
        reject(signal?.reason ?? new DOMException("Cancelled", "AbortError"));
      };
      const start = () => {
        signal?.removeEventListener("abort", abort);
        if (signal?.aborted) {
          abort();
          return;
        }
        active++;
        void Promise.resolve()
          .then(task)
          .then(resolve, reject)
          .finally(() => {
            active--;
            queue.shift()?.();
          });
      };
      if (signal?.aborted) {
        abort();
        return;
      }
      if (active < maximum) start();
      else {
        queue.push(start);
        signal?.addEventListener("abort", abort, { once: true });
      }
    });
  };
}
