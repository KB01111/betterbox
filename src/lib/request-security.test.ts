import { describe, expect, test } from "bun:test";
import { json } from "./json-response";
import {
  ApiInputError,
  guardApiRequest,
  readJsonBody,
  secureResponse,
  validateOutgoing,
  safeImageTarget,
  attachmentResponse,
} from "./request-security";

const post = (headers: Record<string, string> = {}, body = "{}") =>
  new Request("https://mail.example/api/send", {
    method: "POST",
    headers: {
      origin: "https://mail.example",
      "content-type": "application/json",
      ...headers,
    },
    body,
  });

describe("private API trust boundary", () => {
  test("explicit preview permits PDF/plain text while download and active formats stay attachments", () => {
    for (const mime of ["application/pdf", "text/plain"]) {
      expect(
        attachmentResponse(
          new ArrayBuffer(1),
          mime,
          false,
          "file",
          true,
        ).headers.get("content-disposition"),
      ).toStartWith("inline;");
      expect(
        attachmentResponse(
          new ArrayBuffer(1),
          mime,
          true,
          "file",
          true,
        ).headers.get("content-disposition"),
      ).toStartWith("attachment;");
      expect(
        attachmentResponse(new ArrayBuffer(1), mime, false).headers.get(
          "content-disposition",
        ),
      ).toStartWith("attachment;");
    }
    expect(
      attachmentResponse(
        new ArrayBuffer(1),
        "text/html",
        false,
        "file",
        true,
      ).headers.get("content-disposition"),
    ).toStartWith("attachment;");
    expect(
      attachmentResponse(
        new ArrayBuffer(1),
        "application/pdf",
        false,
        "file",
        true,
      ).headers.get("content-security-policy"),
    ).not.toContain("sandbox");
    expect(
      attachmentResponse(
        new ArrayBuffer(1),
        "text/html",
        false,
        "file",
        true,
      ).headers.get("content-security-policy"),
    ).toContain("sandbox");
  });
  test("SVG and HTML attachments are downloaded under a scriptless policy", () => {
    for (const mime of [
      "image/svg+xml",
      "text/html",
      "application/octet-stream",
    ]) {
      const response = attachmentResponse(
        new ArrayBuffer(1),
        mime,
        false,
        'bad"\r\nname',
      );
      expect(response.headers.get("content-disposition")).toStartWith(
        "attachment;",
      );
      expect(response.headers.get("content-security-policy")).toBe(
        "sandbox; default-src 'none'",
      );
      expect(response.headers.get("cache-control")).toContain("no-store");
    }
    expect(
      attachmentResponse(new ArrayBuffer(1), "image/png", false).headers.get(
        "content-disposition",
      ),
    ).toStartWith("inline;");
  });
  test("requires same-origin JSON mutations and rejects same-site siblings", () => {
    expect(guardApiRequest(post())).toBeNull();
    expect(
      guardApiRequest(post({ origin: "https://evil.mail.example" }))?.status,
    ).toBe(403);
    expect(guardApiRequest(post({ origin: "null" }))?.status).toBe(403);
    expect(
      guardApiRequest(post({ "sec-fetch-site": "cross-site" }))?.status,
    ).toBe(403);
    expect(
      guardApiRequest(post({ "content-type": "text/plain" }))?.status,
    ).toBe(415);
    const noOrigin = post();
    noOrigin.headers.delete("origin");
    expect(guardApiRequest(noOrigin)?.status).toBe(403);
  });
  test("private errors and data cannot be cached and attachment CSP survives", () => {
    expect(json({ body: "private" }).headers.get("cache-control")).toContain(
      "no-store",
    );
    const response = secureResponse(
      new Response("bytes", {
        headers: {
          "content-security-policy": "sandbox; default-src 'none'",
          "cache-control": "public, max-age=999",
        },
      }),
    );
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toBe(
      "sandbox; default-src 'none'",
    );
  });
  test("counts actual streamed body bytes even when content length is missing", async () => {
    await expect(
      readJsonBody(post({}, JSON.stringify({ data: "x".repeat(50) })), 20),
    ).rejects.toBeInstanceOf(ApiInputError);
    await expect(readJsonBody(post({}, "null"))).rejects.toMatchObject({
      status: 400,
    });
    await expect(readJsonBody(post({}, "[]"))).rejects.toMatchObject({
      status: 400,
    });
    expect(await readJsonBody(post({}, '{"ok":true}'))).toEqual({ ok: true });
  });
  test("validates recipients, MIME, attachments and provider identifiers", () => {
    expect(() => validateOutgoing({ accountId: "123", to: 1 }, true)).toThrow(
      ApiInputError,
    );
    expect(() =>
      validateOutgoing(
        { accountId: "123", to: "a@b.test\r\nBcc: x@y.test" },
        true,
      ),
    ).toThrow(ApiInputError);
    expect(() =>
      validateOutgoing({ accountId: "../123", to: "a@b.test" }, true),
    ).toThrow(ApiInputError);
    expect(() =>
      validateOutgoing(
        { accountId: "123", to: "a@b.test", attachments: {} },
        true,
      ),
    ).toThrow(ApiInputError);
    expect(() =>
      validateOutgoing(
        {
          accountId: "123",
          to: "a@b.test",
          attachments: [
            { filename: "x", mimeType: "text/plain", contentBase64: "!" },
          ],
        },
        true,
      ),
    ).toThrow(ApiInputError);
    expect(
      validateOutgoing(
        {
          accountId: "123",
          to: "a@b.test",
          bcc: "b@c.test",
          draftId: "r123",
          attachments: [
            {
              filename: "a.txt",
              mimeType: "text/plain",
              contentBase64: "YQ==",
            },
          ],
        },
        true,
      ),
    ).toMatchObject({ draftId: "r123", bcc: "b@c.test" });
    expect(
      validateOutgoing({
        accountId: "123",
        attachments: [
          {
            filename: "inline.png",
            mimeType: "image/png",
            contentBase64: "",
            contentId: "part.1@sender",
          },
        ],
      }).attachments[0],
    ).toMatchObject({ contentBase64: "", contentId: "part.1@sender" });
    expect(() =>
      validateOutgoing({
        accountId: "123",
        attachments: [
          {
            filename: "inline.png",
            mimeType: "image/png",
            contentBase64: "YQ==",
            contentId: "bad\r\nBcc:evil",
          },
        ],
      }),
    ).toThrow(ApiInputError);
  });
});

describe("trusted remote image policy", () => {
  test("blocks all hosts by default and checks exact host at each hop", () => {
    expect(safeImageTarget("https://cdn.example/a.png", [])).toBeNull();
    expect(
      safeImageTarget("https://cdn.example/a.png", ["cdn.example"])?.hostname,
    ).toBe("cdn.example");
    for (const url of [
      "http://cdn.example/a",
      "https://cdn.example.evil/a",
      "https://a.cdn.example/a",
      "https://u:p@cdn.example/a",
      "https://cdn.example:444/a",
      "https://127.0.0.1/a",
      "https://[::ffff:a9fe:a9fe]/a",
      "https://localhost/a",
      "https://x.local/a",
    ]) {
      expect(
        safeImageTarget(url, [
          "cdn.example",
          "127.0.0.1",
          "localhost",
          "x.local",
        ]),
      ).toBeNull();
    }
  });
});
