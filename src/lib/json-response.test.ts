import { expect, test } from "bun:test";
import { GmailApiError } from "./gmail/api.server";
import { jsonError } from "./json-response";
import { ApiInputError } from "./request-security";

test("ownership failures keep their forbidden status through route error handling", async () => {
  const result = jsonError(
    "mail action",
    new ApiInputError(403, "This mailbox is not available to this session."),
  );
  expect(result.status).toBe(403);
  expect(await result.json()).toMatchObject({
    error: "This mailbox is not available to this session.",
  });
});

test("Gmail auth and rate-limit errors stay actionable without upstream text", async () => {
  const reconnect = jsonError("mail read", new GmailApiError(401));
  expect(reconnect.status).toBe(403);
  expect(await reconnect.json()).toMatchObject({ code: "reconnect_required" });
  const limited = jsonError("mail read", new GmailApiError(429));
  expect(limited.status).toBe(429);
  expect(limited.headers.get("retry-after")).toBe("30");
  expect(await limited.json()).toMatchObject({ code: "rate_limited" });
  const failed = jsonError("mail read", new Error("private message/token"));
  expect(await failed.text()).not.toContain("private");
});
