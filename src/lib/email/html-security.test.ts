import { expect, test } from "bun:test";
import {
  emailImageSource,
  emailDocument,
  emailCss,
  emailInlineSource,
} from "./html-security";

test("CSS imports are stripped and background images follow consent", () => {
  const css =
    '@import url("https://tracker.example/font.css"); p{background:url(https://tracker.example/pixel)}';
  expect(emailCss(css, "https://mail.example", false)).toBe(
    " p{background:url()}",
  );
  expect(emailCss(css, "https://mail.example", true)).toContain(
    'url("https://mail.example/api/image-proxy?url=https%3A%2F%2Ftracker.example%2Fpixel")',
  );
});

test("embedded inline raster bytes render without an empty attachment request", () => {
  expect(
    emailInlineSource(
      { attachmentId: "", mimeType: "image/png", data: "YQ" },
      "https://mail.example",
      "account",
      "message",
    ),
  ).toBe("data:image/png;base64,YQ==");
  expect(
    emailInlineSource(
      { attachmentId: "", mimeType: "image/svg+xml", data: "YQ" },
      "https://mail.example",
      "account",
      "message",
    ),
  ).toBeNull();
  expect(
    emailInlineSource(
      { attachmentId: "part", mimeType: "image/png" },
      "https://mail.example",
      "account",
      "message",
    ),
  ).toContain("attachment=part");
});

test("email images require explicit consent; CID stays private and inline SVG is removed", () => {
  expect(
    emailImageSource(
      "https://tracker.example/pixel",
      "https://mail.example",
      false,
    ),
  ).toBeNull();
  expect(emailImageSource("cid:part1", "https://mail.example", false)).toBe(
    "cid:part1",
  );
  expect(
    emailImageSource("data:image/svg+xml,<svg/>", "https://mail.example", true),
  ).toBeNull();
  expect(
    emailImageSource(
      "https://tracker.example/pixel",
      "https://mail.example",
      true,
    ),
  ).toBe(
    "https://mail.example/api/image-proxy?url=https%3A%2F%2Ftracker.example%2Fpixel",
  );
  expect(
    emailImageSource(
      String.raw`https:\\tracker.example/pixel`,
      "https://mail.example",
      true,
    ),
  ).toContain("/api/image-proxy?");
  expect(
    emailImageSource("javascript:alert(1)", "https://mail.example", true),
  ).toBeNull();
});

test("email document puts resource CSP before attacker CSS and disallows external sources", () => {
  const document = emailDocument(
    "<html><head><style>p{background:u\\72l(h\\74tps://tracker.example)}</style></head><body>mail</body></html>",
  );
  expect(document.indexOf("Content-Security-Policy")).toBeLessThan(
    document.indexOf("<style>"),
  );
  expect(document).toContain("default-src 'none'");
  expect(document).toContain("img-src  data: blob:");
  expect(document).toContain("script-src 'none'");
  expect(document).toContain("form-action 'none'");
});

test("escaped same-origin CSS cannot bypass image consent via the image proxy", () => {
  const blocked = emailDocument(
    "<html><head></head><body></body></html>",
    "https://mail.example",
    false,
  );
  expect(blocked).toContain(
    "img-src https://mail.example/api/message data: blob:",
  );
  expect(blocked).not.toContain("img-src 'self'");
  const allowed = emailDocument(
    "<html><head></head><body></body></html>",
    "https://mail.example",
    true,
  );
  expect(allowed).toContain("img-src 'self' data: blob:");
});
