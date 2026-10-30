import { Button } from "@/components/ui/button";
import { GITHUB_URL, GithubMark } from "@/components/integrations/github-mark";

import { COL, Wordmark, scrollToPlan } from "./primitives";

export function Header() {
  return (
    <div className={COL}>
      <header className="flex h-16 items-center gap-3 sm:gap-4">
        <Wordmark />
        <span className="ml-auto hidden font-mono text-xs text-muted-foreground/60 sm:inline">
          in development
        </span>
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="KB OneMail on GitHub"
          className="ml-auto inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-card hover:text-foreground sm:ml-0"
        >
          <GithubMark className="size-[18px]" />
        </a>
        <Button type="button" onClick={scrollToPlan} className="shrink-0">
          <span className="hidden sm:inline">Join the waitlist</span>
          <span className="sm:hidden">Waitlist</span>
        </Button>
      </header>
    </div>
  );
}
