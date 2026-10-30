import { AsyncLocalStorage } from "node:async_hooks";
import type { D1Database } from "@cloudflare/workers-types";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaD1 } from "@prisma/adapter-d1";
import { parseRuntimeConfig, type RuntimeConfig } from "./runtime-config";

export type RuntimeBindings = Record<string, unknown> & {
  DB: D1Database;
  API_RATE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
};
type Runtime = { bindings: RuntimeBindings; config?: RuntimeConfig; prisma?: PrismaClient };
const runtime = new AsyncLocalStorage<Runtime>();

function currentRuntime(): Runtime {
  const current = runtime.getStore();
  if (!current) throw new Error("Worker request context is missing");
  return current;
}

export function getRuntimeConfig(): RuntimeConfig {
  const current = currentRuntime();
  current.config ??= parseRuntimeConfig(current.bindings);
  return current.config;
}

export function hasAuthConfiguration(): boolean {
  try { getRuntimeConfig(); return true; } catch { return false; }
}

export function getPrisma(): PrismaClient {
  const current = currentRuntime();
  if (!current.bindings.DB) throw new Error("Cloudflare D1 DB binding is required");
  current.prisma ??= new PrismaClient({ adapter: new PrismaD1(current.bindings.DB) });
  return current.prisma;
}

export async function withRuntime<T>(bindings: RuntimeBindings, run: () => Promise<T>): Promise<T> {
  const scope: Runtime = { bindings };
  return runtime.run(scope, async () => {
    try { return await run(); } finally { await scope.prisma?.$disconnect(); }
  });
}
