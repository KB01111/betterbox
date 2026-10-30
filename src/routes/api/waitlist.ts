import { createFileRoute } from "@tanstack/react-router";
import { json } from "@/lib/json-response";

// This private fork does not collect marketing addresses or need a second DB.
export const Route = createFileRoute("/api/waitlist")({
  server: { handlers: { POST: () => json({ error: "This private instance does not accept waitlist signups." }, 410) } },
});
