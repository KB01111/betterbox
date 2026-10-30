/** Cursor history stays stable until the user explicitly refreshes. */
export function shouldPassiveRefresh(
  visible: boolean,
  hasHistory: boolean,
  now: number,
  lastRefresh: number,
) {
  return visible && !hasHistory && now - lastRefresh > 15_000;
}
