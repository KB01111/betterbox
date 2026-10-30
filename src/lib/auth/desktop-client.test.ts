import { expect, test } from "bun:test";
import { desktopConnectSearch } from "./desktop-client";

test("completed linking handles router-decoded numeric and raw URL query flags", () => {
  expect(desktopConnectSearch({ id: "ticket", connected: 1 }).connected).toBe(true);
  expect(desktopConnectSearch({ connected: "1" }).connected).toBe(true);
  for (const connected of [undefined, 0, "0", false, {}, "true"]) {
    expect(desktopConnectSearch({ connected }).connected).toBe(false);
  }
  expect(desktopConnectSearch({ id: {}, error: [] })).toEqual({ id: "", connected: false, error: undefined });
});
