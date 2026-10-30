import { expect, test } from "bun:test";
import { migrateAccent } from "./accent-migration";
test("legacy default migrates once while chosen accents and later orange survive", () => {
  expect(migrateAccent("orange", false)).toBe("blue");
  expect(migrateAccent("purple", false)).toBe("purple");
  expect(migrateAccent("orange", true)).toBe("orange");
  expect(migrateAccent(undefined, false)).toBe("blue");
});
