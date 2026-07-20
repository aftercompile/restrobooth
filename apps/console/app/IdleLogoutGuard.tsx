"use client";

import { useCallback } from "react";
import { IdleWarningDialog, useIdleTimer } from "@restrobooth/ui";
import { signOut } from "./auth-actions";

// 60 minutes, no client clock — elapsed real time since the last
// pointer/key/touch/scroll event, not tied to business_date or any
// server-derived time. A security floor, not a domain rule.
const TIMEOUT_MS = 60 * 60 * 1000;
const WARNING_MS = 60 * 1000;

/** Mounted once inside ConsoleShell, which only ever renders on an already
 *  authenticated page (/login has no shell). Calls the SAME `signOut`
 *  server action the header's own button uses, directly. */
export function IdleLogoutGuard() {
  const handleTimeout = useCallback(() => {
    void signOut();
  }, []);

  const { remainingMs, warning, stayActive } = useIdleTimer({
    timeoutMs: TIMEOUT_MS,
    warningMs: WARNING_MS,
    onTimeout: handleTimeout,
  });

  return <IdleWarningDialog open={warning} remainingMs={remainingMs} onStayActive={stayActive} />;
}
