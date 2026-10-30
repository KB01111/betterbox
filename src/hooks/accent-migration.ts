import type { AccentId } from "./use-settings";
export function migrateAccent(
  accent: AccentId | undefined,
  migrated: boolean,
): AccentId {
  return accent === undefined || (!migrated && accent === "orange")
    ? "blue"
    : accent;
}
