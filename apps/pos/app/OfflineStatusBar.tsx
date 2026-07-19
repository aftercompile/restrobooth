"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { Badge, Button } from "@restrobooth/ui";
import { getOfflineDb } from "../lib/offline/db";
import { drainOutbox, discardRejected } from "../lib/offline/outbox";
import { useOnlineStatus } from "../lib/offline/useOnlineStatus";
import styles from "./OfflineStatusBar.module.css";

/**
 * ADR-0004's visible half of the outbox: the cashier must always be able
 * to tell "am I offline right now" and "is anything stuck." A
 * disconnected KDS is supposed to *look* broken (DOMAIN.md §3.3's alarm);
 * a disconnected POS deliberately is NOT — this bar is the one place that
 * says so, everywhere else keeps working exactly as if online.
 *
 * Drains are triggered here (mount, the `online` event, and a 15s poll
 * as a fallback for the cases `online`/`offline` don't fire reliably) —
 * this is the ONE place in the app that owns "when do we try to sync,"
 * so `enqueue()` callers don't each need their own retry logic.
 */
/** Local IndexedDB delete, no network round trip — same static
 *  disabled+label-swap treatment as everywhere else, mainly to guard
 *  against a double click. */
function DiscardButton({ id }: { id: string }) {
  const [pending, setPending] = useState(false);
  return (
    <Button
      type="button"
      variant="secondary"
      className={styles.smallButton}
      disabled={pending}
      onClick={async () => {
        setPending(true);
        await discardRejected(id);
      }}
    >
      {pending ? "Discarding…" : "Discard"}
    </Button>
  );
}

export function OfflineStatusBar() {
  const router = useRouter();
  const online = useOnlineStatus();
  const [expanded, setExpanded] = useState(false);
  // No default value here on purpose — `undefined` means "hasn't resolved
  // yet" and `[]` means "resolved, genuinely empty." The refresh effect
  // below needs to tell those apart (see its own comment).
  const entries = useLiveQuery(() => getOfflineDb().outbox.toArray(), []);
  const resolved = entries ?? [];

  const syncing = resolved.filter((e) => e.status === "pending" || e.status === "sending");
  const rejected = resolved.filter((e) => e.status === "rejected");
  const appliedCount = resolved.filter((e) => e.status === "applied").length;

  useEffect(() => {
    void drainOutbox();
    const onOnline = () => void drainOutbox();
    window.addEventListener("online", onOnline);
    const poll = setInterval(() => void drainOutbox(), 15_000);
    return () => {
      window.removeEventListener("online", onOnline);
      clearInterval(poll);
    };
  }, []);

  // IndexedDB is shared across every tab of this origin, but only ONE tab's
  // drainOutbox() actually performs a given mutation — Dexie's cross-tab
  // change events are what let every OTHER tab find out. `entries` above
  // is already reactive to that; this effect is what turns "the shared
  // outbox changed" into "MY page's stale Server Component data should
  // refetch," regardless of which tab did the draining. Tying the refresh
  // to `appliedCount` rather than to this tab's own drain result is the
  // fix — the first version only refreshed whichever tab happened to win
  // the drain race, leaving every other open tab showing stale data
  // forever after a reconnect.
  //
  // Two failure modes this guards against, both found by the adversarial
  // test crashing a tab with a `chrome-error` page:
  //  1. A brand-new tab's FIRST query resolution already contains
  //     `applied` entries from earlier in the session (another table's
  //     seating, say) — that is not a "just completed" transition, so
  //     `prevApplied` starts at `null` and the first resolution only
  //     primes it, never refreshes.
  //  2. `router.refresh()`'s underlying fetch fails while offline, and
  //     Next's client router falls back to a hard navigation, which then
  //     can't load at all offline — hence `&& online` below, not just
  //     "was this tab the one that drained."
  const prevApplied = useRef<number | null>(null);
  useEffect(() => {
    if (entries === undefined) return; // first resolution still pending
    if (prevApplied.current !== null && appliedCount > prevApplied.current && online) {
      router.refresh();
    }
    prevApplied.current = appliedCount;
  }, [entries, appliedCount, online, router]);

  if (online && syncing.length === 0 && rejected.length === 0) return null;

  return (
    <div className={styles.bar}>
      <button type="button" className={styles.summary} onClick={() => setExpanded((v) => !v)}>
        {!online && <Badge tone="critical">offline</Badge>}
        {syncing.length > 0 && <Badge tone="warning">{syncing.length} syncing</Badge>}
        {rejected.length > 0 && <Badge tone="critical">{rejected.length} need attention</Badge>}
      </button>

      {expanded && (
        <div className={styles.panel}>
          {!online && <p className={styles.note}>No connection — mutations are queued locally and will send once you&rsquo;re back online.</p>}
          {rejected.map((e) => (
            <div key={e.id} className={styles.rejectedRow}>
              <span>
                {e.mutationType}: {e.errorMessage}
              </span>
              <DiscardButton id={e.id} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
