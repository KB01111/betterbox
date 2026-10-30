import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createTestHarness } from "wrangler";
import type { D1Database } from "@cloudflare/workers-types";

const origin = "http://localhost:8788";
const secret = "local-runtime-fixture-secret-never-use-in-production";
const server = createTestHarness({
  workers: [
    {
      configPath: "dist/server/wrangler.json",
      vars: {
        BETTER_AUTH_URL: origin,
        BETTER_AUTH_SECRET: secret,
        GOOGLE_CLIENT_ID: "runtime-fixture",
        GOOGLE_CLIENT_SECRET: "runtime-fixture",
        ALLOWED_EMAILS: "owner@example.test,second@example.test",
        IS_SELF_HOSTED: "true",
      },
    },
  ],
});
let passed = 0;
const check = (name: string) => {
  passed++;
  console.log(`PASS ${name}`);
};

try {
  await server.listen();
  const worker = server.getWorker<{ DB: D1Database }>();
  await worker.applyD1Migrations("DB");
  const { DB } = await worker.getEnv();
  const now = Date.now();
  for (const [id, email] of [
    ["owner", "owner@example.test"],
    ["other", "second@example.test"],
    ["removed", "removed@example.test"],
  ]) {
    await DB.prepare(
      'INSERT INTO "user" (id,name,email,emailVerified,createdAt,updatedAt) VALUES (?, ?, ?, 1, ?, ?)',
    )
      .bind(id, id, email, now, now)
      .run();
    await DB.prepare(
      'INSERT INTO "session" (id,token,expiresAt,createdAt,updatedAt,userId) VALUES (?, ?, ?, ?, ?, ?)',
    )
      .bind(`s-${id}`, `token-${id}`, now + 86400000, now, now, id)
      .run();
  }
  for (const [id, user, email] of [
    ["111", "owner", "owner@example.test"],
    ["222", "owner", "owner@example.test"],
    ["333", "owner", "owner@example.test"],
    ["444", "other", "second@example.test"],
  ]) {
    await DB.prepare(
      "INSERT INTO \"account\" (id,accountId,providerId,userId,email,createdAt,updatedAt) VALUES (?, ?, 'google', ?, ?, ?, ?)",
    )
      .bind(`a-${id}`, id, user, email, now, now)
      .run();
  }
  const cookie = (user: string) => {
    const value = `token-${user}`;
    return `better-auth.session_token=${encodeURIComponent(`${value}.${createHmac("sha256", secret).update(value).digest("base64")}`)}`;
  };
  const fetchAs = (
    path: string,
    user?: string,
    init: Pick<RequestInit, "method" | "redirect"> & {
      headers?: Record<string, string>;
      body?: string;
    } = {},
  ) =>
    worker.fetch(`${origin}${path}`, {
      ...init,
      headers: { ...(user ? { cookie: cookie(user) } : {}), ...init.headers },
    });
  const post = (path: string, user: string, body: unknown) =>
    fetchAs(path, user, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  let response = await fetchAs("/api/accounts");
  assert.equal(response.status, 401);
  check("anonymous mailbox access blocked in workerd");
  response = await fetchAs(
    "/api/image-proxy?url=https%3A%2F%2Fimages.example.test%2Fpixel",
  );
  assert.equal(response.status, 401);
  response = await fetchAs(
    "/api/image-proxy?url=https%3A%2F%2Fimages.example.test%2Fpixel",
    "owner",
  );
  assert.equal(response.status, 400);
  check("image proxy requires a session and retains the trusted-host gate");
  response = await fetchAs("/api/auth/get-session", "owner");
  assert.equal(response.status, 200);
  assert.equal(
    ((await response.json()) as { user: { id: string } }).user.id,
    "owner",
  );
  check("Better Auth session reads from D1 through Prisma");
  response = await fetchAs("/api/accounts", "owner");
  assert.equal(response.status, 200);
  const accounts = (await response.json()) as {
    accounts: { accountId: string }[];
  };
  assert.deepEqual(
    accounts.accounts.map((account) => account.accountId).sort(),
    ["111", "222", "333"],
  );
  check("three linked Gmail identities remain user scoped");
  response = await fetchAs("/api/emails?accountId=444", "owner");
  assert.equal(response.status, 403);
  check("another user's Google account is rejected before token access");
  response = await fetchAs("/api/auth/get-session", "removed");
  assert.equal(response.status, 403);
  check("removed allowlist user cannot reuse an existing session");
  response = await fetchAs("/api/auth/get-access-token", "owner", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: '{"providerId":"google"}',
  });
  assert.equal(response.status, 404);
  check("OAuth token HTTP endpoint disabled");
  response = await fetchAs("/api/send", "owner", {
    method: "POST",
    headers: {
      origin: "https://attacker.example",
      "content-type": "text/plain",
    },
    body: "{}",
  });
  assert.equal(response.status, 403);
  check("cross-origin mail mutation blocked");
  response = await fetchAs("/api/send", "owner", {
    method: "POST",
    headers: { origin, "content-type": "text/plain" },
    body: "{}",
  });
  assert.equal(response.status, 415);
  check("simple-content-type CSRF blocked");
  response = await post("/api/snippets", "owner", {
    op: "create",
    trigger: "/runtime",
    text: "fixture text",
  });
  assert.equal(response.status, 200);
  check("D1 user-scoped snippet write");
  response = await fetchAs("/api/snippets", "other");
  assert.equal(response.status, 200);
  assert.deepEqual(
    ((await response.json()) as { snippets: unknown[] }).snippets,
    [],
  );
  check("snippet content isolated across users");
  response = await post("/api/auth/sign-in/social", "", {
    provider: "google",
    callbackURL: origin,
    errorCallbackURL: `${origin}/sign-in`,
  });
  assert.equal(response.status, 200);
  const authorization = new URL(
    ((await response.json()) as { url: string }).url,
  );
  assert.equal(authorization.hostname, "accounts.google.com");
  assert.equal(
    authorization.searchParams.get("redirect_uri"),
    `${origin}/api/auth/callback/google`,
  );
  assert.equal(authorization.searchParams.get("access_type"), "offline");
  assert.match(
    authorization.searchParams.get("prompt") ?? "",
    /select_account/,
  );
  assert.match(authorization.searchParams.get("scope") ?? "", /gmail.modify/);
  assert.doesNotMatch(
    authorization.searchParams.get("scope") ?? "",
    /settings.basic/,
  );
  assert.ok(authorization.searchParams.get("state"));
  assert.ok(authorization.searchParams.get("code_challenge"));
  check(
    "OAuth initiates account chooser, offline grant, state/PKCE and canonical callback",
  );
  response = await post("/api/auth/link-social", "owner", {
    provider: "google",
    callbackURL: origin,
  });
  assert.equal(response.status, 200);
  check(
    "authenticated account linking initiates without creating another user",
  );
  response = await fetchAs(
    "/api/auth/callback/google?error=access_denied&state=invalid",
    undefined,
    { headers: { "sec-fetch-site": "cross-site" }, redirect: "manual" },
  );
  assert.ok(response.status >= 300 && response.status < 400);
  check(
    "cross-site OAuth denial callback handled by Better Auth state protection",
  );
  response = await fetchAs("/sign-in");
  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-security-policy") ?? "",
    /object-src 'none'/,
  );
  const html = await response.text();
  const script = html.match(/(?:src|href)="([^"]+\.js)"/);
  assert.ok(script);
  assert.equal((await server.fetch(`${origin}${script[1]}`)).status, 200);
  check("sign-in document, CSP and static assets served by Worker");
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  console.log(
    `${passed} local Workers/D1 checks passed. No live Google OAuth or mail delivery was performed.`,
  );
} catch (error) {
  server.debug();
  throw error;
} finally {
  await server.close();
}
