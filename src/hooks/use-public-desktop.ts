import { useEffect } from "react";
import { useRouterState } from "@tanstack/react-router";
import {
  desktopAction,
  desktopBridge,
  desktopRequest,
  DESKTOP_ACTION_EVENT,
  reportDesktopLifecycle,
} from "@/lib/auth/desktop-bridge";

/** Public screens have no editable mailbox; queued mailto stays native until sign-in. */
export function usePublicDesktopLifecycle() {
  const inMailbox = useRouterState({
    select: (state) => state.matches.some((match) => match.routeId === "/_app"),
  });
  useEffect(() => {
    if (inMailbox || !desktopBridge("lifecycle")) return;
    const quit = (event: Event) => {
      const action = desktopAction((event as CustomEvent).detail);
      if (action?.kind === "quit-request")
        void desktopRequest("quit-response", {
          requestId: action.requestId,
          allow: true,
        }).catch(() => {});
    };
    window.addEventListener(DESKTOP_ACTION_EVENT, quit);
    reportDesktopLifecycle(false, false);
    void desktopRequest("ready", { authenticated: false }).catch(() => {});
    return () => {
      window.removeEventListener(DESKTOP_ACTION_EVENT, quit);
      reportDesktopLifecycle(true, true);
    };
  }, [inMailbox]);
}
