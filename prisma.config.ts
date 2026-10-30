import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "migrations",
  },
  datasource: {
    // Only schema generation/diff uses this URL. Wrangler owns all D1 writes.
    url: "file:./local.db",
  },
});
