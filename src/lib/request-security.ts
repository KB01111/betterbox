import { json } from "./json-response";

export const MAX_JSON_BYTES = 1_048_576;
export const MAX_MAIL_JSON_BYTES = 36_000_000;
export const MAX_ATTACHMENT_BASE64_BYTES = 34_000_000;
export const RASTER_IMAGE_TYPE = /^image\/(?:png|jpeg|gif|webp|avif)$/i;

export class ApiInputError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiInputError";
  }
}

/** Cookies are a site boundary; writes additionally need an exact origin. */
export function guardApiRequest(request: Request): Response | null {
  const site = request.headers.get("sec-fetch-site");
  if (site === "cross-site" || site === "same-site")
    return json({ error: "Forbidden" }, 403);
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return null;
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return json({ error: "Forbidden" }, 403);
  if (
    !/^application\/json(?:\s*;|$)/i.test(
      request.headers.get("content-type") ?? "",
    )
  )
    return json({ error: "JSON is required" }, 415);
  const length = Number(request.headers.get("content-length"));
  const path = new URL(request.url).pathname;
  const max =
    path === "/api/send" || path === "/api/draft"
      ? MAX_MAIL_JSON_BYTES
      : MAX_JSON_BYTES;
  if (Number.isFinite(length) && length > max)
    return json({ error: "Request too large" }, 413);
  return null;
}

export function secureResponse(response: Response): Response {
  const secured = new Response(response.body, response);
  secured.headers.set("cache-control", "no-store, private");
  secured.headers.set("x-content-type-options", "nosniff");
  secured.headers.set("referrer-policy", "no-referrer");
  secured.headers.set("cross-origin-resource-policy", "same-origin");
  return secured;
}

export function attachmentResponse(
  bytes: ArrayBuffer,
  claimedMime: string,
  download: boolean,
  rawFilename = "attachment",
  view = false,
): Response {
  const mime = claimedMime.toLowerCase();
  const inline =
    !download &&
    (RASTER_IMAGE_TYPE.test(mime) ||
      (view && /^(application\/pdf|text\/plain)$/.test(mime)));
  const filename =
    rawFilename.replace(/[^\w.\- ]+/g, "_").slice(0, 200) || "attachment";
  const type = /^[\w.+-]+\/[\w.+-]+$/.test(mime)
    ? mime
    : "application/octet-stream";
  return secureResponse(
    new Response(bytes, {
      headers: {
        "content-type": inline ? mime : type,
        "content-disposition": `${inline ? "inline" : "attachment"}; filename="${filename}"`,
        // Native PDF viewers handle isolation; a CSP sandbox can prevent them loading.
        "content-security-policy":
          inline && mime === "application/pdf"
            ? "default-src 'none'; object-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
            : "sandbox; default-src 'none'",
      },
    }),
  );
}

/** Count bytes before decoding/parsing; Content-Length alone is untrusted. */
export async function readJsonBody(
  request: Request,
  max = MAX_JSON_BYTES,
): Promise<Record<string, unknown>> {
  const rejected = guardApiRequest(request);
  if (rejected)
    throw new ApiInputError(
      rejected.status,
      rejected.status === 413
        ? "Request too large"
        : rejected.status === 415
          ? "JSON is required"
          : "Forbidden",
    );
  if (!request.body) throw new ApiInputError(400, "JSON object is required");
  const reader = request.body.getReader();
  const chunks: string[] = [];
  const decoder = new TextDecoder();
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        await reader.cancel().catch(() => {});
        throw new ApiInputError(413, "Request too large");
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
  } finally {
    reader.releaseLock();
  }
  chunks.push(decoder.decode());
  let value: unknown;
  try {
    value = JSON.parse(chunks.join(""));
  } catch {
    throw new ApiInputError(400, "Invalid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ApiInputError(400, "JSON object is required");
  return value as Record<string, unknown>;
}

export function stringField(
  body: Record<string, unknown>,
  key: string,
  max: number,
  required: true,
): string;
export function stringField(
  body: Record<string, unknown>,
  key: string,
  max?: number,
  required?: boolean,
): string | undefined;
export function stringField(
  body: Record<string, unknown>,
  key: string,
  max = 2000,
  required = false,
): string | undefined {
  const value = body[key];
  if (value === undefined) {
    if (required) throw new ApiInputError(400, `${key} is required`);
    return undefined;
  }
  if (typeof value !== "string" || value.length > max || value.includes("\0"))
    throw new ApiInputError(400, `Invalid ${key}`);
  if (required && !value.trim())
    throw new ApiInputError(400, `${key} is required`);
  return value;
}

export function identifierField(
  body: Record<string, unknown>,
  key: string,
  required: true,
): string;
export function identifierField(
  body: Record<string, unknown>,
  key: string,
  required?: boolean,
): string | undefined;
export function identifierField(
  body: Record<string, unknown>,
  key: string,
  required = false,
): string | undefined {
  const value = stringField(body, key, 4096, required);
  if (value !== undefined && !/^[A-Za-z0-9_-]+$/.test(value))
    throw new ApiInputError(400, `Invalid ${key}`);
  return value;
}

export function queryIdentifier(url: URL, key: string, required: true): string;
export function queryIdentifier(
  url: URL,
  key: string,
  required?: boolean,
): string | undefined;
export function queryIdentifier(
  url: URL,
  key: string,
  required = false,
): string | undefined {
  const value = url.searchParams.get(key);
  return identifierField(value === null ? {} : { [key]: value }, key, required);
}

export function enumField<T extends string>(
  body: Record<string, unknown>,
  key: string,
  values: readonly T[],
): T {
  const value = body[key];
  if (typeof value !== "string" || !values.includes(value as T))
    throw new ApiInputError(400, `Invalid ${key}`);
  return value as T;
}

export function validateOutgoing(
  body: Record<string, unknown>,
  requireRecipient = false,
) {
  const accountId = identifierField(body, "accountId", true);
  const draftId = identifierField(body, "draftId");
  const threadId = identifierField(body, "threadId");
  const headers: Record<string, string | undefined> = {};
  for (const key of ["to", "cc", "bcc", "subject", "inReplyTo", "references"]) {
    const value = stringField(
      body,
      key,
      key === "references" ? 16000 : 10000,
      requireRecipient && key === "to",
    );
    if (value && /[\r\n]/.test(value))
      throw new ApiInputError(400, `Invalid ${key}`);
    headers[key] = value?.trim();
  }
  const text = stringField(body, "body", MAX_JSON_BYTES) ?? "";
  const html = stringField(body, "html", MAX_JSON_BYTES);
  const rawAttachments = body.attachments ?? [];
  if (!Array.isArray(rawAttachments) || rawAttachments.length > 100)
    throw new ApiInputError(400, "Invalid attachments");
  let total = 0;
  const attachments = rawAttachments.map((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw new ApiInputError(400, "Invalid attachment");
    const attachment = item as Record<string, unknown>;
    const filename = stringField(attachment, "filename", 255, true);
    const mimeType = stringField(attachment, "mimeType", 127, true);
    if (/[\r\n]/.test(filename) || !/^[\w.+-]+\/[\w.+-]+$/.test(mimeType))
      throw new ApiInputError(400, "Invalid attachment");
    const contentBase64 = stringField(
      attachment,
      "contentBase64",
      MAX_ATTACHMENT_BASE64_BYTES,
    );
    if (contentBase64 === undefined)
      throw new ApiInputError(400, "Attachment encoding is required");
    const contentId = stringField(attachment, "contentId", 254);
    if (contentId !== undefined && !/^[A-Za-z0-9._@+-]+$/.test(contentId))
      throw new ApiInputError(400, "Invalid attachment content ID");
    total += contentBase64.length;
    if (total > MAX_ATTACHMENT_BASE64_BYTES)
      throw new ApiInputError(413, "Attachments too large (25 MB max)");
    if (
      contentBase64.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(contentBase64)
    )
      throw new ApiInputError(400, "Invalid attachment encoding");
    return {
      filename,
      mimeType,
      contentBase64,
      ...(contentId ? { contentId } : {}),
    };
  });
  return {
    accountId,
    draftId,
    threadId,
    to: headers.to ?? "",
    cc: headers.cc,
    bcc: headers.bcc,
    subject: headers.subject ?? "",
    inReplyTo: headers.inReplyTo,
    references: headers.references,
    body: text,
    html,
    attachments,
  };
}

/** Only operator-trusted hosts can drive egress; DNS prechecks do not pin fetch. */
export function safeImageTarget(
  raw: string,
  trustedHosts: readonly string[],
): URL | null {
  if (raw.length > 8192) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  )
    return null;
  if (
    !host.includes(".") ||
    host.endsWith(".") ||
    host.includes(":") ||
    /^[\d.]+$/.test(host) ||
    /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid)$/.test(host)
  )
    return null;
  if (
    !trustedHosts.some(
      (allowed) => allowed.toLowerCase() === host && !allowed.includes("*"),
    )
  )
    return null;
  url.hash = "";
  return url;
}
