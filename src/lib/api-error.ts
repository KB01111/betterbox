import { ApiInputError } from "./request-security";
import { ConfigurationError } from "./runtime-config";
import { GmailApiError } from "./gmail/api.server";
import { json } from "./json-response";

export function apiErrorResponse(error: unknown): Response {
  if (error instanceof Response) return error;
  if (error instanceof ApiInputError) return json({ error: error.message }, error.status);
  if (error instanceof ConfigurationError) return json({ error: "Instance setup is incomplete. Review Cloudflare bindings and required secrets." }, 503);
  if (error instanceof GmailApiError) return json({ error: error.message, code: [401,403].includes(error.status) ? "reconnect_required" : error.status === 429 ? "rate_limited" : "upstream_unavailable" }, [401,403].includes(error.status) ? 403 : error.status === 429 ? 429 : 502);
  const status = error && typeof error === "object" && "statusCode" in error ? Number(error.statusCode) : 500;
  if ([401,403].includes(status)) return json({ error: "Sign in again with an account on this instance's access list." }, status);
  console.error("[api] request failed", { status: 500 });
  return json({ error: "Request failed. Retry or reconnect the affected account." }, 500);
}
