import { expect, test } from "bun:test";
import { desktopChallenge, validDesktopSecret, desktopUserCode } from "./desktop-auth";

test("native handoff uses SHA256 verifier binding and strict random secrets", () => {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  expect(desktopChallenge(verifier)).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  expect(validDesktopSecret(verifier)).toBe(true);
  for (const value of [undefined, "", "A".repeat(42), "A".repeat(44), "https://attacker.test", "!".repeat(43)]) {
    expect(validDesktopSecret(value)).toBe(false);
  }
  expect(desktopUserCode("abcdefgh1234")).toBe("ABCD-EFGH");
});
