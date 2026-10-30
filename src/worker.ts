import start from "@tanstack/react-start/server-entry";
import { withRuntime, type RuntimeBindings } from "@/lib/runtime.server";
import { guardApiRequest, secureResponse } from "@/lib/request-security";
import { json } from "@/lib/json-response";
import { withGmailBudget } from "@/lib/gmail/api.server";
import { apiErrorResponse } from "@/lib/api-error";
import { handleDesktopAuth } from "@/lib/desktop-auth.server";

export default {
  async fetch(request: Request, bindings: RuntimeBindings): Promise<Response> {
    return withRuntime(bindings, () => withGmailBudget(async () => {
      const url = new URL(request.url);
      try {
        if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/_serverFn/")) {
          // Better Auth validates its own CSRF/state; Google callbacks are cross-site.
          const guarded = url.pathname.startsWith("/api/auth/") ? null : guardApiRequest(request);
          if (guarded) return secureResponse(guarded);
          if (bindings.API_RATE_LIMITER) {
            const result = await bindings.API_RATE_LIMITER.limit({ key: request.headers.get("cf-connecting-ip") || "local" });
            if (!result.success) {
              const response = json({ error: "Too many requests. Wait a minute, then retry." }, 429);
              response.headers.set("retry-after", "60");
              return secureResponse(response);
            }
          }
        }
        const response = secureResponse(url.pathname.startsWith("/api/desktop/") ? await handleDesktopAuth(request) : await start.fetch(request));
        if (response.headers.get("content-type")?.includes("text/html") && !response.headers.has("content-security-policy")) {
          response.headers.set("content-security-policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self'; connect-src 'self'; frame-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'");
        }
        return response;
      } catch (error) {
        return secureResponse(apiErrorResponse(error));
      }
    }, request.signal));
  },
};
