export type StagedFile = {
  id: string;
  name: string;
  type: string;
  size: number;
  base64: string;
  contentId?: string;
};

type StoredAttachment = {
  attachmentId: string;
  filename?: string;
  mimeType: string;
  size?: number;
  data?: string;
  contentId?: string;
};

/** Restore bytes before opening an editable draft; a failed download must not become an attachment-free save. */
export async function fetchDraftAttachments(
  accountId: string,
  message: {
    id: string;
    attachments?: StoredAttachment[];
    inlineAttachments?: Record<string, StoredAttachment>;
  },
): Promise<StagedFile[]> {
  const attachments = (message.attachments ?? []).map((attachment) => ({
    ...attachment,
  }));
  for (const [contentId, attachment] of Object.entries(
    message.inlineAttachments ?? {},
  )) {
    const existing = attachments.find((item) =>
      attachment.attachmentId
        ? item.attachmentId === attachment.attachmentId
        : attachment.data !== undefined && item.data === attachment.data,
    );
    if (existing) existing.contentId ??= contentId;
    else attachments.push({ ...attachment, contentId });
  }
  if (
    attachments.reduce(
      (total, attachment) => total + (attachment.size ?? 0),
      0,
    ) > 25_000_000
  ) {
    throw new Error("Draft attachments exceed the 25 MB editing limit.");
  }
  const files: StagedFile[] = new Array(attachments.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(3, attachments.length) }, async () => {
      while (cursor < attachments.length) {
        const index = cursor++;
        const attachment = attachments[index];
        let base64 = attachment.data?.replace(/-/g, "+").replace(/_/g, "/");
        if (base64 !== undefined)
          base64 += "=".repeat((4 - (base64.length % 4)) % 4);
        let size = attachment.size ?? 0;
        if (base64 === undefined) {
          const params = new URLSearchParams({
            accountId,
            id: message.id,
            attachment: attachment.attachmentId,
          });
          const response = await fetch(`/api/message?${params}`);
          if (!response.ok)
            throw new Error(
              `Could not restore draft attachment: ${attachment.filename || "inline image"}`,
            );
          const bytes = new Uint8Array(await response.arrayBuffer());
          size = bytes.length;
          let binary = "";
          for (let offset = 0; offset < bytes.length; offset += 0x8000) {
            binary += String.fromCharCode(
              ...bytes.subarray(offset, offset + 0x8000),
            );
          }
          base64 = btoa(binary);
        }
        files[index] = {
          id: crypto.randomUUID(),
          name: attachment.filename || "inline-image",
          type: attachment.mimeType,
          size,
          base64,
          contentId: attachment.contentId,
        };
      }
    }),
  );
  if (
    files.reduce((total, file) => total + file.base64.length, 0) > 34_000_000
  ) {
    throw new Error("Draft attachments exceed the 25 MB editing limit.");
  }
  return files;
}

/** Read a picked file to a base64 string (no data: prefix) for the send payload. */
export function readFileAsBase64(file: File): Promise<StagedFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.onload = () => {
      const result = String(reader.result);
      resolve({
        id: crypto.randomUUID(),
        name: file.name,
        type: file.type || "application/octet-stream",
        size: file.size,
        base64: result.slice(result.indexOf(",") + 1),
      });
    };
    reader.readAsDataURL(file);
  });
}

// Common sendable attachment types — narrows the file picker so you can't pick something Gmail rejects (e.g. executables).
export const ACCEPT_FILES =
  "image/*,video/*,audio/*,.pdf,.txt,.csv,.md,.rtf,.json,.xml,.log,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.pages,.numbers,.key,.zip";

// Extensions Gmail won't send — re-checked after selection (accept is only a hint) so a blocked file fails clearly, not as an opaque send error.
export const BLOCKED_EXT =
  /\.(ade|adp|apk|appx|bat|cab|chm|cmd|com|cpl|dll|dmg|exe|hta|ins|isp|iso|jar|jse?|lib|lnk|mde|msc|msix?|msp|mst|nsh|pif|ps1|scr|sct|shb|sys|vbe?|vxd|wsc|wsf|wsh)$/i;
