import { describe, expect, test } from "bun:test";
import {
  createRequestLimiter,
  mergeMailPages,
  type MailPageSource,
} from "./unified-mail";

const row = (id: string, internalDate: number) => ({ id, internalDate });
const source = (
  accountId: string,
  values: [string, number][],
  nextPageToken?: string,
): MailPageSource => ({
  accountId,
  pages: [{ emails: values.map(([id, date]) => row(id, date)), nextPageToken }],
});

describe("unified mail frontier", () => {
  test("three differently paced accounts paginate without losing older mail or colliding IDs", () => {
    const a = source(
      "a",
      [
        ["same", 100],
        ["a2", 90],
      ],
      "a-next",
    );
    const b = source(
      "b",
      [
        ["same", 95],
        ["b2", 50],
      ],
      "b-next",
    );
    const c = source(
      "c",
      [
        ["same", 110],
        ["c2", 80],
      ],
      "c-next",
    );
    expect(
      mergeMailPages([a, b, c]).rows.map((row) => `${row.accountId}/${row.id}`),
    ).toEqual(["c/same", "a/same", "b/same"]);
    a.pages.push({ emails: [row("a3", 70)] });
    c.pages.push({ emails: [row("c3", 60)] });
    b.pages.push({ emails: [row("b3", 40)] });
    const all = mergeMailPages([a, b, c]).rows;
    expect(all.map((row) => row.internalDate)).toEqual([
      110, 100, 95, 90, 80, 70, 60, 50, 40,
    ]);
    expect(new Set(all.map((row) => `${row.accountId}/${row.id}`)).size).toBe(
      9,
    );
    expect(
      mergeMailPages([a, c]).rows.every((row) => row.accountId !== "b"),
    ).toBe(true);
  });
  test("holds older rows until every account has reached them", () => {
    const result = mergeMailPages([
      source(
        "a",
        [
          ["a1", 100],
          ["a2", 90],
        ],
        "a-next",
      ),
      source(
        "b",
        [
          ["b1", 95],
          ["b2", 50],
        ],
        "b-next",
      ),
    ]);
    expect(result.rows.map((r) => r.id)).toEqual(["a1", "b1"]);
    expect(result.advanceAccountIds).toEqual(["a"]);
  });
  test("holds timestamp ties until all equally dated pages are known", () => {
    const a = source("a", [["same", 100]], "next");
    const b = source("b", [["same", 100]]);
    expect(mergeMailPages([a, b]).rows).toEqual([]);
    a.pages.push({ emails: [row("older", 90)] });
    expect(
      mergeMailPages([a, b]).rows.map((r) => `${r.accountId}/${r.id}`),
    ).toEqual(["a/same", "b/same", "a/older"]);
  });
  test("deduplicates overlapping pages within an account while preserving account identity", () => {
    const a = source("a", [["same", 10]], "next");
    a.pages.push({ emails: [row("same", 10)] });
    expect(mergeMailPages([a, source("b", [["same", 10]])]).rows).toHaveLength(
      2,
    );
  });
  test("waits for an unknown account but retains useful partial results after failure", () => {
    const a = source("a", [["a", 10]]);
    expect(mergeMailPages([a, { accountId: "b", pages: [] }]).rows).toEqual([]);
    expect(
      mergeMailPages([a, { accountId: "b", pages: [], failed: true }]).rows.map(
        (r) => r.id,
      ),
    ).toEqual(["a"]);
  });
  test("empty pages with a cursor advance instead of claiming exhaustion", () => {
    expect(mergeMailPages([source("a", [], "next")]).advanceAccountIds).toEqual(
      ["a"],
    );
  });
});

describe("mail request limiter", () => {
  test("bounds concurrency and does not execute cancelled queued work", async () => {
    const limit = createRequestLimiter(3);
    let active = 0;
    let maximum = 0;
    let cancelledRan = false;
    const releases: (() => void)[] = [];
    const first = Array.from({ length: 3 }, () =>
      limit(async () => {
        active++;
        maximum = Math.max(maximum, active);
        await new Promise<void>((resolve) => releases.push(resolve));
        active--;
      }),
    );
    const controller = new AbortController();
    const cancelled = limit(async () => {
      cancelledRan = true;
    }, controller.signal);
    controller.abort();
    await expect(cancelled).rejects.toThrow();
    releases.forEach((release) => {
      release();
    });
    await Promise.all(first);
    expect(maximum).toBe(3);
    expect(cancelledRan).toBe(false);
    expect(await limit(async () => 42)).toBe(42);
  });
});
