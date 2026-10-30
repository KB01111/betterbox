import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  desktopBridge,
  desktopRequest,
  type DesktopState,
  isDesktopState,
} from "@/lib/auth/desktop-bridge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Page, PageSection, SettingRow } from "../primitives";

export function DesktopPage() {
  const [state, setState] = useState<DesktopState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const load = useCallback(async () => {
    const value = await desktopRequest("state", {});
    if (!isDesktopState(value))
      throw new Error(
        "Desktop settings are unavailable. Update KB OneMail and try again.",
      );
    setState(value);
  }, []);
  useEffect(() => {
    void load().catch((e: Error) => setError(e.message));
  }, [load]);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      await load();
      setError(undefined);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Desktop action failed.";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Page>
      <PageSection title="Desktop">
        <p className="text-sm text-muted-foreground">
          {state?.version
            ? `Version ${state.version} · Unsigned personal preview`
            : "Connecting to desktop…"}
        </p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <SettingRow
          label="Notifications"
          description="Notify when new mail arrives"
        >
          <Switch
            aria-label="Notifications"
            disabled={!state || busy}
            checked={state?.notifications ?? true}
            onCheckedChange={(notifications) =>
              void run(() => desktopRequest("preferences", { notifications }))
            }
          />
        </SettingRow>
        {desktopBridge("appearance") && (
          <SettingRow
            label="Translucent window"
            description="Softly frosted sidebar and chrome; follows Windows transparency, contrast and battery settings"
          >
            <Switch
              aria-label="Translucent window"
              checked={state?.translucency ?? true}
              disabled={!state || busy}
              onCheckedChange={(translucency) =>
                void run(() => desktopRequest("preferences", { translucency }))
              }
            />
          </SettingRow>
        )}
        <SettingRow
          label="Sender and subject previews"
          description="Include sender and subject in Windows notifications"
        >
          <Switch
            aria-label="Sender and subject previews"
            disabled={!state || busy}
            checked={state?.previews ?? true}
            onCheckedChange={(previews) =>
              void run(() => desktopRequest("preferences", { previews }))
            }
          />
        </SettingRow>
        <SettingRow
          label="Launch at sign-in"
          description="Start KB OneMail when you sign in to Windows"
        >
          <Switch
            aria-label="Launch at sign-in"
            disabled={!state || busy}
            checked={state?.launchAtLogin ?? false}
            onCheckedChange={(launchAtLogin) =>
              void run(() => desktopRequest("preferences", { launchAtLogin }))
            }
          />
        </SettingRow>
        <SettingRow
          label="Background mail"
          description={state?.backgroundStatus ?? "Waiting for desktop status"}
        >
          <Button
            variant="outline"
            disabled={busy || !desktopBridge("mail")}
            onClick={() => void run(() => desktopRequest("check-mail", {}))}
          >
            Check mail
          </Button>
        </SettingRow>
        <SettingRow
          label="Default mail app"
          description="Choose KB OneMail in Windows Default apps"
        >
          <Button
            variant="outline"
            disabled={busy || !state}
            onClick={() => void run(() => desktopRequest("default-apps", {}))}
          >
            Open Default apps
          </Button>
        </SettingRow>
        <SettingRow
          label="Updates"
          description={
            state?.signedUpdates
              ? (state.update.error ?? `Update status: ${state.update.status}`)
              : "Unsigned preview — automatic signed updates are unavailable."
          }
        >
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={busy || !desktopBridge("updates")}
              onClick={() =>
                void run(() => desktopRequest("check-updates", {}))
              }
            >
              Check updates
            </Button>
            {state?.signedUpdates && state.update.status === "available" && (
              <Button
                disabled={busy}
                onClick={() =>
                  void run(() => desktopRequest("install-update", {}))
                }
              >
                Install {state.update.version}
              </Button>
            )}
          </div>
        </SettingRow>
      </PageSection>
    </Page>
  );
}
