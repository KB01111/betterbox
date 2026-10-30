import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export const Route = createFileRoute("/desktop/connect")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>) => ({
    id: typeof search.id === "string" ? search.id : "",
    connected: search.connected === "1",
    error: typeof search.error === "string" ? search.error : undefined,
  }),
  component: DesktopConnect,
});

type Status = { mode: string; userCode: string; signedIn: boolean; matchesUser: boolean; email: string | null };

function DesktopConnect() {
  const { id, connected, error: callbackError } = Route.useSearch();
  const [status, setStatus] = useState<Status>();
  const [error, setError] = useState(callbackError ? "Google connection did not complete. Try again from the desktop app." : "");
  const [busy, setBusy] = useState(false);
  const [approved, setApproved] = useState(false);
  const [matchesCode, setMatchesCode] = useState(false);
  const callbackURL = `/desktop/connect?id=${encodeURIComponent(id)}`;
  useEffect(() => {
    let active = true;
    fetch(`/api/desktop/status?id=${encodeURIComponent(id)}`).then(async (response) => {
      if (!response.ok) throw new Error("This desktop request is invalid or expired. Start again in the desktop app.");
      const data = await response.json() as Status;
      if (active) setStatus(data);
    }).catch((cause: Error) => { if (active) setError(cause.message); });
    return () => { active = false; };
  }, [id]);

  const connect = async () => {
    setBusy(true);
    setError("");
    try {
      const result = !status?.signedIn ? await authClient.signIn.social({ provider: "google", callbackURL, errorCallbackURL: callbackURL }) :
        await authClient.linkSocial({
          provider: status.mode === "github" ? "github" : "google",
          scopes: status.mode === "github" ? ["read:user", "repo"] : ["https://www.googleapis.com/auth/gmail.modify", ...(status.mode === "google-settings" ? ["https://www.googleapis.com/auth/gmail.settings.basic"] : [])],
          callbackURL: `${callbackURL}&connected=1`, errorCallbackURL: callbackURL,
        });
      if (result.error) throw new Error("Could not start authorization. Check the instance and Google project settings.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Connection failed."); setBusy(false); }
  };

  const approve = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/desktop/approve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
      if (!response.ok) throw new Error("Could not approve this request. It may have expired; restart in the desktop app.");
      setApproved(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Connection failed."); }
    finally { setBusy(false); }
  };

  return <main className="flex min-h-svh items-center justify-center bg-background p-6 text-foreground">
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Connect BetterBox desktop</CardTitle>
        <CardDescription>{approved ? "Connection approved. Return to the desktop app." : "Only approve a request you started on your own computer."}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {status && !approved && <>
          <p className="text-sm text-muted-foreground">Check that this code matches the code in your BetterBox desktop window.</p>
          <p className="rounded-md bg-muted p-4 text-center font-mono text-2xl tracking-widest">{status.userCode}</p>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={matchesCode} onChange={(event) => setMatchesCode(event.target.checked)} />The codes match, and I started this request.</label>
          {!status.signedIn ? <Button disabled={busy || !matchesCode} onClick={connect}>Sign in with Google</Button> : !status.matchesUser ? <>
            <p className="text-sm">Sign in with the same primary BetterBox account as the desktop app to link mailboxes.</p>
            <Button variant="outline" onClick={async () => { await authClient.signOut(); window.location.reload(); }}>Use another account</Button>
          </> : <>
            <p className="font-mono text-sm">{status.email}</p>
            {status.mode !== "signin" && !connected ? <Button disabled={busy || !matchesCode} onClick={connect}>Connect {status.mode === "github" ? "GitHub" : "Google account"}</Button> : <>
              <p className="text-sm text-muted-foreground">This gives the desktop app access to your BetterBox workspace and its linked accounts.</p>
              <Button disabled={busy || !matchesCode} onClick={approve}>Approve desktop connection</Button>
            </>}
          </>}
        </>}
      </CardContent>
    </Card>
  </main>;
}
