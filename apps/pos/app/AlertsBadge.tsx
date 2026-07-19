"use client";

import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { BellIcon } from "@restrobooth/ui";
import { getOfflineDb } from "../lib/offline/db";
import { useOnlineStatus } from "../lib/offline/useOnlineStatus";
import styles from "./AlertsBadge.module.css";

/**
 * Aggregates signals that already exist elsewhere — never a second data
 * source. `syncing`/`rejected` are the exact same Dexie outbox
 * OfflineStatusBar reads (that bar stays as the detailed sync view; this
 * is a one-glance mirror of it, reachable from every page, not just the
 * order pad). `awaitingPayment` is queried once, server-side, in
 * PosShell (see header-queries.ts's getAwaitingPaymentCount) and passed
 * down as a prop. No stuck-KOT count here — that alarm is inherently
 * per-open-session (apps/pos/app/floor/[sessionId]/OrderPad.tsx's own
 * `.alarm`), and globalising it would mean a second, disconnected
 * "no printer ACK" signal instead of the one that's already loud where a
 * cashier can actually act on it.
 */
export function AlertsBadge({ awaitingPayment }: { awaitingPayment: number }) {
  const online = useOnlineStatus();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const entries = useLiveQuery(() => getOfflineDb().outbox.toArray(), []) ?? [];
  const syncing = entries.filter((e) => e.status === "pending" || e.status === "sending").length;
  const rejected = entries.filter((e) => e.status === "rejected").length;

  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const actionable = rejected + awaitingPayment;
  const allClear = online && syncing === 0 && rejected === 0 && awaitingPayment === 0;

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button type="button" className={styles.trigger} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu">
        <BellIcon className={styles.icon} />
        {actionable > 0 && <span className={styles.dot} data-tone={rejected > 0 ? "critical" : "warning"} aria-hidden="true" />}
      </button>
      {open && (
        <div className={styles.panel} role="menu">
          {!online && <div className={styles.row}>Offline — mutations queued locally</div>}
          {syncing > 0 && <div className={styles.row}>{syncing} syncing</div>}
          {rejected > 0 && (
            <div className={styles.row} data-tone="critical">
              {rejected} need attention
            </div>
          )}
          {awaitingPayment > 0 && (
            <div className={styles.row} data-tone="warning">
              {awaitingPayment} bill{awaitingPayment === 1 ? "" : "s"} awaiting payment
            </div>
          )}
          {allClear && <div className={styles.row}>All clear</div>}
        </div>
      )}
    </div>
  );
}
