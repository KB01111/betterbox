import { executeD1, sqlString } from "./d1";

export async function grantOwner(
  input: string,
  execute: typeof executeD1 = executeD1,
) {
  const email = input.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error("Usage: bun run set-owner you@example.com [--remote]");
  const matches = await execute<{ id: string }>(
    `SELECT "id" FROM "user" WHERE lower("email")=${sqlString(email)};`,
  );
  if (matches.length !== 1)
    throw new Error(
      "No unique matching user. Sign in with that allowed account first.",
    );
  const updated = await execute<{ id: string }>(
    `UPDATE "user" SET "role"='OWNER', "updatedAt"=${Date.now()} WHERE "id"=${sqlString(matches[0].id)} AND lower("email")=${sqlString(email)} AND (SELECT count(*) FROM "user" WHERE lower("email")=${sqlString(email)})=1 RETURNING "id";`,
  );
  if (updated.length !== 1)
    throw new Error(
      "Matching user changed. No owner role was granted; retry after checking the unique identity.",
    );
}

if (import.meta.main) {
  await grantOwner(
    process.argv.slice(2).find((arg) => !arg.startsWith("--")) ?? "",
  );
  console.log("Owner role granted to the matching user.");
}
