"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Badge, BellIcon, RefreshIcon, StateRail } from "@restrobooth/ui";
import { rampStateForElapsed, TABLE_DWELL_THRESHOLDS } from "@restrobooth/domain";
import { createClient } from "../../lib/supabase/client";
import { acknowledgeWaiterCall } from "./actions";
import type { FloorTable } from "./queries";
import { SeatTableDialog } from "./SeatTableDialog";
import styles from "./FloorList.module.css";

/** Slice 2c — same static-badge-plus-acknowledge pattern as
 *  apps/pos/app/floor/FloorMap.tsx's WaiterCalledBadge, sized for
 *  Captain's list row instead of a grid card. */
function WaiterCalledRow({ sessionId }: { sessionId: string }) {
  const [pending, startTransition] = useTransition();

  function handleAcknowledge() {
    startTransition(async () => {
      await acknowledgeWaiterCall(sessionId);
    });
  }

  return (
    <div className={styles.waiterRow}>
      <Badge tone="critical">
        <BellIcon className={styles.waiterBellIcon} aria-hidden="true" />
        Waiter called
      </Badge>
      <button type="button" className={styles.acknowledgeButton} disabled={pending} onClick={handleAcknowledge}>
        {pending ? "Clearing…" : "Acknowledge"}
      </button>
    </div>
  );
}

function formatElapsed(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}` : `${minutes} min`;
}

export function FloorList({ tables }: { tables: FloorTable[] }) {
  const router = useRouter();
  // Starts null, not Date.now() — see apps/pos/app/floor/FloorMap.tsx's
  // identical comment: server and client must render the same thing on
  // the first paint, or React discards the server HTML as a mismatch.
  const [now, setNow] = useState<number | null>(null);
  const [seating, setSeating] = useState<FloorTable | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  function handleRefresh() {
    setRefreshing(true);
    router.refresh();
    // Same fixed-pulse pattern as apps/pos/app/floor/FloorMap.tsx —
    // router.refresh() gives no completion signal, and this button is a
    // manual "I don't want to wait" escape hatch, not a real request
    // lifecycle worth wiring up.
    setTimeout(() => setRefreshing(false), 600);
  }

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const firstTick = setTimeout(tick, 0);
    const id = setInterval(tick, 30_000);
    return () => {
      clearTimeout(firstTick);
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("captain-floor")
      .on("postgres_changes", { event: "*", schema: "public", table: "table_sessions" }, () => router.refresh())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [router]);

  const byOutlet = useMemo(() => {
    const outlets = new Map<string, { outletName: string; areas: Map<string, { areaName: string; tables: FloorTable[] }> }>();
    for (const t of tables) {
      let outlet = outlets.get(t.outletId);
      if (!outlet) {
        outlet = { outletName: t.outletName, areas: new Map() };
        outlets.set(t.outletId, outlet);
      }
      let area = outlet.areas.get(t.areaId);
      if (!area) {
        area = { areaName: t.areaName, tables: [] };
        outlet.areas.set(t.areaId, area);
      }
      area.tables.push(t);
    }
    return outlets;
  }, [tables]);

  const runningCount = tables.filter((t) => t.sessionId).length;
  const availableCount = tables.length - runningCount;

  if (tables.length === 0) {
    return <p className={styles.empty}>No tables at any outlet you have access to.</p>;
  }

  return (
    <>
      <div className={styles.header}>
        <h1 className={styles.title}>
          Table view
          <span className={styles.counts}>
            {runningCount} running · {availableCount} available
          </span>
        </h1>
        <button type="button" className={styles.refreshButton} data-spinning={refreshing} onClick={handleRefresh}>
          <RefreshIcon />
          Refresh
        </button>
      </div>

      {Array.from(byOutlet.values()).map((outlet) => (
        <div key={outlet.outletName} className={styles.outlet}>
          <p className={styles.outletName}>{outlet.outletName}</p>
          {Array.from(outlet.areas.values()).map((area) => (
            <div key={area.areaName} className={styles.area}>
              <p className={styles.areaName}>{area.areaName}</p>
              <div className={styles.list}>
                {area.tables.map((t) => {
                  if (!t.sessionId || !t.openedAt) {
                    return (
                      <StateRail key={t.tableId} state="idle" label="Available">
                        <button type="button" className={styles.tableButton} onClick={() => setSeating(t)}>
                          <span className={styles.tableLabel}>{t.label}</span>
                          <span className={styles.tableMeta}>Seats {t.capacity} · available</span>
                        </button>
                      </StateRail>
                    );
                  }
                  const elapsedMs = now === null ? null : now - new Date(t.openedAt).getTime();
                  const rampState = elapsedMs === null ? "fresh" : rampStateForElapsed(elapsedMs, TABLE_DWELL_THRESHOLDS);
                  const elapsedLabel = elapsedMs === null ? "…" : formatElapsed(elapsedMs);
                  return (
                    <StateRail key={t.tableId} state={rampState} label={`${t.sessionStatus}, ${elapsedLabel}`}>
                      <Link
                        href={`/floor/${t.sessionId}`}
                        className={styles.tableButton}
                        data-waiter-called={t.waiterCalledAt !== null}
                      >
                        <span className={styles.tableLabelGroup}>
                          <span className={styles.tableLabel}>{t.label}</span>
                          {/* Optional — most walk-ins won't have one; the row is
                              the same height either way, just one line taller
                              when it's set. */}
                          {t.guestName && <span className={styles.guestName}>{t.guestName}</span>}
                        </span>
                        <span className={styles.tableMetaGroup}>
                          {/* Same "second signal, not folded into the rail" reasoning as
                              apps/pos/app/floor/FloorMap.tsx — the rail stays pure elapsed
                              time, these badges are their own axes. Captain has no
                              bill screen of its own (billing is a POS/cashier capability),
                              so bill status is a badge only, no quick-link. */}
                          {t.openedVia === "guest" && <Badge tone="neutral">Self-seated</Badge>}
                          {t.billStatus && (
                            <Badge tone={t.billStatus === "paid" ? "live" : "warning"}>
                              {t.billStatus === "paid" ? "Paid" : "Printed"}
                            </Badge>
                          )}
                          <span className={styles.tableMeta}>
                            {t.covers} cover{t.covers === 1 ? "" : "s"} · {t.sessionStatus}
                            <br />
                            <span className={styles.tableTimer}>{elapsedLabel}</span>
                          </span>
                        </span>
                      </Link>
                      {/* Outside the Link (an <a>, can't nest a click-handling
                          button) — same "acknowledge lives in a footer slot
                          beside the card" shape as apps/pos's FloorMap. */}
                      {t.waiterCalledAt && t.sessionId && <WaiterCalledRow sessionId={t.sessionId} />}
                    </StateRail>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ))}

      {seating && <SeatTableDialog table={seating} onClose={() => setSeating(null)} />}
    </>
  );
}
