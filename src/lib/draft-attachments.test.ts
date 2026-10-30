import { afterEach, expect, mock, test } from "bun:test";
import { fetchDraftAttachments } from "@/components/editor/composer-attachments";
import { validateOutgoing } from "./request-security";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("restores draft attachments from their owning message without losing bytes", async () => {
  const urls: string[] = [];
  globalThis.fetch = mock(async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return new Response(new Uint8Array([0, 128, 255]));
  }) as unknown as typeof fetch;
  const files = await fetchDraftAttachments("account-a", {
    id: "message-a",
    attachments: [
      {
        attachmentId: "attachment-a",
        filename: "notes.pdf",
        mimeType: "application/pdf",
        size: 3,
      },
    ],
  });
  expect(
    files.map(({ name, type, base64 }) => ({ name, type, base64 })),
  ).toEqual([{ name: "notes.pdf", type: "application/pdf", base64: "AID/" }]);
  expect(urls).toHaveLength(1);
  const url = new URL(urls[0], "https://betterbox.example");
  expect(url.searchParams.get("accountId")).toBe("account-a");
  expect(url.searchParams.get("id")).toBe("message-a");
});

test("does not silently drop an attachment when restoring it fails", async () => {
  globalThis.fetch = mock(
    async () => new Response("", { status: 404 }),
  ) as unknown as typeof fetch;
  await expect(
    fetchDraftAttachments("account-a", {
      id: "message-a",
      attachments: [
        {
          attachmentId: "missing",
          filename: "notes.pdf",
          mimeType: "application/pdf",
          size: 3,
        },
      ],
    }),
  ).rejects.toThrow("attachment");
});

test("retains each embedded MIME part and its content ID without mutating query data", async () => {
  const named = {
    attachmentId: "file-a",
    filename: "logo.png",
    mimeType: "image/png",
    size: 1,
    data: "YQ",
  };
  const files = await fetchDraftAttachments("account-a", {
    id: "message-a",
    attachments: [named],
    inlineAttachments: {
      "logo@example": named,
      "second@example": {
        attachmentId: "",
        filename: "second.png",
        mimeType: "image/png",
        data: "Yg",
      },
      "third@example": {
        attachmentId: "",
        filename: "third.png",
        mimeType: "image/png",
        data: "Yw",
      },
    },
  });
  expect(
    files.map(({ name, contentId, base64 }) => ({ name, contentId, base64 })),
  ).toEqual([
    { name: "logo.png", contentId: "logo@example", base64: "YQ==" },
    { name: "second.png", contentId: "second@example", base64: "Yg==" },
    { name: "third.png", contentId: "third@example", base64: "Yw==" },
  ]);
  expect(() =>
    validateOutgoing({
      accountId: "account-a",
      attachments: files.map((file) => ({
        filename: file.name,
        mimeType: file.type,
        contentId: file.contentId,
        contentBase64: file.base64,
      })),
    }),
  ).not.toThrow();
  expect("contentId" in named).toBe(false);
});
