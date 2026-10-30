import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { executeD1, sqlString } from "./d1";

const secret = process.env.BETTER_AUTH_SECRET ?? "";
if (secret.length < 32) throw new Error("Set BETTER_AUTH_SECRET to the existing deployment secret (at least 32 characters).");
type Row = { id: string; accessToken: string | null; refreshToken: string | null };
const accounts = await executeD1<Row>('SELECT "id", "accessToken", "refreshToken" FROM "account";');
let updated = 0;
for (const row of accounts) {
  const updates: string[] = ['"idToken"=NULL'];
  for (const field of ["accessToken", "refreshToken"] as const) {
    const value = row[field];
    if (!value) continue;
    try { await symmetricDecrypt({ key: secret, data: value }); continue; } catch {
      if (/^[\da-f]{64,}$/i.test(value)) throw new Error("Undecryptable ciphertext found. Verify the existing secret before continuing; no double encryption was performed.");
    }
    updates.push(`"${field}"=${sqlString(await symmetricEncrypt({ key: secret, data: value }))}`);
  }
  await executeD1(`UPDATE "account" SET ${updates.join(",")} WHERE "id"=${sqlString(row.id)};`);
  updated++;
}
console.log(`Processed ${updated} credential rows; ID tokens removed. No credential values were logged.`);
