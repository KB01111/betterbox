import { mkdir, unlink } from "node:fs/promises";
import { resolve } from "node:path";

export function sqlString(value: string): string { return `'${value.replaceAll("'", "''")}'`; }
export const remote = process.argv.includes("--remote");

/** Capture results in memory: Wrangler must never print credential rows. */
export async function executeD1<T>(sql: string): Promise<T[]> {
  const directory = resolve(".wrangler");
  await mkdir(directory, { recursive: true });
  const file = resolve(directory, `maintenance-${crypto.randomUUID()}.local.sql`);
  try {
    await Bun.write(file, sql);
    const child = Bun.spawn([process.execPath, "node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB", remote ? "--remote" : "--local", "--json", "--file", file], { stdout: "pipe", stderr: "pipe", env: { ...process.env, WRANGLER_SEND_METRICS: "false" } });
    const [output, errors, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (status !== 0) throw new Error(`D1 maintenance command failed (exit ${status}). Check Wrangler authentication and DB binding. ${errors.includes("not authenticated") ? "Wrangler is not authenticated." : ""}`);
    const batches = JSON.parse(output) as { results?: T[]; success?: boolean }[];
    if (batches.some((batch) => batch.success === false)) throw new Error("D1 maintenance query failed");
    return batches.flatMap((batch) => batch.results ?? []);
  } finally { await unlink(file).catch(() => {}); }
}
