import { useEffect, useLayoutEffect, useState } from "react";

import { cn } from "@/lib/utils";
import { usePublicDesktopLifecycle } from "@/hooks/use-public-desktop";

import { AccessErrorBanner } from "./landing/access-error-banner";
import { Demo } from "./landing/demo";
import { Faq } from "./landing/faq";
import { Footer } from "./landing/footer";
import { Header } from "./landing/header";
import { Hero } from "./landing/hero";
import { Plans } from "./landing/plans";
import { Spec } from "./landing/spec";

// Layout effect on the client (avoids post-paint flash), plain effect on the
// server (where useLayoutEffect would warn).
const useIsoLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

/** Landing follows the OS color scheme, independent of the in-app theme — returns
 *  the `dark`/`light` class to scope onto the page. */
function useSystemTheme(): "dark" | "light" {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  // Layout effect so the scheme applies before paint — else a light-mode visitor
  // sees a dark frame first.
  useIsoLayoutEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => setTheme(mq.matches ? "dark" : "light");
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return theme;
}

/** Signed-out landing page — the "KB OneMail Landing v6" marketing layout, on the
 *  app's standard shadcn tokens and type scale. Follows the OS color scheme,
 *  independent of the in-app theme. Only bespoke flourish: the animated pulse dot. */
export function LandingPage() {
  usePublicDesktopLifecycle();
  const theme = useSystemTheme();

  // Mirror the system theme onto <html> while mounted. Overlays portal to <body>
  // and read the root class — without this they'd inherit the stored in-app theme
  // and render light inside a dark demo. Restored to the app's theme on unmount.
  useIsoLayoutEffect(() => {
    const root = document.documentElement;
    const had = {
      dark: root.classList.contains("dark"),
      light: root.classList.contains("light"),
    };
    const prevScheme = root.style.colorScheme;
    root.classList.remove("light", "dark");
    root.classList.add(theme);
    root.style.colorScheme = theme;
    return () => {
      root.classList.remove("light", "dark");
      if (had.dark) root.classList.add("dark");
      else if (had.light) root.classList.add("light");
      root.style.colorScheme = prevScheme;
    };
  }, [theme]);

  return (
    <div
      className={cn(
        theme,
        "h-svh w-full overflow-y-auto bg-background text-foreground",
      )}
    >
      <AccessErrorBanner />
      <Header />
      <Hero />
      <Demo />
      <Spec />
      <Plans />
      <Faq />
      <Footer />
    </div>
  );
}
