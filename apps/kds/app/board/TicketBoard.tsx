"use client";

import { useEffect, useMemo, useState } from "react";
import { StateRail, Badge } from "@restrobooth/ui";
import { KOT_AGE_THRESHOLDS, rampStateForElapsed } from "@restrobooth/domain";
import type { Ticket } from "./queries";
import styles from "./TicketBoard.module.css";

type SectionFilter = "all" | "hot" | "cold" | "bar";

function formatAge(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function TicketBoard({ tickets, multiBrandOutlet }: { tickets: Ticket[]; multiBrandOutlet: boolean }) {
  const [filter, setFilter] = useState<SectionFilter>("all");
  // Ticket age needs second-scale precision (DOMAIN.md §3.3 / the KDS gate:
  // "no ACK after 10s raises an alarm" on POS, and here the age itself is
  // the primary signal a cook reads) — starts null, not Date.now(), so the
  // server-rendered first paint and the client's first paint match
  // exactly; see FloorMap.tsx / OrderPad.tsx's identical comment for why.
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const firstTick = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(firstTick);
      clearInterval(id);
    };
  }, []);

  const counts = useMemo(() => {
    const c = { all: tickets.length, hot: 0, cold: 0, bar: 0 };
    for (const t of tickets) c[t.kitchenSection as "hot" | "cold" | "bar"]++;
    return c;
  }, [tickets]);

  const visible = filter === "all" ? tickets : tickets.filter((t) => t.kitchenSection === filter);

  return (
    <>
      <div className={styles.filterBar}>
        {(["all", "hot", "cold", "bar"] as const).map((f) => (
          <button
            key={f}
            type="button"
            className={styles.filterButton}
            aria-current={filter === f ? "true" : undefined}
            onClick={() => setFilter(f)}
          >
            {f === "all" ? "All" : f[0]!.toUpperCase() + f.slice(1)} <span className={styles.filterCount}>{counts[f]}</span>
          </button>
        ))}
      </div>

      {visible.length === 0 && <p className={styles.empty}>No active tickets{filter !== "all" ? ` on ${filter}` : ""}.</p>}

      <div className={styles.grid}>
        {visible.map((t) => {
          const elapsedMs = now === null ? null : now - new Date(t.firedAt).getTime();
          const rampState = elapsedMs === null ? "fresh" : rampStateForElapsed(elapsedMs, KOT_AGE_THRESHOLDS);
          const ageLabel = elapsedMs === null ? "…" : formatAge(elapsedMs);
          return (
            <StateRail key={t.kotId} state={rampState} label={`${t.status}, ${ageLabel} old`}>
              <div className={styles.ticket}>
                <div className={styles.ticketHeader}>
                  <span className={styles.kotNumber}>#{String(t.kotNumber).padStart(4, "0")}</span>
                  <span className={styles.tableInfo}>
                    {t.tableLabels} · {t.covers}p
                  </span>
                  <span className={styles.age}>{ageLabel}</span>
                </div>
                <div className={styles.badgeRow}>
                  <Badge tone="neutral">{t.kitchenSection}</Badge>
                  {multiBrandOutlet && <Badge tone="neutral">{t.brandName}</Badge>}
                  {t.reprintCount > 0 && <Badge tone="warning">reprint ×{t.reprintCount}</Badge>}
                </div>
                <ul className={styles.itemList}>
                  {t.items.map((item) => (
                    <li key={item.orderItemId} className={styles.item}>
                      <span className={styles.itemQty}>{item.quantity}×</span>
                      <span className={styles.itemName}>{item.name}</span>
                      {item.prepNotes && <span className={styles.itemNotes}>{item.prepNotes}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            </StateRail>
          );
        })}
      </div>
    </>
  );
}
