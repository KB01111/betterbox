import { describe, expect, test } from "bun:test";
import { parseRuntimeConfig, isAllowedEmail } from "./runtime-config";

const valid = {
  BETTER_AUTH_URL: "https://betterbox.example.workers.dev",
  BETTER_AUTH_SECRET: "test-only-strong-secret-at-least-thirty-two-characters",
  GOOGLE_CLIENT_ID: "test-client",
  GOOGLE_CLIENT_SECRET: "test-client-secret",
  ALLOWED_EMAILS: "One@example.com, two@example.com",
  IS_SELF_HOSTED: "true",
};

describe("private runtime configuration", () => {
  test("normalizes and matches exact allowed addresses", () => {
    const config = parseRuntimeConfig(valid);
    expect(isAllowedEmail(config, " ONE@example.com ")).toBe(true);
    expect(isAllowedEmail(config, "one@example.com.attacker.test")).toBe(false);
    expect(isAllowedEmail(config, "other@example.com")).toBe(false);
  });
  test("fails closed without an access list or strong secret", () => {
    expect(() => parseRuntimeConfig({ ...valid, ALLOWED_EMAILS: "" })).toThrow("ALLOWED_EMAILS");
    expect(() => parseRuntimeConfig({ ...valid, BETTER_AUTH_SECRET: "short" })).toThrow("BETTER_AUTH_SECRET");
  });
  test("explicit Gmail admission accepts Gmail only and preserves exact entries", () => {
    const config = parseRuntimeConfig({ ...valid, ALLOWED_EMAILS: "*@gmail.com,one@example.com" });
    expect(isAllowedEmail(config, " New.User+mail@GMAIL.com ")).toBe(true);
    expect(isAllowedEmail(config, "one@example.com")).toBe(true);
    for (const email of ["other@example.com", "user@gmail.com.attacker.test", "user@sub.gmail.com", "@gmail.com", "user@@gmail.com", "user name@gmail.com"]) {
      expect(isAllowedEmail(config, email)).toBe(false);
    }
  });
  test("rejects unrestricted and other domain wildcards", () => {
    for (const value of ["*", "*@example.com", "user*@gmail.com", "*@gmail.com.attacker.test"]) {
      expect(() => parseRuntimeConfig({ ...valid, ALLOWED_EMAILS: value })).toThrow("ALLOWED_EMAILS");
    }
  });
  test("requires HTTPS outside loopback development", () => {
    expect(() => parseRuntimeConfig({ ...valid, BETTER_AUTH_URL: "http://public.example" })).toThrow("HTTPS");
    expect(parseRuntimeConfig({ ...valid, BETTER_AUTH_URL: "http://localhost:3000" }).baseURL).toBe("http://localhost:3000");
    expect(() => parseRuntimeConfig({ ...valid, BETTER_AUTH_URL: "https://user:pass@example.com/path" })).toThrow();
  });
  test("accepts optional GitHub only as a complete pair", () => {
    expect(parseRuntimeConfig(valid).github).toBeUndefined();
    expect(() => parseRuntimeConfig({ ...valid, GITHUB_CLIENT_ID: "partial" })).toThrow("GITHUB");
  });
});
