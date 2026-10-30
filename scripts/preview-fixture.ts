/** Local QA only. This entry is never imported by the deployed Worker. */
import { createServer } from "node:http";
import { createHmac } from "node:crypto";
import { createTestHarness } from "wrangler";
import type { D1Database } from "@cloudflare/workers-types";

const port = 8789;
const origin = `http://127.0.0.1:${port}`;
const secret = "local-browser-fixture-no-real-google-permissions";
const harness = createTestHarness({
  workers: [
    {
      configPath: "dist/server/wrangler.json",
      vars: {
        BETTER_AUTH_URL: origin,
        BETTER_AUTH_SECRET: secret,
        GOOGLE_CLIENT_ID: "fixture",
        GOOGLE_CLIENT_SECRET: "fixture",
        ALLOWED_EMAILS: "owner@example.test",
        IS_SELF_HOSTED: "true",
      },
    },
  ],
});
await harness.listen();
const worker = harness.getWorker<{ DB: D1Database }>();
await worker.applyD1Migrations("DB");
const { DB } = await worker.getEnv();
const now = Date.now();
await DB.prepare(
  "INSERT INTO \"user\" (id,name,email,emailVerified,role,createdAt,updatedAt) VALUES ('fixture-owner','Fixture owner','owner@example.test',1,'OWNER',?,?)",
)
  .bind(now, now)
  .run();
await DB.prepare(
  "INSERT INTO \"session\" (id,token,expiresAt,createdAt,updatedAt,userId) VALUES ('fixture-session','fixture-session-token',?,?,?,'fixture-owner')",
)
  .bind(now + 86400000, now, now)
  .run();
const token = "fixture-session-token";
const cookie = `better-auth.session_token=${encodeURIComponent(`${token}.${createHmac("sha256", secret).update(token).digest("base64")}`)}; HttpOnly; SameSite=Lax; Path=/`;
const server = createServer(async (request, response) => {
  if (request.url === "/__fixture") {
    response.writeHead(200, {
      "set-cookie": cookie,
      "content-type": "text/html",
      "cache-control": "no-store",
    });
    response.end(
      '<!doctype html><title>Local fixture</title><script>localStorage.setItem("bm.settings",JSON.stringify({demoMode:true,devTools:true,mailView:"unified"}));location.replace("/")</script>',
    );
    return;
  }
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers))
      if (value)
        headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    const result = await harness.fetch(`${origin}${request.url ?? "/"}`, {
      method: request.method,
      headers: Object.fromEntries(headers),
      body: chunks.length ? Buffer.concat(chunks) : undefined,
      redirect: "manual",
    });
    response.writeHead(result.status, Object.fromEntries(result.headers));
    response.end(Buffer.from(await result.arrayBuffer()));
  } catch {
    response.writeHead(502);
    response.end("Local fixture failed");
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(`Synthetic local QA only: ${origin}/__fixture`),
);
async function close() {
  server.close();
  await harness.close();
  process.exit(0);
}
process.on("SIGINT", () => void close());
process.on("SIGTERM", () => void close());
