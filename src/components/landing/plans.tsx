import { GITHUB_URL } from "@/components/integrations/github-mark";

import { Wrap } from "./primitives";
import { Waitlist } from "./waitlist";

export function Plans() {
  return (
    <Wrap id="v6-plan" label="plan" caption="two plans">
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="-m-px grid grid-cols-1 md:grid-cols-2">
          <div className="flex flex-col items-center justify-center border-t border-l border-border px-8 py-10 text-center">
            <span className="text-4xl font-semibold tracking-tight text-foreground">
              Free
            </span>
            <span className="mt-2 font-mono text-xs tracking-wide text-muted-foreground/60 uppercase">
              self-host
            </span>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-pretty text-muted-foreground">
              Full source on GitHub. Your own OAuth app. Your own database.
              Available today.
            </p>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-6 font-mono text-xs text-foreground underline underline-offset-2"
            >
              View on GitHub →
            </a>
          </div>

          <div className="flex flex-col items-center justify-center border-t border-l border-border px-8 py-10 text-center">
            <span className="text-4xl font-semibold tracking-tight text-foreground">
              $5
            </span>
            <span className="mt-2 font-mono text-xs tracking-wide text-muted-foreground/60 uppercase">
              /month · coming soon
            </span>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-pretty text-muted-foreground">
              Everything works out of the box. No setup, no OAuth app, no
              database. Just KB OneMail.
            </p>
            <div className="mt-6 w-full">
              <Waitlist big source="plan" />
            </div>
          </div>
        </div>
      </div>
    </Wrap>
  );
}
