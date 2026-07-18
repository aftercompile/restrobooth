"use client";

import { useEffect, useState } from "react";

/** ADR-0005 §2: "a KDS with a stale connection must look broken." This is
 *  the browser-level half of that signal (the Realtime channel's own
 *  subscribe status is the other half — see RealtimeSync.tsx). */
export function useOnlineStatus(): boolean {
  // Starts true, not `navigator.onLine` — identical reasoning to
  // FloorMap.tsx's `now` clock (apps/pos): the value must match on the
  // server render and the client's first paint, and the real value lands
  // a tick later as an ordinary client-side update.
  const [online, setOnline] = useState(true);

  useEffect(() => {
    // See FloorMap.tsx's identical comment: a synchronous setState at the
    // top of an effect body is a cascading-render risk
    // (react-hooks/set-state-in-effect); nesting the first read one level
    // down via setTimeout(0) is the same "sync it right after mount"
    // behavior without tripping the rule.
    const syncNow = () => setOnline(navigator.onLine);
    const firstSync = setTimeout(syncNow, 0);
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      clearTimeout(firstSync);
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return online;
}
