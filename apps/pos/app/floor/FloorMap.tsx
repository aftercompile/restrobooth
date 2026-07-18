"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Badge, RampLegend, ReceiptIcon, RefreshIcon, StateRail } from "@restrobooth/ui";
import { rampStateForElapsed, TABLE_DWELL_THRESHOLDS } from "@restrobooth/domain";
import { createClient } from "../../lib/supabase/client";
import type { FloorTable } from "./queries";
import { SeatTableDialog } from "./SeatTableDialog";
import styles from "./FloorMap.module.css";

const DWELL_LEGEND = [
  { label: "Available", color: "var(--text-muted)" },
  { label: "Fresh", color: "var(--ramp-fresh)" },
  { label: "Warming (15m+)", color: "var(--ramp-warming)" },
  { label: "Hot (30m+)", color: "var(--ramp-hot)" },
  { label: "Critical (60m+)", color: "var(--ramp-critical)" },
];

function formatElapsed(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}` : `${minutes} min`;
}

export function FloorMap({ tables }: { tables: FloorTable[] }) {
  const router = useRouter();
  // Starts null, not Date.now(): the initial value has to be IDENTICAL on
  // the server render and the client's first paint, or React logs a
  // hydration mismatch (server and client call Date.now() at different
  // instants) and throws away the server HTML. Setting the real clock only
  // inside the effect below means the first paint on both sides renders
  // the same "…" placeholder; the real value lands a moment later as an
  // ordinary client-side update, which hydration mismatch rules don't
  // apply to.
  const [now, setNow] = useState<number | null>(null);
  const [seating, setSeating] = useState<FloorTable | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  function handleRefresh() {
    setRefreshing(true);
    router.refresh();
    // No completion event from router.refresh() itself — the realtime
    // subscription below already keeps this view current on its own; this
    // button is a manual "I don't want to wait" escape hatch, so a short,
    // fixed pulse is enough to confirm the tap registered without wiring
    // up a real request-lifecycle signal for what is a fire-and-forget call.
    setTimeout(() => setRefreshing(false), 600);
  }

  // Table dwell is a minutes-scale clock — a 30s tick is plenty to keep the
  // rail's ramp state current without repainting every second (POS is
  // zero-motion; there is nothing to animate between ticks anyway). The
  // first tick fires via setTimeout(0) rather than a direct setNow() call
  // at the top of the effect — react-hooks/set-state-in-effect flags a
  // synchronous setState there (cascading-render risk); nesting it one
  // level down is the same "set it right after mount" behavior without
  // tripping the rule.
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const firstTick = setTimeout(tick, 0);
    const id = setInterval(tick, 30_000);
    return () => {
      clearTimeout(firstTick);
      clearInterval(id);
    };
  }, []);

  // The realtime signal is never trusted for its payload — any change on
  // either table just triggers a server refetch through the real,
  // RLS-scoped query (ADR-0005's "sockets for staff surfaces", scoped down
  // for Phase 3a: the full event-seq gap-detection consumer is Phase 4's
  // KDS work, not duplicated here for a surface with much lower stakes
  // than a lost kitchen ticket).
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("floor-map")
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
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>Table view</h1>
          <span className={styles.counts}>
            {runningCount} running · {availableCount} available
          </span>
        </div>
        <div className={styles.headerLeft}>
          <RampLegend items={DWELL_LEGEND} />
          <button type="button" className={styles.refreshButton} data-spinning={refreshing} onClick={handleRefresh}>
            <RefreshIcon />
            Refresh
          </button>
        </div>
      </div>

      {Array.from(byOutlet.values()).map((outlet) => (
        <div key={outlet.outletName} className={styles.outlet}>
          <p className={styles.outletName}>{outlet.outletName}</p>
          {Array.from(outlet.areas.values()).map((area) => (
            <div key={area.areaName} className={styles.area}>
              <p className={styles.areaName}>{area.areaName}</p>
              <div className={styles.grid}>
                {area.tables.map((t) => {
                  if (!t.sessionId || !t.openedAt) {
                    return (
                      <StateRail key={t.tableId} state="idle" label="Available">
                        <button type="button" className={styles.tableButton} onClick={() => setSeating(t)}>
                          <div className={styles.tableLabel}>{t.label}</div>
                          <div className={styles.tableMeta}>Seats {t.capacity} · available</div>
                        </button>
                      </StateRail>
                    );
                  }
                  // now === null only for the first paint, before the
                  // client clock effect runs (identical on server and
                  // client — see the useState comment above). "fresh" is a
                  // safe placeholder rail state for that one frame; it's
                  // replaced within a tick once `now` is set.
                  const elapsedMs = now === null ? null : now - new Date(t.openedAt).getTime();
                  const rampState = elapsedMs === null ? "fresh" : rampStateForElapsed(elapsedMs, TABLE_DWELL_THRESHOLDS);
                  const elapsedLabel = elapsedMs === null ? "…" : formatElapsed(elapsedMs);
                  return (
                    <StateRail key={t.tableId} state={rampState} label={`${t.sessionStatus}, ${elapsedLabel}`}>
                      <div className={styles.tableCard}>
                        <Link href={`/floor/${t.sessionId}`} className={styles.tableLink}>
                          <div className={styles.tableLabel}>{t.label}</div>
                          <div className={styles.tableMeta}>
                            {t.covers} cover{t.covers === 1 ? "" : "s"} · {t.sessionStatus} ·{" "}
                            <span className={styles.tableTimer}>{elapsedLabel}</span>
                          </div>
                        </Link>
                        {/* Bill lifecycle is a SECOND signal, deliberately not folded into
                            the rail (DESIGN.md: "only the rail encodes state with colour") —
                            the rail stays pure elapsed-time, this badge is the bill's own
                            status, and the two can disagree (a fresh table can already have
                            a printed bill if service was fast). */}
                        {t.billStatus && (
                          <div className={styles.tableFooter}>
                            <Badge tone={t.billStatus === "paid" ? "live" : "warning"}>
                              {t.billStatus === "paid" ? "Paid" : "Printed"}
                            </Badge>
                            <Link href={`/floor/${t.sessionId}/bill`} className={styles.billLink}>
                              <ReceiptIcon />
                              View bill
                            </Link>
                          </div>
                        )}
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
