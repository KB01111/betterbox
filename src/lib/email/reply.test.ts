import { describe, expect, test } from "bun:test";
import { replyRecipients, replyTarget } from "./reply";

describe("reply identity", () => {
  test("reply targets the last received non-draft message instead of a sent reply or draft", () => {
    const received = { from: "client@example.com", to: "me@example.com" };
    expect(
      replyTarget(
        [
          received,
          {
            from: "me@example.com",
            to: "client@example.com",
            labelIds: ["SENT"],
          },
          {
            from: "client@example.com",
            to: "me@example.com",
            labelIds: ["DRAFT"],
          },
        ],
        "me@example.com",
      ),
    ).toBe(received);
  });
  test("honors Reply-To and removes self and duplicate recipients from reply all", () => {
    expect(
      replyRecipients(
        {
          from: "service@example.com",
          replyTo: '"Support, Team" <support@example.com>',
          to: "me@example.com, person@example.com",
          cc: "PERSON@example.com, copy@example.com",
        },
        "me@example.com",
        true,
      ),
    ).toEqual({
      to: ["support@example.com", "person@example.com"],
      cc: ["copy@example.com"],
    });
  });
  test("replying to an own sent message uses its original To recipients", () => {
    expect(
      replyRecipients(
        {
          from: "Me <me@example.com>",
          to: "client@example.com, other@example.com",
          cc: "copy@example.com",
        },
        "me@example.com",
      ),
    ).toEqual({ to: ["client@example.com", "other@example.com"], cc: [] });
  });
  test("a draft-only thread has no reply target", () => {
    expect(
      replyTarget(
        [{ from: "me@example.com", labelIds: ["DRAFT"] }],
        "me@example.com",
      ),
    ).toBeUndefined();
  });
});
