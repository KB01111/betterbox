/** Resource policy is enforced before sender markup, including escaped CSS URLs. */
export function emailCss(
  css: string,
  origin: string,
  remoteAllowed: boolean,
): string {
  return css
    .replace(/@import\b[^;]*;?/gi, "")
    .replace(
      /url\(\s*(['"]?)\s*([^)'"]+)\s*\1\s*\)/gi,
      (_match, _quote: string, source: string) => {
        const rewritten = emailImageSource(
          source.trim(),
          origin,
          remoteAllowed,
        );
        return rewritten ? `url("${rewritten}")` : "url()";
      },
    );
}

export function emailInlineSource(
  attachment: { attachmentId: string; mimeType: string; data?: string },
  origin: string,
  accountId: string,
  messageId: string,
): string | null {
  if (!/^image\/(png|jpeg|gif|webp|avif)$/i.test(attachment.mimeType))
    return null;
  if (attachment.data !== undefined) {
    const data = attachment.data.replace(/-/g, "+").replace(/_/g, "/");
    return emailImageSource(
      `data:${attachment.mimeType};base64,${data}${"=".repeat((4 - (data.length % 4)) % 4)}`,
      origin,
      false,
    );
  }
  if (!attachment.attachmentId) return null;
  return `${origin}/api/message?${new URLSearchParams({ accountId, id: messageId, attachment: attachment.attachmentId, mime: attachment.mimeType })}`;
}

export function emailDocument(
  sanitizedHtml: string,
  origin = "",
  remoteAllowed = false,
): string {
  // Before consent, even escaped CSS can only load Gmail inline attachments.
  const imageSources = remoteAllowed
    ? "'self'"
    : origin
      ? `${origin}/api/message`
      : "";
  const csp = `default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src ${imageSources} data: blob:; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'`;
  const policy = `<meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer">`;
  return /<head>/i.test(sanitizedHtml)
    ? sanitizedHtml.replace(/<head>/i, `<head>${policy}`)
    : policy + sanitizedHtml;
}

export function emailImageSource(
  src: string,
  origin: string,
  remoteAllowed: boolean,
): string | null {
  const value = src.trim();
  if (/^cid:[^\s<>]+$/i.test(value)) return value;
  if (
    /^data:image\/(?:png|jpeg|gif|webp|avif);base64,[a-z0-9+/=\s]+$/i.test(
      value,
    )
  )
    return value;
  if (!remoteAllowed) return null;
  let url: URL;
  try {
    url = new URL(value, origin);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  return `${origin}/api/image-proxy?url=${encodeURIComponent(url.href)}`;
}
