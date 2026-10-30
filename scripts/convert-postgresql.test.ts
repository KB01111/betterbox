import { expect, test } from "bun:test";
import { convertPostgresExport } from "./convert-postgresql";
const secret = "migration-test-secret-never-production-at-least-32";
const dates = {
  createdAt: "2026-01-02T03:04:05.000Z",
  updatedAt: "2026-01-02T03:04:05.000Z",
};
const fixture = () => ({
  user: [
    {
      id: "u'1",
      name: "Owner",
      email: "owner@example.test",
      emailVerified: true,
      role: "OWNER",
      ...dates,
    },
  ],
  signature: [
    {
      id: "sig",
      userId: "u'1",
      name: "Work",
      body: "signature text",
      ...dates,
    },
  ],
  account: [
    {
      id: "a",
      accountId: "123",
      providerId: "google",
      userId: "u'1",
      signatureId: "sig",
      accessToken: "ya29.plaintext-fixture",
      idToken: "id-token",
      ...dates,
    },
  ],
  session: [],
  verification: [],
  snippet: [],
});
test("transfer preserves identities, roles, dates, relations and encrypts credentials", async () => {
  const sql = await convertPostgresExport(fixture(), secret);
  expect(sql).toContain("'u''1'");
  expect(sql).toContain("'OWNER'");
  expect(sql).toContain(String(Date.parse(dates.createdAt)));
  expect(sql).toContain("signature text");
  expect(sql.indexOf('INSERT INTO "signature"')).toBeLessThan(
    sql.indexOf('INSERT INTO "account"'),
  );
  expect(sql).not.toContain("ya29.plaintext-fixture");
  expect(sql).not.toContain("id-token");
  expect(sql).not.toMatch(/DROP|DELETE|REPLACE/);
});
test("duplicate provider subjects abort conversion before import", async () => {
  const data = fixture();
  data.account.push({ ...data.account[0], id: "another" });
  await expect(convertPostgresExport(data, secret)).rejects.toThrow(
    "Duplicate",
  );
});
test("undecryptable ciphertext is not overwritten or double encrypted", async () => {
  const data = fixture();
  data.account[0].accessToken = "a".repeat(120);
  await expect(convertPostgresExport(data, secret)).rejects.toThrow(
    "ciphertext",
  );
});

test("timezone-less PostgreSQL dates transfer as UTC on a non-UTC host", async () => {
  const input = {
    user: [
      {
        id: "u",
        name: "User",
        email: "owner@example.test",
        role: "USER",
        createdAt: "2026-01-02T03:04:05.123",
        updatedAt: "2026-01-02T03:04:05.123Z",
      },
    ],
    signature: [],
    account: [],
    session: [
      {
        id: "s",
        userId: "u",
        token: "fixture",
        expiresAt: "2026-01-03T03:04:05.123",
      },
    ],
    verification: [],
    snippet: [],
  };
  const child = Bun.spawn(
    [
      process.execPath,
      "-e",
      'import { convertPostgresExport } from "./scripts/convert-postgresql.ts"; console.log(await convertPostgresExport(JSON.parse(process.argv[1]), process.argv[2]));',
      JSON.stringify(input),
      secret,
    ],
    {
      env: { ...process.env, TZ: "America/Los_Angeles" },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const output = await new Response(child.stdout).text();
  expect(await child.exited).toBe(0);
  expect(
    output.split(String(Date.parse("2026-01-02T03:04:05.123Z"))),
  ).toHaveLength(3);
  expect(output).toContain(String(Date.parse("2026-01-03T03:04:05.123Z")));
});
