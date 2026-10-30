import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { auth } from "@/lib/auth/auth";
import { hasAuthConfiguration } from "@/lib/runtime.server";

/**
 * Server-resolved session for route guards. Called from _app's beforeLoad so SSR
 * knows sign-in state — the authenticated shell never flashes before the landing
 * page (or vice versa). On the client it's an RPC; useSession() then takes over
 * for live updates (sign-out, account linking).
 */
export const fetchSession = createServerFn({ method: "GET" }).handler(
  async () => {
    const request = getRequest();
    if (!hasAuthConfiguration()) return null;
    try {
      const session = await auth.api.getSession({ headers: request.headers });
      return session ?? null;
    } catch (error) {
      if (error && typeof error === "object" && "statusCode" in error && [401,403].includes(Number(error.statusCode))) return null;
      throw error;
    }
  },
);

export type ServerSession = Awaited<ReturnType<typeof fetchSession>>;

/**
 * Whether Google OAuth is configured. A fresh self-host has no GOOGLE_CLIENT_ID/
 * SECRET yet, so the sign-in page checks this to show setup guidance instead of a
 * button that throws an opaque 500 mid-flow.
 */
export const fetchGoogleConfigured = createServerFn({ method: "GET" }).handler(
  () => hasAuthConfiguration(),
);
