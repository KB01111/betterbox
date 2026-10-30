import { executeD1, sqlString } from "./d1";

const email = process.argv.slice(2).find((arg) => !arg.startsWith("--"))?.trim().toLowerCase();
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Usage: bun run set-owner you@example.com [--remote]");
const rows = await executeD1<{ id: string }>(`UPDATE "user" SET "role"='OWNER', "updatedAt"=${Date.now()} WHERE lower("email")=${sqlString(email)} RETURNING "id";`);
if (rows.length !== 1) throw new Error("No unique matching user. Sign in with that allowed account first.");
console.log("Owner role granted to the matching user.");
