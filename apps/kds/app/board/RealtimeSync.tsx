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
 *  - FAST PATH: a Realtime Broadcast subscription per accessible outlet, on
 *    topic `outlet:<id>:order_status_events` (see migration 0031). NOT
 *    postgres_changes: `order_status_events` is PARTITION BY RANGE
 *    (business_date), and this stack's self-hosted Realtime decodes
 *    postgres_changes via wal2json, which doesn't understand publications
 *    at all — `publish_via_partition_root` (0030) is silently inert for it,
 *    so a WAL-based subscription here never fires no matter what the
 *    publication says. A `FOR EACH ROW` trigger on the partitioned PARENT
 *    sidesteps that entirely by broadcasting explicitly instead of relying
 *    on WAL decoding. As before, the payload is never trusted for its
 *    content (same principle as apps/pos's FloorMap.tsx) — any message just
 *    triggers a `router.refresh()`, which re-runs the board's real,
 *    RLS-scoped queries. Because the board always re-derives "what's
 *    active right now" from the database rather than replaying individual
 *    events client-side, a missed message is self-healing by construction:
 *    the next message that DOES arrive triggers a full, correct refetch.
 *    This is what ADR-0005 §1 means by "a gap is not an error... handled
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
export function RealtimeSync({ outletIds }: { outletIds: string[] }) {
  const router = useRouter();
  const online = useOnlineStatus();
  const [channelHealthy, setChannelHealthy] = useState(true);
  const missedHeartbeats = useRef(0);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const outletIdsKey = outletIds.join(",");

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    let channels: ReturnType<typeof supabase.channel>[] = [];
    const unhealthy = new Set<string>();

    // The topic's messages are `private` (migration 0031), which Realtime
    // authorizes against the RLS policy on `realtime.messages` using the
    // JWT on the SOCKET — that defaults to anon until setAuth() runs.
    // supabase-js only wires that automatically on SIGNED_IN/TOKEN_REFRESHED
    // — never on the INITIAL_SESSION a page load with an already-signed-in
    // (SSR cookie) session fires — and even a reactive setAuth() call after
    // the fact can lose the race with .subscribe()'s own join push (two
    // back-to-back auth events carrying the same token make the client
    // library skip its own "already joined, push a fresh token" fallback,
    // since it only pushes on a token CHANGE). So: block on the real
    // session and setAuth() explicitly before ever building the channel,
    // guaranteeing the very first join carries the token.
    supabase.auth.getSession().then(async ({ data }) => {
      await supabase.realtime.setAuth(data.session?.access_token ?? null);
      if (cancelled || outletIds.length === 0) return;
      channels = outletIds.map((outletId) =>
        supabase
          .channel(`outlet:${outletId}:order_status_events`, { config: { private: true } })
          .on("broadcast", { event: "*" }, () => {
            missedHeartbeats.current = 0;
            setChannelHealthy(true);
            setLastSyncedAt(Date.now());
            router.refresh();
          })
          .subscribe((status) => {
            if (status === "SUBSCRIBED") {
              unhealthy.delete(outletId);
              missedHeartbeats.current = 0;
              setLastSyncedAt(Date.now());
            } else if (status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
              unhealthy.add(outletId);
            }
            setChannelHealthy(unhealthy.size === 0);
          }),
      );
    });

    const heartbeat = setInterval(() => {
      if (supabase.realtime.isConnected()) {
        missedHeartbeats.current = 0;
        setChannelHealthy(unhealthy.size === 0);
      } else {
        missedHeartbeats.current++;
        if (missedHeartbeats.current >= HEARTBEAT_MISS_LIMIT) setChannelHealthy(false);
      }
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(heartbeat);
      for (const channel of channels) void supabase.removeChannel(channel);
    };
    // outletIdsKey (a stable string) stands in for outletIds (a new array
    // identity every render from page.tsx's server fetch) — re-subscribing
    // on every render would thrash the socket for no reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, outletIdsKey]);

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
