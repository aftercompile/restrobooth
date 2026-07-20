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

/** Same notification-band pattern as apps/pos/app/floor/FloorMap.tsx's
 *  WaiterAction — the whole strip is the acknowledge control, sized for
 *  Captain's list row instead of a grid card. */
function WaiterAction({ sessionId }: { sessionId: string }) {
  const [pending, startTransition] = useTransition();

  function handleAcknowledge() {
    startTransition(async () => {
      await acknowledgeWaiterCall(sessionId);
    });
  }

  return (
    <button type="button" className={styles.notifyAction} data-tone="critical" disabled={pending} onClick={handleAcknowledge}>
      <BellIcon className={styles.notifyIcon} aria-hidden="true" />
      <span className={styles.notifyLabel}>{pending ? "Clearing…" : "Waiter called"}</span>
      {!pending && <span className={styles.notifyHint}>Handled</span>}
    </button>
  );
}

/** Same priority order as apps/pos/app/floor/FloorMap.tsx's notifyTone —
 *  drives the band's own tone-tinted surface. */
function notifyTone(t: FloorTable): "critical" | "warning" | "positive" | "neutral" | "none" {
  if (t.waiterCalledAt) return "critical";
  if (t.billStatus === "printed") return "warning";
  if (t.billStatus === "paid") return "positive";
  if (t.openedVia === "guest") return "neutral";
  return "none";
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
                        <div className={styles.rowCard}>
                          <button type="button" className={styles.tableButton} onClick={() => setSeating(t)}>
                            <span className={styles.tableLabel}>{t.label}</span>
                            <span className={styles.tableMeta}>Seats {t.capacity} · available</span>
                          </button>
                          {/* Reserved even when empty — see .notifyBand's comment
                              below for why every row ends in the same
                              fixed-height strip. */}
                          <div className={styles.notifyBand} data-tone="none" />
                        </div>
                      </StateRail>
                    );
                  }
                  const elapsedMs = now === null ? null : now - new Date(t.openedAt).getTime();
                  const rampState = elapsedMs === null ? "fresh" : rampStateForElapsed(elapsedMs, TABLE_DWELL_THRESHOLDS);
                  const elapsedLabel = elapsedMs === null ? "…" : formatElapsed(elapsedMs);
                  return (
                    <StateRail key={t.tableId} state={rampState} label={`${t.sessionStatus}, ${elapsedLabel}`}>
                      <div className={styles.rowCard} data-waiter-called={t.waiterCalledAt !== null}>
                        <Link href={`/floor/${t.sessionId}`} className={styles.tableButton}>
                          <span className={styles.tableLabelGroup}>
                            <span className={styles.tableLabel}>{t.label}</span>
                            {/* Optional — most walk-ins won't have one; the row is
                                the same height either way, just one line taller
                                when it's set. */}
                            {t.guestName && <span className={styles.guestName}>{t.guestName}</span>}
                          </span>
                          <span className={styles.tableMetaGroup}>
                            <span className={styles.tableMeta}>
                              {t.covers} cover{t.covers === 1 ? "" : "s"} · {t.sessionStatus}
                              <br />
                              <span className={styles.tableTimer}>{elapsedLabel}</span>
                            </span>
                          </span>
                        </Link>
                        {/* The notification band — every row ends in this SAME
                            fixed-height strip regardless of state, mirroring
                            apps/pos/app/floor/FloorMap.tsx's .notifyBand (see its
                            comment for the full rationale). Outside the Link (an
                            <a>, can't nest a click-handling button). Priority:
                            waiter call > bill status > self-seated tag > empty.
                            Captain has no bill screen of its own (billing is a
                            POS/cashier capability), so bill status here is a
                            status only, no quick-link. */}
                        <div className={styles.notifyBand} data-tone={notifyTone(t)}>
                          {t.waiterCalledAt && t.sessionId ? (
                            <WaiterAction sessionId={t.sessionId} />
                          ) : t.billStatus ? (
                            <div className={styles.notifySubtle}>
                              <Badge tone={t.billStatus === "paid" ? "live" : "warning"}>
                                {t.billStatus === "paid" ? "Paid" : "Bill printed"}
                              </Badge>
                            </div>
                          ) : t.openedVia === "guest" ? (
                            <div className={styles.notifySubtle}>
                              <Badge tone="neutral">Self-seated</Badge>
                            </div>
                          ) : null}
                        </div>
                      </div>
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
