"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "./Button";
import { Dialog } from "./Dialog";

const ACTIVITY_EVENTS = ["mousedown", "mousemove", "keydown", "touchstart", "wheel"] as const;

export interface UseIdleTimerOptions {
  timeoutMs: number;
  /** How long before timeout the warning state turns on. */
  warningMs: number;
  onTimeout: () => void;
}

/**
 * Pure activity tracking — no Supabase, no router, no Dialog even (that's
 * IdleWarningDialog below). Each app supplies its own `onTimeout` (its own
 * local `signOut` server action, the same one the avatar menu's "Sign out"
 * button already calls) — this package stays framework-agnostic about auth
 * the same way it does everywhere else (CLAUDE.md: no Supabase-specific API
 * in any UI component).
 */
export function useIdleTimer({ timeoutMs, warningMs, onTimeout }: UseIdleTimerOptions): {
  remainingMs: number;
  warning: boolean;
  stayActive: () => void;
} {
  const [remainingMs, setRemainingMs] = useState(timeoutMs);
  const lastActivityRef = useRef(Date.now());
  const firedRef = useRef(false);
  // A ref, not a dependency — re-subscribing the interval every time the
  // caller passes a fresh inline callback would reset its own timing.
  const onTimeoutRef = useRef(onTimeout);
  onTimeoutRef.current = onTimeout;

  const stayActive = useCallback(() => {
    lastActivityRef.current = Date.now();
    firedRef.current = false;
    setRemainingMs(timeoutMs);
  }, [timeoutMs]);

  useEffect(() => {
    for (const evt of ACTIVITY_EVENTS) window.addEventListener(evt, stayActive, { passive: true });
    return () => {
      for (const evt of ACTIVITY_EVENTS) window.removeEventListener(evt, stayActive);
    };
  }, [stayActive]);

  useEffect(() => {
    const id = setInterval(() => {
      const left = Math.max(0, timeoutMs - (Date.now() - lastActivityRef.current));
      setRemainingMs(left);
      // Fires once — the app's own onTimeout (signOut + redirect) takes it
      // from here; nothing left to keep counting down against.
      if (left <= 0 && !firedRef.current) {
        firedRef.current = true;
        onTimeoutRef.current();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [timeoutMs]);

  return { remainingMs, warning: remainingMs <= warningMs, stayActive };
}

/**
 * The warning dialog itself — purely presentational, driven by
 * useIdleTimer's state. A countdown a cashier or captain can dismiss with
 * one tap ("Still here") without losing whatever they were doing; anything
 * they were already doing is safe regardless (every mutation this session
 * touches is already server-persisted the moment it happens, not held in
 * unsaved client state — see ADR-0004), so the worst case of doing nothing
 * is just being dropped back to /login, never lost work.
 */
export function IdleWarningDialog({
  open,
  remainingMs,
  onStayActive,
}: {
  open: boolean;
  remainingMs: number;
  onStayActive: () => void;
}) {
  if (!open) return null;
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));

  return (
    <Dialog open={open} onClose={onStayActive} title="Still there?">
      <p style={{ margin: "0 0 var(--space-2)", color: "var(--text-muted)" }}>
        You'll be signed out in {seconds}s due to inactivity.
      </p>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Button type="button" variant="primary" onClick={onStayActive}>
          Stay signed in
        </Button>
      </div>
    </Dialog>
  );
}
