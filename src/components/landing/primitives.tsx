import { MailIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export const COL = "mx-auto max-w-6xl px-5 sm:px-8 md:px-10";

/** The animated "live" status dot, reused across hero/demo/loading. */
export function PulseDot() {
  return (
    <span className="size-2 flex-none rounded-full bg-success motion-safe:animate-bb-pulse" />
  );
}

export function Wordmark({ small }: { small?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={cn(
          "inline-flex flex-none items-center justify-center rounded-md bg-[#2563EB] text-white",
          small ? "size-5" : "size-6",
        )}
      >
        <MailIcon className={small ? "size-3" : "size-3.5"} />
      </span>
      <span
        className={cn(
          "font-mono font-semibold tracking-tight whitespace-nowrap text-foreground",
          small ? "text-xs" : "text-sm",
        )}
      >
        KB OneMail
      </span>
    </span>
  );
}

/** Smooth-scroll to the plan section. The landing is its own `overflow-y-auto`
 *  container, not the window — hence scrollIntoView, not window.scrollTo. */
export function scrollToPlan() {
  document
    .getElementById("v6-plan")
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function SectionLabel({
  children,
  caption,
}: {
  children: React.ReactNode;
  caption?: string;
}) {
  return (
    <div className="mb-6 flex items-baseline">
      <span className="font-mono text-xs font-medium tracking-wide text-muted-foreground/60 uppercase">
        {children}
      </span>
      {caption && (
        <span className="ml-auto font-mono text-xs text-muted-foreground/60">
          {caption}
        </span>
      )}
    </div>
  );
}

export function Wrap({
  children,
  label,
  caption,
  id,
}: {
  children: React.ReactNode;
  label?: string;
  caption?: string;
  id?: string;
}) {
  return (
    <section id={id} className={COL}>
      <div className="border-t border-border pt-10 pb-14">
        {label && <SectionLabel caption={caption}>{label}</SectionLabel>}
        {children}
      </div>
    </section>
  );
}
