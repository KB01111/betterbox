import { GmailApiError } from "./gmail/api.server";
import { ApiInputError } from "./request-security";

/** JSON Response helper for API route handlers. */
export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store, private",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });
}

/** Preserve actionable provider statuses without logging private provider data. */
export function jsonError(
  context: string,
  error: unknown,
  status = 502,
  extra?: Record<string, unknown>,
) {
  if (error instanceof ApiInputError)
    return json({ ...extra, error: error.message }, error.status);
  if (error instanceof GmailApiError) {
    const reconnect = error.status === 401 || error.status === 403;
    const limited = error.status === 429;
    const response = json(
      {
        ...extra,
        error: error.message,
        code: reconnect
          ? "reconnect_required"
          : limited
            ? "rate_limited"
            : "upstream_error",
      },
      reconnect ? 403 : limited ? 429 : 502,
    );
    if (limited) response.headers.set("retry-after", "30");
    return response;
  }
  console.error(`[api] ${context}: request failed (${status})`);
  return json({ ...extra, error: "Request failed" }, status);
}
