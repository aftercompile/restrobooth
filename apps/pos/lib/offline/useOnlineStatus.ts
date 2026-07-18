"use client";

import { useEffect, useState } from "react";

/** ADR-0004 §5: card/UPI need the network by definition — offline, the
 *  tender options are cash and "pay at counter later," and the UI must
 *  say so rather than fail mysteriously. This is the signal that gates it. */
export function useOnlineStatus(): boolean {
  // Starts true, not `navigator.onLine` — identical reasoning to
  // FloorMap.tsx's `now` clock: the value must match on the server render
  // and the client's first paint (there IS no server value; assuming
  // online avoids a guaranteed mismatch), and the real value lands a tick
  // later as an ordinary client-side update.
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
