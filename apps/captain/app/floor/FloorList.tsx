"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { StateRail } from "@restrobooth/ui";
import { rampStateForElapsed, TABLE_DWELL_THRESHOLDS } from "@restrobooth/domain";
import { createClient } from "../../lib/supabase/client";
import type { FloorTable } from "./queries";
import { SeatTableDialog } from "./SeatTableDialog";
import styles from "./FloorList.module.css";

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

  if (tables.length === 0) {
    return <p className={styles.empty}>No tables at any outlet you have access to.</p>;
  }

  return (
    <>
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
                      <Link href={`/floor/${t.sessionId}`} className={styles.tableButton}>
                        <span className={styles.tableLabel}>{t.label}</span>
                        <span className={styles.tableMeta}>
                          {t.covers} cover{t.covers === 1 ? "" : "s"} · {t.sessionStatus}
                          <br />
                          <span className={styles.tableTimer}>{elapsedLabel}</span>
                        </span>
                      </Link>
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
