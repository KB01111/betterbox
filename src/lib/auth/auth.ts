import { createAuth } from "./auth-factory";
import { getPrisma, getRuntimeConfig } from "@/lib/runtime.server";

type Auth = ReturnType<typeof createAuth>;
const instances = new WeakMap<ReturnType<typeof getPrisma>, Auth>();
function currentAuth(): Auth {
  const prisma = getPrisma();
  let instance = instances.get(prisma);
  if (!instance) { instance = createAuth(prisma, getRuntimeConfig()); instances.set(prisma, instance); }
  return instance;
}

export const auth = new Proxy({} as Auth, {
  get(_target, key) {
    const instance = currentAuth();
    const value = Reflect.get(instance, key);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});
