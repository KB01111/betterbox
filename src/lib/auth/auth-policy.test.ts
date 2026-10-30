import { describe, expect, test } from "bun:test";
import type { PrismaClient } from "@/generated/prisma/client";
import { createAuth } from "./auth-factory";
import { parseRuntimeConfig } from "../runtime-config";
import type { GoogleProfile } from "better-auth/social-providers";

const config = parseRuntimeConfig({ BETTER_AUTH_URL: "https://test.example", BETTER_AUTH_SECRET: "unit-test-secret-thirty-two-characters-minimum", GOOGLE_CLIENT_ID: "test", GOOGLE_CLIENT_SECRET: "test", ALLOWED_EMAILS: "one@example.test,two@example.test,three@example.test" });
// Policy hooks below do not query the database. Runtime integration covers D1.
const auth = createAuth({} as PrismaClient, config);
const google = auth.options.socialProviders.google;
const profile = (email: string, verified = true) => ({ sub:"stable-google-subject", email, email_verified:verified, name:"Test" }) as GoogleProfile;

describe("Google OAuth admission applies before signup, sign-in and linking", () => {
  test("allows every explicitly approved linked identity", () => {
    for (const email of config.allowedEmails) expect(google.mapProfileToUser(profile(email))).toEqual({});
  });
  test("rejects unlisted and unverified provider identities", () => {
    expect(()=>google.mapProfileToUser(profile("outsider@example.test"))).toThrow();
    expect(()=>google.mapProfileToUser(profile("one@example.test",false))).toThrow();
  });
  test("Gmail admission still requires a verified provider identity", () => {
    const gmailAuth = createAuth({} as PrismaClient, { ...config, allowedEmails: new Set(["*@gmail.com"]) });
    const gmail = gmailAuth.options.socialProviders.google;
    expect(gmail.mapProfileToUser(profile("new.user@gmail.com"))).toEqual({});
    expect(() => gmail.mapProfileToUser(profile("new.user@gmail.com", false))).toThrow();
    expect(() => gmail.mapProfileToUser(profile("user@gmail.com.attacker.test"))).toThrow();
    expect(() => gmail.mapProfileToUser(profile("user@example.com"))).toThrow();
  });
  test("never retains an ID token after provider account writes", async () => {
    google.mapProfileToUser(profile("two@example.test"));
    const account = {id:"record",accountId:"stable-sub",providerId:"google",userId:"owner",idToken:"private-id-token",createdAt:new Date(),updatedAt:new Date()};
    const created = await auth.options.databaseHooks.account.create.before(account);
    const updated = await auth.options.databaseHooks.account.update.before({idToken:"another-id-token"});
    expect(created.data.idToken).toBeNull(); expect(updated.data.idToken).toBeNull();
    expect(created.data.email).toBe("two@example.test");
  });
});
