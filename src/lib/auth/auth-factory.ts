import { tanstackStartCookies } from "better-auth/tanstack-start";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { prismaAdapter } from "better-auth/adapters/prisma";
import type { PrismaClient } from "@/generated/prisma/client";
import { isAllowedEmail, type RuntimeConfig } from "@/lib/runtime-config";

export function createAuth(prisma: PrismaClient, config: RuntimeConfig) {
  // One factory per Worker request: never share OAuth identity across callbacks.
  let googleEmail: string | undefined;
  const requireAllowed = (email: string, verified = true) => {
    if (!verified || !isAllowedEmail(config, email)) throw new APIError("FORBIDDEN", { code: "email_not_allowed", message: "This verified Google account is not on this instance's access list." });
  };
  return betterAuth({
    database: prismaAdapter(prisma, { provider: "sqlite", transaction: false }),
    baseURL: config.baseURL,
    secret: config.secret,
    trustedOrigins: [config.baseURL],
    disabledPaths: ["/get-access-token", "/refresh-token"],
    telemetry: { enabled: false },
    logger: { disabled: true },
    rateLimit: { enabled: false }, // Worker binding supplies shared limits.
    advanced: { useSecureCookies: config.baseURL.startsWith("https:"), defaultCookieAttributes: { httpOnly: true, sameSite: "lax" } },
    session: { cookieCache: { enabled: false } },
    socialProviders: {
      google: {
        ...config.google,
        accessType: "offline",
        prompt: "select_account consent",
        scope: ["https://www.googleapis.com/auth/gmail.modify"],
        mapProfileToUser: (profile) => {
          requireAllowed(profile.email, profile.email_verified === true);
          googleEmail = profile.email.toLowerCase();
          return {};
        },
      },
      ...(config.github ? { github: config.github } : {}),
    },
    user: { additionalFields: { role: { type: "string", required: false, defaultValue: "USER", input: false } } },
    account: {
      encryptOAuthTokens: true,
      additionalFields: { email: { type: "string", required: false, input: false } },
      accountLinking: { enabled: true, trustedProviders: ["google"], allowDifferentEmails: true, disableImplicitLinking: true },
    },
    databaseHooks: {
      user: { create: { before: async (user) => { requireAllowed(user.email, user.emailVerified); } } },
      session: { create: { before: async (session) => {
        const user = await prisma.user.findUnique({ where: { id: session.userId }, select: { email: true, emailVerified: true } });
        if (!user) return false;
        requireAllowed(user.email, user.emailVerified);
      } } },
      account: {
        create: { before: async (account) => ({ data: { ...account, idToken: null, ...(googleEmail ? { email: googleEmail } : {}) } }) },
        update: { before: async (account) => ({ data: { ...account, idToken: null, ...(googleEmail ? { email: googleEmail } : {}) } }) },
      },
    },
    hooks: { after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/get-session") return;
      const returned = ctx.context.returned as { user?: { email?: string } } | null;
      if (returned?.user?.email && !isAllowedEmail(config, returned.user.email)) {
        throw new APIError("FORBIDDEN", { code: "email_not_allowed", message: "Access to this instance has been removed." });
      }
    }) },
    onAPIError: { errorURL: "/sign-in" },
    plugins: [tanstackStartCookies()],
  });
}
