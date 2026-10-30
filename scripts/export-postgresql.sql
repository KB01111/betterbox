BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT json_build_object(
  'user', COALESCE((SELECT json_agg(t) FROM "user" t), '[]'::json),
  'session', COALESCE((SELECT json_agg(t) FROM "session" t), '[]'::json),
  'account', COALESCE((SELECT json_agg(t) FROM "account" t), '[]'::json),
  'verification', COALESCE((SELECT json_agg(t) FROM "verification" t), '[]'::json),
  'snippet', COALESCE((SELECT json_agg(t) FROM "snippet" t), '[]'::json),
  'signature', COALESCE((SELECT json_agg(t) FROM "signature" t), '[]'::json)
);
COMMIT;
