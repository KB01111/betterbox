import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { auth } from "./auth/auth";
import { getPrisma, getRuntimeBindings, getRuntimeConfig } from "./runtime.server";
import { isAllowedEmail } from "./runtime-config";
import { ApiInputError, readJsonBody } from "./request-security";
import { json } from "./json-response";
import { DESKTOP_AUTH_TTL, DESKTOP_MODES, desktopChallenge, desktopUserCode, validDesktopSecret } from "./desktop-auth";

type Ticket = { id: string; challenge: string; mode: string; expectedUserId: string | null; approvedUserId: string | null; approvedSessionId: string | null; expiresAt: number };
function fail(status: number, message: string): never { throw new ApiInputError(status, message); }

export async function handleDesktopAuth(request: Request): Promise<Response> {
  const db = getRuntimeBindings().DB;
  const url = new URL(request.url);
  const action = url.pathname.slice("/api/desktop/".length);
  const body = request.method === "POST" ? await readJsonBody(request, 4096) : {};
  if (action === "start" && request.method === "POST") {
    if (!validDesktopSecret(body.challenge) || !DESKTOP_MODES.includes(body.mode as typeof DESKTOP_MODES[number])) fail(400, "Invalid desktop request.");
    const mode = String(body.mode);
    const session = await auth.api.getSession({ headers: request.headers });
    if (mode !== "signin" && !session) fail(401, "Sign in to KB OneMail first.");
    const id = randomBytes(32).toString("base64url");
    await db.prepare("DELETE FROM desktop_auth WHERE expiresAt <= ?").bind(Date.now()).run();
    await db.prepare("INSERT INTO desktop_auth (id,challenge,mode,expectedUserId,expiresAt) VALUES (?,?,?,?,?)")
      .bind(id, body.challenge, mode, mode === "signin" ? null : session?.user.id ?? null, Date.now() + DESKTOP_AUTH_TTL).run();
    return json({ id, userCode: desktopUserCode(id), browserUrl: `${getRuntimeConfig().baseURL}/desktop/connect?id=${id}` });
  }
  const id = request.method === "GET" ? url.searchParams.get("id") : body.id;
  if (!validDesktopSecret(id)) fail(400, "Invalid desktop request.");
  const ticket = await db.prepare("SELECT * FROM desktop_auth WHERE id = ? AND expiresAt > ?").bind(id, Date.now()).first<Ticket>();
  if (!ticket) fail(410, "This desktop sign-in expired or was already used. Start again in KB OneMail.");
  if (action === "status" && request.method === "GET") {
    const session = await auth.api.getSession({ headers: request.headers });
    return json({ mode: ticket.mode, userCode: desktopUserCode(ticket.id), signedIn: !!session,
      matchesUser: !!session && (!ticket.expectedUserId || ticket.expectedUserId === session.user.id),
      email: session?.user.email ?? null });
  }
  if (action === "approve" && request.method === "POST") {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user.emailVerified || !isAllowedEmail(getRuntimeConfig(), session.user.email)) fail(401, "Sign in with an approved Google account first.");
    if (ticket.expectedUserId && ticket.expectedUserId !== session.user.id) fail(403, "Use the same KB OneMail user as the desktop app to link accounts.");
    const result = await db.prepare("UPDATE desktop_auth SET approvedUserId = ?, approvedSessionId = ? WHERE id = ? AND expiresAt > ? AND approvedUserId IS NULL")
      .bind(session.user.id, session.session.id, id, Date.now()).run();
    if (result.meta.changes !== 1) fail(410, "This request is already approved or expired.");
    return json({ approved: true });
  }
  if (action === "redeem" && request.method === "POST") {
    if (!validDesktopSecret(body.verifier)) fail(400, "Invalid desktop verifier.");
    const challenge = desktopChallenge(body.verifier);
    if (!timingSafeEqual(Buffer.from(challenge), Buffer.from(ticket.challenge))) fail(403, "Invalid desktop verifier.");
    if (!ticket.approvedUserId || !ticket.approvedSessionId) return json({ pending: true }, 202);
    const source = await getPrisma().session.findUnique({ where: { id: ticket.approvedSessionId }, include: { user: true } });
    if (!source || source.expiresAt.getTime() <= Date.now() || source.userId !== ticket.approvedUserId || !source.user.emailVerified || !isAllowedEmail(getRuntimeConfig(), source.user.email)) fail(403, "The approving session is no longer available.");
    // DELETE RETURNING is the single-use claim: concurrent redemptions cannot both mint sessions.
    const claimed = await db.prepare("DELETE FROM desktop_auth WHERE id = ? AND challenge = ? AND expiresAt > ? RETURNING id").bind(id, challenge, Date.now()).first();
    if (!claimed) fail(410, "This desktop request was already used.");
    const context = await auth.$context;
    const session = await context.internalAdapter.createSession(source.userId);
    if (!session) fail(403, "Could not create the desktop session.");
    const signed = `${session.token}.${createHmac("sha256", context.secret).update(session.token).digest("base64")}`;
    return json({ cookie: { name: context.authCookies.sessionToken.name, value: signed, expires: session.expiresAt.toISOString() } });
  }
  return json({ error: "Not found" }, 404);
}
