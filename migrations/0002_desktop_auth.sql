-- Expiring authentication metadata only; never mailbox content or OAuth tokens.
CREATE TABLE desktop_auth (
  id TEXT PRIMARY KEY NOT NULL,
  challenge TEXT NOT NULL,
  mode TEXT NOT NULL,
  expectedUserId TEXT REFERENCES user(id) ON DELETE CASCADE,
  approvedUserId TEXT REFERENCES user(id) ON DELETE CASCADE,
  approvedSessionId TEXT REFERENCES session(id) ON DELETE CASCADE,
  expiresAt INTEGER NOT NULL
);
CREATE INDEX desktop_auth_expiry ON desktop_auth(expiresAt);
