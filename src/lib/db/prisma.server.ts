import type { PrismaClient } from "@/generated/prisma/client";
import { getPrisma } from "@/lib/runtime.server";

// Preserve existing callers while keeping D1 clients inside one request.
const prisma = new Proxy({} as PrismaClient, {
  get(_target, key) {
    const client = getPrisma();
    const value = Reflect.get(client, key);
    return typeof value === "function" ? value.bind(client) : value;
  },
});

export { prisma };
export default prisma;
