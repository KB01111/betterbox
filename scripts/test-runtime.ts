import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { createTestHarness } from "wrangler";
import type { D1Database } from "@cloudflare/workers-types";

const origin = "http://localhost:8788";
const secret = "local-runtime-fixture-secret-never-use-in-production";
const gmailAdmission = process.env.BETTERBOX_TEST_GMAIL_ADMISSION === "1";
const ownerEmail = gmailAdmission ? "owner@gmail.com" : "owner@example.test";
const otherEmail = gmailAdmission ? "second@gmail.com" : "second@example.test";
const server = createTestHarness({
  workers: [
    {
      configPath: "dist/server/wrangler.json",
      vars: {
        BETTER_AUTH_URL: origin,
        BETTER_AUTH_SECRET: secret,
        GOOGLE_CLIENT_ID: "runtime-fixture",
        GOOGLE_CLIENT_SECRET: "runtime-fixture",
        ALLOWED_EMAILS: gmailAdmission
          ? "*@gmail.com"
          : `${ownerEmail},${otherEmail}`,
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
    ["owner", ownerEmail],
    ["other", otherEmail],
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
    ["111", "owner", ownerEmail],
    ["222", "owner", ownerEmail],
    ["333", "owner", ownerEmail],
    ["444", "other", otherEmail],
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
  response = await fetchAs("/api/native-mail", undefined, {
    method: "POST", headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ accountId: "111" }),
  });
  assert.equal(response.status, 401);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  response = await post("/api/native-mail", "owner", { accountId: "444" });
  assert.equal(response.status, 403);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  response = await fetchAs("/api/native-mail", "owner", {
    method: "POST", headers: { origin: "https://attacker.test", "content-type": "application/json" },
    body: JSON.stringify({ accountId: "111" }),
  });
  assert.equal(response.status, 403);
  response = await post("/api/native-mail", "owner", { accountId: "111", cursor: "../invalid" });
  assert.equal(response.status, 400);
  response = await post("/api/native-mail", "owner", { accountId: "111", padding: "x".repeat(8192) });
  assert.equal(response.status, 413);
  check("native polling enforces session, account ownership, origin, bounds and no-store");
  response = await fetchAs(
    "/api/image-proxy?url=https%3A%2F%2Fimages.example.test%2Fpixel",
  );
  assert.equal(response.status, 401);
  response = await fetchAs(
    "/api/image-proxy?url=https%3A%2F%2Fwww.example.com%2Fpixel",
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
  check("disallowed user cannot reuse an existing session");
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

  const startDesktop = async (mode = "signin", user = "") => {
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const started = await post("/api/desktop/start", user, { mode, challenge });
    assert.equal(started.status, 200);
    assert.equal(started.headers.get("set-cookie"), null);
    const ticket = (await started.json()) as {
      id: string;
      userCode: string;
      browserUrl: string;
    };
    assert.deepEqual(Object.keys(ticket).sort(), [
      "browserUrl",
      "id",
      "userCode",
    ]);
    assert.match(ticket.id, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(
      ticket.userCode,
      `${ticket.id.slice(0, 4)}-${ticket.id.slice(4, 8)}`.toUpperCase(),
    );
    assert.equal(
      ticket.browserUrl,
      `${origin}/desktop/connect?id=${ticket.id}`,
    );
    return { ...ticket, verifier };
  };
  const desktopStatus = async (id: string, user = "") => {
    const status = await fetchAs(`/api/desktop/status?id=${id}`, user);
    assert.equal(status.status, 200);
    assert.equal(status.headers.get("set-cookie"), null);
    const body = (await status.json()) as {
      mode: string;
      userCode: string;
      signedIn: boolean;
      matchesUser: boolean;
      email: string | null;
    };
    assert.deepEqual(Object.keys(body).sort(), [
      "email",
      "matchesUser",
      "mode",
      "signedIn",
      "userCode",
    ]);
    return body;
  };
  const redeemDesktop = (id: string, verifier: string) =>
    post("/api/desktop/redeem", "", { id, verifier });
  const desktopSessionCount = async () =>
    (await DB.prepare('SELECT COUNT(*) AS count FROM "session"').first<{
      count: number;
    }>())?.count ?? 0;

  const signinTicket = await startDesktop();
  assert.deepEqual(await desktopStatus(signinTicket.id), {
    mode: "signin",
    userCode: signinTicket.userCode,
    signedIn: false,
    matchesUser: false,
    email: null,
  });
  response = await redeemDesktop(signinTicket.id, signinTicket.verifier);
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { pending: true });
  response = await post("/api/desktop/approve", "", { id: signinTicket.id });
  assert.equal(response.status, 401);
  response = await post("/api/desktop/approve", "removed", {
    id: signinTicket.id,
  });
  assert.equal(response.status, 403);
  check(
    "desktop sign-in starts anonymously without credentials and waits for an admitted browser session",
  );

  for (const mode of ["google", "google-settings", "github"]) {
    response = await post("/api/desktop/start", "", {
      mode,
      challenge: createHash("sha256")
        .update(signinTicket.verifier)
        .digest("base64url"),
    });
    assert.equal(response.status, 401);
    const linked = await startDesktop(mode, "owner");
    const ownerStatus = await desktopStatus(linked.id, "owner");
    assert.equal(ownerStatus.mode, mode);
    assert.equal(ownerStatus.matchesUser, true);
    assert.equal((await desktopStatus(linked.id, "other")).matchesUser, false);
    response = await post("/api/desktop/approve", "other", { id: linked.id });
    assert.equal(response.status, 403);
    response = await post("/api/desktop/approve", "owner", { id: linked.id });
    assert.equal(response.status, 200);
    const binding = await DB.prepare(
      "SELECT expectedUserId, approvedUserId FROM desktop_auth WHERE id = ?",
    )
      .bind(linked.id)
      .first<{ expectedUserId: string; approvedUserId: string }>();
    assert.deepEqual(binding, {
      expectedUserId: "owner",
      approvedUserId: "owner",
    });
  }
  check(
    "every desktop linking mode requires a session and preserves the original user binding",
  );

  response = await post("/api/desktop/approve", "owner", {
    id: signinTicket.id,
  });
  assert.equal(response.status, 200);
  const sessionsBeforeRedeem = await desktopSessionCount();
  response = await redeemDesktop(
    signinTicket.id,
    randomBytes(32).toString("base64url"),
  );
  assert.equal(response.status, 403);
  assert.equal(await desktopSessionCount(), sessionsBeforeRedeem);
  assert.ok(
    await DB.prepare("SELECT id FROM desktop_auth WHERE id = ?")
      .bind(signinTicket.id)
      .first(),
  );
  response = await redeemDesktop(signinTicket.id, signinTicket.verifier);
  assert.equal(response.status, 200);
  const redeemed = (await response.json()) as {
    cookie: { name: string; value: string; expires: string };
  };
  assert.deepEqual(Object.keys(redeemed), ["cookie"]);
  assert.deepEqual(Object.keys(redeemed.cookie).sort(), [
    "expires",
    "name",
    "value",
  ]);
  assert.ok(redeemed.cookie.name.endsWith("better-auth.session_token"));
  assert.ok(Date.parse(redeemed.cookie.expires) > Date.now());
  assert.ok(
    redeemed.cookie.value && !redeemed.cookie.value.includes("token-owner"),
    "desktop must receive a new session",
  );
  response = await fetchAs("/api/auth/get-session", "", {
    headers: {
      cookie: `${redeemed.cookie.name}=${encodeURIComponent(redeemed.cookie.value)}`,
    },
  });
  assert.equal(response.status, 200);
  const nativeSession = (await response.json()) as {
    user: { id: string };
    session: { id: string };
  };
  assert.equal(nativeSession.user.id, "owner");
  assert.notEqual(nativeSession.session.id, "s-owner");
  assert.equal(await desktopSessionCount(), sessionsBeforeRedeem + 1);
  response = await redeemDesktop(signinTicket.id, signinTicket.verifier);
  assert.equal(response.status, 410);
  assert.equal(
    (await fetchAs(`/api/desktop/status?id=${signinTicket.id}`)).status,
    410,
  );
  check(
    "wrong verifier cannot consume a ticket; valid redemption creates a separate signed Better Auth session exactly once",
  );

  const missingId = randomBytes(32).toString("base64url");
  assert.equal(
    (await fetchAs(`/api/desktop/status?id=${missingId}`)).status,
    410,
  );
  assert.equal(
    (await post("/api/desktop/approve", "owner", { id: missingId })).status,
    410,
  );
  assert.equal(
    (await redeemDesktop(missingId, signinTicket.verifier)).status,
    410,
  );
  const expired = await startDesktop();
  await DB.prepare("UPDATE desktop_auth SET expiresAt = ? WHERE id = ?")
    .bind(Date.now() - 1, expired.id)
    .run();
  assert.equal(
    (await fetchAs(`/api/desktop/status?id=${expired.id}`)).status,
    410,
  );
  assert.equal(
    (await post("/api/desktop/approve", "owner", { id: expired.id })).status,
    410,
  );
  assert.equal((await redeemDesktop(expired.id, expired.verifier)).status, 410);
  check(
    "missing and expired desktop requests cannot be inspected, approved or redeemed",
  );

  await DB.prepare(
    'INSERT INTO "session" (id,token,expiresAt,createdAt,updatedAt,userId) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(
      "s-desktop-source",
      "token-desktop-source",
      now + 86400000,
      now,
      now,
      "owner",
    )
    .run();
  const revoked = await startDesktop();
  response = await post("/api/desktop/approve", "desktop-source", {
    id: revoked.id,
  });
  assert.equal(response.status, 200);
  const sessionsBeforeRevocation = await desktopSessionCount();
  await DB.prepare('DELETE FROM "session" WHERE id = ?')
    .bind("s-desktop-source")
    .run();
  assert.equal((await redeemDesktop(revoked.id, revoked.verifier)).status, 410);
  assert.equal(await desktopSessionCount(), sessionsBeforeRevocation - 1);
  assert.equal((await fetchAs("/api/auth/get-session", "owner")).status, 200);
  check(
    "revoking the approving browser session invalidates its desktop ticket without minting a session",
  );

  const concurrent = await startDesktop();
  assert.equal(
    (await post("/api/desktop/approve", "other", { id: concurrent.id })).status,
    200,
  );
  const sessionsBeforeConcurrent = await desktopSessionCount();
  const simultaneous = await Promise.all([
    redeemDesktop(concurrent.id, concurrent.verifier),
    redeemDesktop(concurrent.id, concurrent.verifier),
  ]);
  assert.deepEqual(
    simultaneous.map((result) => result.status).sort(),
    [200, 410],
  );
  assert.equal(await desktopSessionCount(), sessionsBeforeConcurrent + 1);
  check("concurrent desktop redemptions atomically create only one session");

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
