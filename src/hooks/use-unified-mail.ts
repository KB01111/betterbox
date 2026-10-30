import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import {
  fetchEmailsPage,
  mailRetry,
  mailRetryDelay,
  type EmailsPage,
} from "@/lib/mail-queries";
import { mergeMailPages } from "@/lib/unified-mail";
import type { Folder } from "@/lib/folders";
import {
  desktopBridge,
  DESKTOP_REFRESH_EVENT,
} from "@/lib/auth/desktop-bridge";
import { shouldPassiveRefresh } from "./refresh-guard";

/** One bounded request per account/page. Mail exists only in Query's memory cache. */
export function useUnifiedMail(
  accountIds: string[],
  folder: Folder,
  search: string,
) {
  const client = useQueryClient();
  const identity = JSON.stringify([accountIds, folder, search]);
  // Keep a small in-memory history when switching folders/accounts repeatedly.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scope changes make the previous page chain inactive.
  useEffect(() => {
    const inactive = client
      .getQueryCache()
      .findAll({ queryKey: ["unified-mail"], type: "inactive" })
      .sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt);
    for (const query of inactive.slice(60))
      client.removeQueries({ queryKey: query.queryKey, exact: true });
  }, [client, identity]);
  const [paging, setPaging] = useState<{
    identity: string;
    tokens: Record<string, string[]>;
  }>({ identity, tokens: {} });
  const tokens = paging.identity === identity ? paging.tokens : {};
  const requests = accountIds.flatMap((accountId) =>
    [undefined, ...(tokens[accountId] ?? [])].map((pageToken) => ({
      accountId,
      pageToken,
    })),
  );
  const queries = useQueries({
    queries: requests.map(({ accountId, pageToken }) => ({
      queryKey: ["unified-mail", accountId, folder, search, pageToken ?? null],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchEmailsPage({
          accountId,
          folder,
          q: search,
          pageToken,
          signal,
          globalSearch: true,
        }),
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: mailRetry,
      retryDelay: mailRetryDelay,
      refetchOnWindowFocus: false,
    })),
  });
  const sources = accountIds.map((accountId) => {
    const pages: EmailsPage[] = [];
    let failed = false;
    for (let i = 0; i < requests.length; i++) {
      if (requests[i].accountId !== accountId) continue;
      if (queries[i].isError) failed = true;
      const page = queries[i].data;
      if (page) pages.push(page);
      else break;
    }
    return { accountId, pages, failed };
  });
  const merged = mergeMailPages(sources);
  const errors = accountIds.flatMap((accountId) => {
    const index = requests.findIndex(
      (request, i) => request.accountId === accountId && queries[i].isError,
    );
    return index < 0
      ? []
      : [
          {
            accountId,
            message:
              queries[index].error?.message ?? "Could not load this account",
          },
        ];
  });
  const loading = queries.some((query) => query.isFetching);
  const pending = sources.some(
    (source) => source.pages.length === 0 && !source.failed,
  );
  const hasMore = sources.some(
    (source) => !!source.pages.at(-1)?.nextPageToken && !source.failed,
  );

  const loadMore = () => {
    if (loading) return;
    const additions = sources
      .filter(
        (source) =>
          merged.advanceAccountIds.includes(source.accountId) && !source.failed,
      )
      .flatMap((source) => {
        const token = source.pages.at(-1)?.nextPageToken;
        return token ? [{ accountId: source.accountId, token }] : [];
      });
    setPaging((current) => {
      const next = current.identity === identity ? { ...current.tokens } : {};
      for (const { accountId, token } of additions) {
        if (!(next[accountId] ?? []).includes(token))
          next[accountId] = [...(next[accountId] ?? []), token];
      }
      return { identity, tokens: next };
    });
  };

  const lastRefresh = useRef(0);
  const hasHistory = Object.values(tokens).some((pages) => pages.length > 0);
  const accountKey = JSON.stringify(accountIds);
  const refresh = useCallback(() => {
    lastRefresh.current = Date.now();
    setPaging({ identity, tokens: {} });
    const selected: string[] = JSON.parse(accountKey);
    for (const accountId of selected)
      void client.invalidateQueries({
        queryKey: ["unified-mail", accountId],
        refetchType: "none",
      });
    // Only refetch the current first pages; old cursor chains are dropped.
    void client.refetchQueries({
      predicate: (query) =>
        query.queryKey[0] === "unified-mail" &&
        selected.includes(String(query.queryKey[1])) &&
        query.queryKey[2] === folder &&
        query.queryKey[3] === search &&
        query.queryKey[4] === null,
    });
    void client.invalidateQueries({ queryKey: ["accounts"] });
    void client.invalidateQueries({ queryKey: ["account-profile"] });
  }, [client, identity, accountKey, folder, search]);

  useEffect(() => {
    const foreground = () => {
      if (
        shouldPassiveRefresh(
          document.visibilityState === "visible",
          hasHistory,
          Date.now(),
          lastRefresh.current,
        )
      )
        refresh();
    };
    const timer = desktopBridge("mail")
      ? undefined
      : window.setInterval(foreground, 60_000);
    window.addEventListener("focus", foreground);
    window.addEventListener(DESKTOP_REFRESH_EVENT, foreground);
    document.addEventListener("visibilitychange", foreground);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", foreground);
      window.removeEventListener(DESKTOP_REFRESH_EVENT, foreground);
      document.removeEventListener("visibilitychange", foreground);
    };
  }, [refresh, hasHistory]);

  // A refreshed first page invalidates the tokens derived from its previous snapshot.
  const firstVersions = useMemo(
    () =>
      accountIds
        .map((accountId) => {
          const index = requests.findIndex(
            (request) => request.accountId === accountId,
          );
          return `${accountId}:${queries[index]?.dataUpdatedAt ?? 0}`;
        })
        .join("|"),
    [accountIds, requests, queries],
  );
  const versionsRef = useRef(firstVersions);
  useEffect(() => {
    if (versionsRef.current !== firstVersions) {
      versionsRef.current = firstVersions;
      setPaging((current) =>
        Object.keys(current.tokens).length ? { identity, tokens: {} } : current,
      );
    }
  }, [firstVersions, identity]);

  const retryAccount = (accountId: string) => {
    for (let i = 0; i < requests.length; i++)
      if (requests[i].accountId === accountId && queries[i].isError)
        void queries[i].refetch();
  };
  return {
    ...merged,
    errors,
    loading,
    pending,
    hasMore,
    loadMore,
    refresh,
    retryAccount,
  };
}
