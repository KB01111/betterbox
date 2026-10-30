import { describe, expect, test } from "bun:test";
import { FOLDER_QUERY, FOLDERS, isFolder, toFolder } from "@/lib/folders";

describe("folders", () => {
  test("unread and starred are live Gmail folder scopes", () => {
    expect(isFolder("unread")).toBe(true);
    expect(isFolder("starred")).toBe(true);
    expect(FOLDER_QUERY["unread" as keyof typeof FOLDER_QUERY]).toBe(
      "is:unread -in:trash -in:spam",
    );
    expect(FOLDER_QUERY["starred" as keyof typeof FOLDER_QUERY]).toBe(
      "is:starred -in:trash -in:spam",
    );
  });
  test("toFolder falls back to inbox for anything invalid", () => {
    expect(toFolder(undefined)).toBe("inbox");
    expect(toFolder("nope")).toBe("inbox");
    expect(toFolder(42)).toBe("inbox");
    expect(toFolder("sent")).toBe("sent");
    expect(toFolder("trash")).toBe("trash");
  });

  test("isFolder is a real type guard", () => {
    expect(isFolder("trash")).toBe(true);
    expect(isFolder("nope")).toBe(false);
    expect(isFolder(5)).toBe(false);
    expect(isFolder(null)).toBe(false);
  });

  test("every folder maps to a non-empty Gmail query", () => {
    for (const folder of FOLDERS) {
      expect(FOLDER_QUERY[folder]).toBeTruthy();
    }
  });
});
