import { cn } from "@/lib/utils";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Page, PageSection, SoonTag } from "../primitives";

const SHORTCUTS: { label: string; keys: string[]; soon?: boolean }[] = [
  { label: "Command palette", keys: ["⌘", "K"] },
  { label: "Compose", keys: ["C"] },
  { label: "Go to inbox (all accounts)", keys: ["G", "I"] },
  { label: "Switch account 1–9", keys: ["⌥", "1–9"] },
  { label: "Toggle raw source", keys: ["⌥", "R"] },
  { label: "Focus global search (unified view)", keys: ["/"] },
  { label: "Move between message rows", keys: ["↑", "↓"] },
];

export function KeyboardPage() {
  return (
    <Page>
      <PageSection title="Shortcuts">
        <div className="flex flex-col gap-3">
          {SHORTCUTS.map((shortcut) => (
            <div
              key={shortcut.label}
              className={cn(
                "flex items-center justify-between",
                shortcut.soon && "opacity-50",
              )}
            >
              <span className="flex items-center gap-2 text-[13px]">
                {shortcut.label}
                {shortcut.soon && <SoonTag />}
              </span>
              <KbdGroup>
                {shortcut.keys.map((key) => (
                  <Kbd key={key}>{key}</Kbd>
                ))}
              </KbdGroup>
            </div>
          ))}
        </div>
      </PageSection>
    </Page>
  );
}
