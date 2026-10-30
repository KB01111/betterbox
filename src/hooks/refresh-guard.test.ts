import { expect, test } from "bun:test";
import { shouldPassiveRefresh } from "./refresh-guard";
test("passive refresh keeps historical cursor chains and coalesces resume events", () => {
  expect(shouldPassiveRefresh(true, false, 20_000, 0)).toBe(true);
  expect(shouldPassiveRefresh(true, true, 20_000, 0)).toBe(false);
  expect(shouldPassiveRefresh(false, false, 20_000, 0)).toBe(false);
  expect(shouldPassiveRefresh(true, false, 20_000, 19_999)).toBe(false);
});
