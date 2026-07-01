import { Wrench } from "lucide-react";

import { useSession } from "@/lib/auth/auth-client";
import { updateSettings, useSettings } from "@/hooks/use-settings";
import { Switch } from "@/components/ui/switch";
import { Page, PageSection, SettingRow } from "../primitives";

export function OwnerPage() {
  const settings = useSettings();
  const { data: session } = useSession();

  return (
    <Page>
      <PageSection title="Owner tools">
        <SettingRow
          label="Role"
          description="Granted out-of-band; clients can't set their own role"
        >
          <span className="inline-flex items-center gap-1.5 rounded-md border border-accent-2/40 bg-accent-2/8 px-2 py-1 font-mono text-[11px] font-medium tracking-wide text-accent-2-hover uppercase">
            <Wrench className="size-3" />
            {session?.user.role ?? "USER"}
          </span>
        </SettingRow>
        <SettingRow
          label="Demo mode"
          description="Hide real accounts and run on generated mail. Flip it on before recording, off when you’re done."
        >
          <Switch
            checked={settings.demoMode}
            onCheckedChange={(demoMode) => updateSettings({ demoMode })}
          />
        </SettingRow>
        <SettingRow
          label="Dev tools"
          description="Show the “Add test account” button in the sidebar and command palette"
        >
          <Switch
            checked={settings.devTools}
            onCheckedChange={(devTools) => updateSettings({ devTools })}
          />
        </SettingRow>
        <SettingRow
          label="Simulate send"
          description="Send looks successful — spinner, toast, and close — but no email is actually dispatched. For recording."
        >
          <Switch
            checked={settings.disableSending}
            onCheckedChange={(disableSending) =>
              updateSettings({ disableSending })
            }
          />
        </SettingRow>
      </PageSection>
    </Page>
  );
}
