import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { sqlString } from "./d1";

const columns = {
  user: [
    "id",
    "name",
    "email",
    "emailVerified",
    "image",
    "role",
    "createdAt",
    "updatedAt",
  ],
  signature: ["id", "userId", "name", "body", "createdAt", "updatedAt"],
  account: [
    "id",
    "accountId",
    "email",
    "providerId",
    "userId",
    "accessToken",
    "refreshToken",
    "idToken",
    "accessTokenExpiresAt",
    "refreshTokenExpiresAt",
    "scope",
    "password",
    "signatureId",
    "createdAt",
    "updatedAt",
  ],
  session: [
    "id",
    "expiresAt",
    "token",
    "createdAt",
    "updatedAt",
    "ipAddress",
    "userAgent",
    "userId",
  ],
  verification: [
    "id",
    "identifier",
    "value",
    "expiresAt",
    "createdAt",
    "updatedAt",
  ],
  snippet: ["id", "userId", "trigger", "text", "createdAt", "updatedAt"],
} as const;

export async function convertPostgresExport(
  input: unknown,
  secret: string,
): Promise<string> {
  if (secret.length < 32)
    throw new Error(
      "Use the existing BETTER_AUTH_SECRET (at least 32 characters)",
    );
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Expected a table export object");
  const data = input as Record<string, unknown>;
  const statements: string[] = [];
  const subjects = new Set<string>();
  for (const [table, fields] of Object.entries(columns)) {
    const rows = data[table];
    if (!Array.isArray(rows)) throw new Error(`Missing ${table} table export`);
    for (const raw of rows) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw))
        throw new Error(`Invalid ${table} row`);
      const row = { ...raw } as Record<string, unknown>;
      if (
        Object.keys(row).some(
          (key) => !(fields as readonly string[]).includes(key),
        )
      )
        throw new Error(
          `Unsupported ${table} column; review the source schema before transfer`,
        );
      if (typeof row.id !== "string" || !row.id)
        throw new Error(`Missing ${table} id`);
      if (table === "user" && !["USER", "OWNER"].includes(String(row.role)))
        throw new Error("Invalid user role");
      if (table === "account") {
        const identity = JSON.stringify([row.providerId, row.accountId]);
        if (subjects.has(identity))
          throw new Error(
            "Duplicate provider account identity; reconcile source ownership before transfer",
          );
        subjects.add(identity);
        row.idToken = null;
        for (const field of ["accessToken", "refreshToken"]) {
          const value = row[field];
          if (!value) continue;
          if (typeof value !== "string")
            throw new Error("Invalid credential field");
          try {
            await symmetricDecrypt({ key: secret, data: value });
          } catch {
            if (/^[\da-f]{64,}$/i.test(value))
              throw new Error(
                "Undecryptable ciphertext; verify the existing secret",
              );
            row[field] = await symmetricEncrypt({ key: secret, data: value });
          }
        }
      }
      const values = fields.map((field) => {
        const value = row[field];
        if (value === null || value === undefined) return "NULL";
        if (field.endsWith("At")) {
          const text = String(value);
          // Prisma's PostgreSQL timestamp-without-time-zone values represent UTC.
          const timestamp =
            typeof value === "number"
              ? value
              : Date.parse(
                  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(
                    text,
                  )
                    ? `${text.replace(" ", "T")}Z`
                    : text,
                );
          if (!Number.isFinite(timestamp))
            throw new Error(`Invalid ${table} date`);
          return String(timestamp);
        }
        if (typeof value === "boolean") return value ? "1" : "0";
        if (typeof value !== "string")
          throw new Error(`Invalid ${table} column type`);
        return sqlString(value);
      });
      statements.push(
        `INSERT INTO "${table}" (${fields.map((field) => `"${field}"`).join(",")}) VALUES (${values.join(",")});`,
      );
    }
  }
  return `-- Private application-state transfer. Import only into a new empty D1 database.\n${statements.join("\n")}\n`;
}

if (import.meta.main) {
  const [source, destination] = process.argv.slice(2);
  if (!source || !destination?.endsWith(".local.sql"))
    throw new Error(
      "Usage: bun scripts/convert-postgresql.ts INPUT.local.json OUTPUT.local.sql",
    );
  if (await Bun.file(destination).exists())
    throw new Error("Destination already exists; refusing to overwrite it");
  const sql = await convertPostgresExport(
    await Bun.file(source).json(),
    process.env.BETTER_AUTH_SECRET ?? "",
  );
  await Bun.write(destination, sql);
  console.log(
    "Validated credential/application-state transfer written. Source unchanged. Protect both transfer files.",
  );
}
