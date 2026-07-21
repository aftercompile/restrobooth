"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Badge, BellIcon, Card, CardHeader, CashIcon, CheckCircleIcon, FloorIcon, RampLegend, ReceiptIcon, RefreshIcon, SeatIcon } from "@restrobooth/ui";
import { rampStateForElapsed, TABLE_DWELL_THRESHOLDS, type RampState } from "@restrobooth/domain";
import { createClient } from "../../lib/supabase/client";
import { acknowledgeWaiterCall } from "./actions";
import type { FloorTable } from "./queries";
import { SeatTableDialog } from "./SeatTableDialog";
import styles from "./FloorMap.module.css";

/** The notification band's one interactive state (of the priority-ordered
 *  set below): the whole strip IS the acknowledge control, no separate
 *  badge+button pair to fit side by side — that's what let the button
 *  overflow narrow cards before. Its own component so per-table pending
 *  state doesn't need tracking in the parent's render loop. */
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

/** The band's own tone drives its surface (background + top border) — a
 *  distinct, tone-tinted strip so an operational alert reads as visually
 *  separate from the table details above it, not just another line of
 *  text. Priority order lives here, once, rather than being re-derived by
 *  each branch that reads it. */
function notifyTone(t: FloorTable): "critical" | "warning" | "positive" | "active" | "neutral" | "none" {
  if (t.waiterCalledAt) return "critical";
  if (t.hasPendingGuestPayment) return "critical";
  if (t.billStatus === "printed") return "warning";
  if (t.billStatus === "paid") return "positive";
  // Ready-to-serve outranks still-cooking: it's the more actionable of the
  // two (go get the food NOW vs. nothing to do yet), and a session can be
  // in both states at once (one KOT bumped, another still on the pass).
  // Both sit below bill status, not above it — once a bill's in motion
  // that's the more current story for the table even if a late add-on KOT
  // is technically still active.
  if (t.hasReadyToServe) return "warning";
  if (t.hasActiveKot) return "active";
  // Above the self-seated tag, which is a static context badge, not a
  // live status.
  if (t.openedVia === "guest") return "neutral";
  // The ambient "nothing to report" baseline once the table's actually
  // eating — below self-seated, which is more specific/useful information.
  if (t.sessionStatus === "dining") return "neutral";
  return "none";
}

const DWELL_LEGEND = [
  { label: "Available", color: "var(--text-muted)" },
  { label: "Fresh", color: "var(--ramp-fresh)" },
  { label: "Warming", color: "var(--ramp-warming)", detail: "15m+" },
  { label: "Hot", color: "var(--ramp-hot)", detail: "30m+" },
  { label: "Critical", color: "var(--ramp-critical)", detail: "60m+" },
];

const CHIP_LABEL: Record<RampState | "idle", string> = {
  idle: "Available",
  fresh: "Fresh",
  warming: "Warming",
  hot: "Hot",
  critical: "Critical",
};

// Same 20s cadence as the manual button's own "don't wait" framing — a
// floor view is glance-driven, not scroll-driven, so a poll this frequent
// costs nothing and the realtime subscription below already does the
// heavy lifting; this is a backstop for the rare missed message, not the
// primary transport (see KDS's own poll-as-backstop precedent).
const AUTO_REFRESH_MS = 20_000;

function formatElapsed(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}` : `${minutes} min`;
}

export function FloorMap({ tables }: { tables: FloorTable[] }) {
  const router = useRouter();
  // Header search's table-label branch (HeaderSearch.tsx) — a label isn't
  // unique across outlets, so it can't redirect to one page; it hands off
  // to this query param instead, and this page filters its own grid.
  const searchParams = useSearchParams();
  const query = (searchParams.get("q") ?? "").trim().toLowerCase();
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
  const [autoRefresh, setAutoRefresh] = useState(true);

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

  // A backstop, not the primary transport — see AUTO_REFRESH_MS's comment.
  // A visible toggle (not a silent background poll) so a cashier who wants
  // the screen to hold still for a second — mid-tap on a small target —
  // can turn it off rather than fight a moving target.
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => router.refresh(), AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, [autoRefresh, router]);

  const byOutlet = useMemo(() => {
    const outlets = new Map<string, { outletName: string; areas: Map<string, { areaName: string; tables: FloorTable[] }> }>();
    for (const t of tables) {
      if (query && !t.label.toLowerCase().includes(query)) continue;
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
  }, [tables, query]);

  // KPIs stay computed from the UNFILTERED set — a search is "help me
  // find a table," not "pretend the other 13 don't exist."
  const runningCount = tables.filter((t) => t.sessionId).length;
  const availableCount = tables.length - runningCount;
  const awaitingPaymentCount = tables.filter((t) => t.billStatus === "printed").length;

  if (tables.length === 0) {
    return <p className={styles.empty}>No tables at any outlet you have access to.</p>;
  }

  return (
    // Motion is OFF everywhere else in POS (order pad, bill, menu) by the
    // same standing rule as ever — this wrapper is the one, deliberate,
    // documented exception (docs/DESIGN.md's 2026-07-19 addendum): the
    // floor grid's own card lifecycle (hover, press, status change) gets
    // restrained motion, nothing else does. See FloorMap.module.css's
    // .floorMotionScope rule for how it out-specifies tokens/motion.css's
    // blanket POS kill-switch instead of fighting it.
    <div className={styles.floorMotionScope}>
      <div className={styles.header}>
        {query && (
          <div className={styles.searchBanner}>
            Showing tables matching &ldquo;{searchParams.get("q")}&rdquo;
            <button type="button" className={styles.searchClear} onClick={() => router.push("/floor")}>
              Clear
            </button>
          </div>
        )}
        <div className={styles.headerTop}>
          <h1 className={styles.title}>Table view</h1>
          <div className={styles.headerActions}>
            <RampLegend items={DWELL_LEGEND} />
            <button
              type="button"
              className={styles.autoRefreshToggle}
              data-on={autoRefresh}
              onClick={() => setAutoRefresh((v) => !v)}
              aria-pressed={autoRefresh}
            >
              <span className={styles.autoRefreshDot} aria-hidden="true" />
              Auto-refresh {autoRefresh ? "on" : "off"}
            </button>
            <button type="button" className={styles.refreshButton} data-spinning={refreshing} onClick={handleRefresh}>
              <RefreshIcon />
              Refresh
            </button>
          </div>
        </div>

        <div className={styles.kpiRow}>
          <div className={styles.kpiTile}>
            <FloorIcon className={styles.kpiIcon} />
            <div>
              <div className={styles.kpiValue}>{runningCount}</div>
              <div className={styles.kpiLabel}>Running</div>
            </div>
          </div>
          <div className={styles.kpiTile}>
            <SeatIcon className={styles.kpiIcon} />
            <div>
              <div className={styles.kpiValue}>{availableCount}</div>
              <div className={styles.kpiLabel}>Available</div>
            </div>
          </div>
          <div className={styles.kpiTile} data-attention={awaitingPaymentCount > 0}>
            <CashIcon className={styles.kpiIcon} />
            <div>
              <div className={styles.kpiValue}>{awaitingPaymentCount}</div>
              <div className={styles.kpiLabel}>Awaiting payment</div>
            </div>
          </div>
        </div>
      </div>

      {query && byOutlet.size === 0 && <p className={styles.empty}>No table matches &ldquo;{searchParams.get("q")}&rdquo;.</p>}

      {Array.from(byOutlet.values()).map((outlet) => {
        const outletTableCount = Array.from(outlet.areas.values()).reduce((sum, a) => sum + a.tables.length, 0);
        return (
          <Card key={outlet.outletName} padded={false} className={styles.outletCard}>
            <CardHeader title={outlet.outletName} count={`${outletTableCount} tables`} />
            <div className={styles.outletBody}>
              {Array.from(outlet.areas.values()).map((area) => (
                <div key={area.areaName} className={styles.area}>
                  <p className={styles.areaName}>{area.areaName}</p>
                  <div className={styles.grid}>
                    {area.tables.map((t) => {
                      if (!t.sessionId || !t.openedAt) {
                        return (
                          <div key={t.tableId} className={styles.tableCard} data-state="idle">
                            <button type="button" className={styles.tableCardInner} onClick={() => setSeating(t)}>
                              <div className={styles.cardTop}>
                                <span className={styles.tableLabel}>{t.label}</span>
                                <span className={styles.chip} data-state="idle">
                                  <span className={styles.chipDot} aria-hidden="true" />
                                  {CHIP_LABEL.idle}
                                </span>
                              </div>
                              <div className={styles.tableMeta}>
                                <SeatIcon className={styles.metaIcon} />
                                Seats {t.capacity}
                              </div>
                            </button>
                            {/* Reserved even when empty — see the notifyBand
                                comment below for why every card ends in the
                                same fixed-height strip. An idle table's is
                                never truly blank: "Ready for Guests" is the
                                one case where an empty footer would read as
                                broken rather than quiet. */}
                            <div className={styles.notifyBand} data-tone="none">
                              <div className={styles.notifySubtle}>
                                <span className={styles.notifyReady}>Ready for Guests</span>
                              </div>
                            </div>
                          </div>
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
                        <div
                          key={t.tableId}
                          className={styles.tableCard}
                          data-state={rampState}
                          data-waiter-called={t.waiterCalledAt !== null}
                        >
                          <Link href={`/floor/${t.sessionId}`} className={styles.tableCardInner}>
                            <div className={styles.cardTop}>
                              <span className={styles.tableLabel}>{t.label}</span>
                              <span className={styles.chip} data-state={rampState} title={`${t.sessionStatus}, ${elapsedLabel}`}>
                                <span className={styles.chipDot} aria-hidden="true" />
                                {CHIP_LABEL[rampState]}
                              </span>
                            </div>
                            {/* Guest name is a SECOND, separate line from the covers/timer
                                meta — not appended into it — so it reads clearly at a
                                glance and truncates independently if long. Optional: most
                                walk-ins won't have one, and the card layout is identical
                                either way, just one line shorter. */}
                            {t.guestName && <div className={styles.guestName}>{t.guestName}</div>}
                            <div className={styles.tableMeta}>
                              <SeatIcon className={styles.metaIcon} />
                              {t.covers} cover{t.covers === 1 ? "" : "s"} ·{" "}
                              <span className={styles.tableTimer}>{elapsedLabel}</span>
                            </div>
                          </Link>
                          {/* The notification band — every card ends in this SAME
                              fixed-height strip regardless of state, so one table's
                              event never grows its card and, by extension, never
                              stretches its whole grid row (CSS grid stretches every
                              card in a row to the tallest — that's what made a
                              waiter-called table taller than its neighbours before).
                              Content is priority-ordered and mutually exclusive,
                              never stacked: waiter call > payment to confirm > bill
                              status > ready to serve > cooking > self-seated tag >
                              dining > empty. Same slot future events (kitchen delay,
                              ...) would extend, not a new layout each time. */}
                          <div className={styles.notifyBand} data-tone={notifyTone(t)}>
                            {t.waiterCalledAt && t.sessionId ? (
                              <WaiterAction sessionId={t.sessionId} />
                            ) : t.hasPendingGuestPayment && t.sessionId ? (
                              // ADR-0010: only a link — confirming needs the bill's
                              // actual payment id/method, not just a table id, so
                              // unlike WaiterAction this can't act inline here.
                              <Link href={`/floor/${t.sessionId}/bill`} className={styles.notifyAction} data-tone="critical">
                                <CashIcon className={styles.notifyIcon} aria-hidden="true" />
                                <span className={styles.notifyLabel}>Payment to confirm</span>
                                <span className={styles.notifyHint}>View bill</span>
                              </Link>
                            ) : t.billStatus ? (
                              <Link
                                href={`/floor/${t.sessionId}/bill`}
                                className={styles.notifyAction}
                                data-tone={t.billStatus === "paid" ? "positive" : "warning"}
                              >
                                <ReceiptIcon className={styles.notifyIcon} aria-hidden="true" />
                                <span className={styles.notifyLabel}>{t.billStatus === "paid" ? "Paid" : "Bill printed"}</span>
                                <span className={styles.notifyHint}>View bill</span>
                              </Link>
                            ) : t.hasReadyToServe ? (
                              // Not a Link like Payment/Bill above — there's no
                              // distinct destination for this one, the whole card
                              // already goes to the order pad, same as Cooking below.
                              <div className={styles.notifySubtle}>
                                <CheckCircleIcon className={styles.readyIcon} aria-hidden="true" />
                                <span className={styles.notifyLabel}>Ready to serve</span>
                              </div>
                            ) : t.hasActiveKot ? (
                              <div className={styles.notifySubtle}>
                                <span className={styles.cookingPot} aria-hidden="true">
                                  🍲
                                </span>
                                <span className={styles.notifyLabel}>Cooking</span>
                              </div>
                            ) : t.openedVia === "guest" ? (
                              <div className={styles.notifySubtle}>
                                <Badge tone="neutral">Self Seated</Badge>
                              </div>
                            ) : t.sessionStatus === "dining" ? (
                              <div className={styles.notifySubtle}>
                                <span className={styles.notifyReady}>Dining</span>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        );
      })}

      {seating && <SeatTableDialog table={seating} onClose={() => setSeating(null)} />}
    </div>
  );
}
