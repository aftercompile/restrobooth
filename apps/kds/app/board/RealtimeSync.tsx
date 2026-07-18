"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../../lib/supabase/client";
import { useOnlineStatus } from "../../lib/useOnlineStatus";
import styles from "./RealtimeSync.module.css";

const HEARTBEAT_INTERVAL_MS = 10_000;
const HEARTBEAT_MISS_LIMIT = 3; // 3 x 10s = 30s, ADR-0005 §2's own number
const POLL_INTERVAL_MS = 5_000;

/**
 * ADR-0005 §1/§2, the actual Phase 4 gate. Two transports:
 *
 *  - FAST PATH: a Realtime subscription on order_status_events. The
 *    payload is never trusted for its content (same principle as
 *    apps/pos's FloorMap.tsx) — any INSERT just triggers a
 *    `router.refresh()`, which re-runs the board's real, RLS-scoped
 *    queries. Because the board always re-derives "what's active right
 *    now" from the database rather than replaying individual events
 *    client-side, a missed message is self-healing by construction: the
 *    next message that DOES arrive triggers a full, correct refetch. This
 *    is what ADR-0005 §1 means by "a gap is not an error... handled
 *    without the user seeing anything" — there is no row-level
 *    reconciliation to get wrong.
 *
 *  - GUARANTEED PATH: a 10s heartbeat against the Realtime client's own
 *    socket state (`supabase.realtime.isConnected()`). Three consecutive
 *    misses (30s) — or the browser itself going offline — degrades to
 *    HTTP polling every 5s, with a visible, unmissable "reconnecting"
 *    banner. ADR-0005 §2: "a KDS with a stale connection must look
 *    broken" — a screen showing nothing because it's disconnected must
 *    never look the same as a screen showing nothing because there are no
 *    orders.
 */
export function RealtimeSync() {
  const router = useRouter();
  const online = useOnlineStatus();
  const [channelHealthy, setChannelHealthy] = useState(true);
  const missedHeartbeats = useRef(0);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("kds-order-status-events")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "order_status_events" }, () => {
        missedHeartbeats.current = 0;
        setChannelHealthy(true);
        setLastSyncedAt(Date.now());
        router.refresh();
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          missedHeartbeats.current = 0;
          setChannelHealthy(true);
          setLastSyncedAt(Date.now());
        } else if (status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setChannelHealthy(false);
        }
      });

    const heartbeat = setInterval(() => {
      if (supabase.realtime.isConnected()) {
        missedHeartbeats.current = 0;
        setChannelHealthy(true);
      } else {
        missedHeartbeats.current++;
        if (missedHeartbeats.current >= HEARTBEAT_MISS_LIMIT) setChannelHealthy(false);
      }
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      clearInterval(heartbeat);
      void supabase.removeChannel(channel);
    };
  }, [router]);

  const degraded = !online || !channelHealthy;

  // Polling fallback — gated on `online`, not just `degraded`: while the
  // BROWSER itself is offline, router.refresh()'s underlying fetch fails
  // outright, and Next's client router falls back to a hard navigation
  // that can't load at all offline — the exact crash apps/pos's offline
  // outbox hit first (see that code's identical comment). Polling only
  // makes sense for "the network is fine but the socket specifically
  // isn't" — a real, narrower case than "no connectivity at all," where
  // there's nothing to poll against and the `online` browser event below
  // is what recovers it instead.
  useEffect(() => {
    if (!online || channelHealthy) return;
    const poll = setInterval(() => {
      router.refresh();
      setLastSyncedAt(Date.now());
    }, POLL_INTERVAL_MS);
    return () => clearInterval(poll);
  }, [online, channelHealthy, router]);

  // The moment the browser itself comes back online, refresh immediately
  // rather than waiting for the next poll tick or heartbeat — the same
  // "drain right away on the 'online' event" pattern as the POS outbox.
  useEffect(() => {
    const onOnline = () => {
      router.refresh();
      setLastSyncedAt(Date.now());
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [router]);

  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!degraded) return;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [degraded]);

  if (!degraded) return null;

  const secondsAgo = now !== null && lastSyncedAt !== null ? Math.max(0, Math.floor((now - lastSyncedAt) / 1000)) : null;

  return (
    <div role="alert" className={styles.banner}>
      <span className={styles.dot} aria-hidden="true" />
      RECONNECTING{secondsAgo !== null ? ` — last synced ${secondsAgo}s ago` : ""}
    </div>
  );
}
