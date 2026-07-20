"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { Badge, Button, Card, CardHeader, useToast, type ToastTone } from "@restrobooth/ui";
import { createClient } from "../../../lib/supabase/client";
import { getOfflineDb, type OutboxEntry } from "../../../lib/offline/db";
import { enqueue, discardRejected } from "../../../lib/offline/outbox";
import { approveVoid, rejectVoid, reprintKot, requestVoid, voidPendingItem, type ActionState } from "./actions";
import { mergeSessions } from "../actions";
import type { KotSummary, OrderableMenuItem, OrderItemRow, SessionDetail } from "./queries";
import type { MergeCandidate } from "../queries";
import { AddItemPicker } from "./AddItemPicker";
import { UnseatDialog } from "./UnseatDialog";
import styles from "./OrderPad.module.css";

const REASONS = [
  { value: "guest_changed_mind", label: "Guest changed mind" },
  { value: "wrong_item_made", label: "Wrong item made" },
  { value: "quality_complaint", label: "Quality complaint" },
  { value: "staff_error", label: "Staff error" },
];

const INITIAL: ActionState = { error: null };

function formatRupees(paise: string): string {
  const n = BigInt(paise);
  return `${n / 100n}.${(n % 100n).toString().padStart(2, "0")}`;
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** A server-confirmed row, or one still local-only — ADR-0004's "the UI
 *  reads from here" overlay. `syncStatus` drives the badge; nothing else
 *  about rendering an item differs between the two cases. */
type DisplayItem = OrderItemRow & { syncStatus: "synced" | "pending" | "sending" | "rejected"; outboxId?: string };

export function OrderPad({
  session,
  order,
  kots,
  menu,
  mergeTargets,
  onGoToBill,
}: {
  session: SessionDetail;
  order: { orderId: string; businessDate: string; items: OrderItemRow[] } | null;
  kots: KotSummary[];
  menu: OrderableMenuItem[];
  mergeTargets: MergeCandidate[];
  onGoToBill: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  // Starts null, not Date.now() — see FloorMap.tsx's identical comment.
  // Server and client must render the same thing on the first paint, or
  // React discards the server HTML as a hydration mismatch.
  const [now, setNow] = useState<number | null>(null);
  const [showUnseat, setShowUnseat] = useState(false);

  // KOT ACK alarm needs second-scale precision (DOMAIN.md §3.3: "no ACK
  // after 10s raises an alarm"), unlike the floor map's minute-scale dwell
  // clock. See FloorMap.tsx's identical comment for why the first tick
  // goes through setTimeout(0) rather than a direct setNow() call.
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const firstTick = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(firstTick);
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`order-pad-${session.sessionId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "kots", filter: `table_session_id=eq.${session.sessionId}` }, () =>
        router.refresh(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [router, session.sessionId]);

  // ADR-0004's local-first overlay: every addOrderItem/fireOrder mutation
  // for THIS session, whatever its state. Once one applies, the realtime
  // subscription above (or the next online navigation) brings in the real
  // server row and this entry simply stops being rendered — see the
  // header note in outbox.ts on why that's a fine trade for this pass.
  const outboxEntries = useLiveQuery(
    () => getOfflineDb().outbox.where("sessionId").equals(session.sessionId).sortBy("createdAt"),
    [session.sessionId],
    [] as OutboxEntry[],
  );

  const pendingAddEntries = (outboxEntries ?? []).filter((e) => e.mutationType === "addOrderItem" && e.status !== "applied");
  const fireEntry = (outboxEntries ?? []).find((e) => e.mutationType === "fireOrder" && e.status !== "applied");

  const menuById = useMemo(() => new Map(menu.map((m) => [m.menuItemId, m])), [menu]);

  const baseItems: DisplayItem[] = (order?.items ?? []).map((i) => ({ ...i, syncStatus: "synced" }));
  const localItems: DisplayItem[] = pendingAddEntries.map((e) => {
    const p = e.payload as { orderItemId: string; menuItemId: string; quantity: number };
    const menuItem = menuById.get(p.menuItemId);
    return {
      orderItemId: p.orderItemId,
      businessDate: order?.businessDate ?? "",
      menuItemId: p.menuItemId,
      name: menuItem?.name ?? "(item)",
      kitchenSection: menuItem?.kitchenSection ?? "hot",
      quantity: p.quantity,
      unitPricePaise: menuItem?.pricePaise ?? "0",
      taxClassId: menuItem?.taxClassId ?? "",
      status: fireEntry ? "fired" : "pending", // optimistic: a queued fire covers queued adds too
      syncStatus: e.status === "sending" ? "sending" : e.status === "rejected" ? "rejected" : "pending",
      outboxId: e.id,
    };
  });

  // A directly-revisited/bookmarked URL can land here after the session
  // already reached a terminal status (the page itself applies no status
  // guard — see page.tsx) — hide Unseat rather than let it fail against
  // assertSessionTransition's rejection.
  const isTerminal = session.status === "closed" || session.status === "abandoned" || session.status === "merged_into";

  const items = [...baseItems, ...localItems];
  const pendingItems = items.filter((i) => i.status === "pending");
  const activeItems = items.filter((i) => i.status !== "pending" && i.status !== "voided");
  const total = items
    .filter((i) => i.status !== "voided")
    .reduce((sum, i) => sum + BigInt(i.unitPricePaise) * BigInt(i.quantity), 0n);

  // now === null only for the pre-hydration first paint; nothing can be
  // "stuck" yet as far as that render is concerned, and the real value
  // lands within the next tick (see the useState comment above).
  const stuckKots =
    now === null
      ? []
      : kots.filter((k) => (k.status === "queued" || k.status === "print_failed") && now - new Date(k.firedAt).getTime() > 10_000);

  async function handleDiscard(outboxId: string) {
    await discardRejected(outboxId);
  }

  return (
    <>
      {now !== null &&
        stuckKots.map((k) => (
          <div key={k.kotId} className={styles.alarm} role="alert">
            KOT #{k.kotNumber} ({k.kitchenSection}) — NO PRINTER ACK — {formatElapsed(now - new Date(k.firedAt).getTime())}
          </div>
        ))}

      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>
            {session.tableLabels}
            {session.guestName && <span className={styles.guestName}> — {session.guestName}</span>}
          </h1>
          <p className={styles.sub}>
            {session.brandName} · {session.covers} cover{session.covers === 1 ? "" : "s"} · {session.status}
            {session.guestPhone && ` · ${session.guestPhone}`}
          </p>
          {session.guestNotes && <p className={styles.guestNotes}>Note: {session.guestNotes}</p>}
        </div>
        {/* Was a full-width bar between the header and the columns below —
            moved next to the total it's derived from, compact, always in
            view without scrolling past an empty-looking strip. */}
        <div className={styles.headerRight}>
          <div className={styles.total}>₹{formatRupees(total.toString())}</div>
          {/* No manager gate, no menu-freeze check — releasing a table is
              legal from any non-terminal status (assertSessionTransition
              in the action itself is the real guard). See UnseatDialog's
              comment for why this stays a one-step confirm, not a full
              walkout/write-off flow. */}
          {!isTerminal && (
            <Button type="button" variant="danger" onClick={() => setShowUnseat(true)}>
              Unseat table
            </Button>
          )}
          <Button type="button" variant="secondary" onClick={onGoToBill}>
            Go to bill →
          </Button>
        </div>
      </div>

      {showUnseat && (
        <UnseatDialog
          sessionId={session.sessionId}
          hasActiveItems={activeItems.length > 0 || kots.length > 0}
          onClose={() => setShowUnseat(false)}
        />
      )}

      <div className={styles.columns}>
        <div>
          <Card padded={false}>
            <CardHeader title="Order" count={items.filter((i) => i.status !== "voided").length} />
            {activeItems.length === 0 && pendingItems.length === 0 && (
              <p className={styles.itemRow}>No items yet — add from the menu.</p>
            )}
            {activeItems.map((item) => (
              <OrderItemRowView key={item.orderItemId} item={item} sessionId={session.sessionId} onDiscard={handleDiscard} />
            ))}
            {pendingItems.map((item) => (
              <OrderItemRowView key={item.orderItemId} item={item} sessionId={session.sessionId} onDiscard={handleDiscard} />
            ))}
          </Card>

          <div className={styles.fireBar}>
            <FireButton sessionId={session.sessionId} disabled={pendingItems.length === 0 || !!fireEntry} firing={!!fireEntry} toast={toast} />
          </div>

          <p className={styles.sectionTitle}>KOTs</p>
          <Card padded={false}>
            {kots.length === 0 && !fireEntry && <p className={styles.itemRow}>None fired yet.</p>}
            {fireEntry && (
              <p className={styles.itemRow}>
                <Badge tone={fireEntry.status === "rejected" ? "critical" : "warning"}>
                  {fireEntry.status === "rejected" ? "fire failed" : "fire queued (syncing)"}
                </Badge>
                {fireEntry.status === "rejected" && fireEntry.errorMessage}
              </p>
            )}
            {kots.map((k) => (
              <KotRowView key={k.kotId} kot={k} sessionId={session.sessionId} now={now} />
            ))}
          </Card>

          {mergeTargets.length > 0 && <MergeControl sessionId={session.sessionId} targets={mergeTargets} />}
        </div>

        <div>
          <p className={styles.sectionTitle}>Add item</p>
          <AddItemPicker sessionId={session.sessionId} menu={menu} />
        </div>
      </div>
    </>
  );
}

function FireButton({
  sessionId,
  disabled,
  firing,
  toast,
}: {
  sessionId: string;
  disabled: boolean;
  firing: boolean;
  toast: (message: string, tone?: ToastTone) => void;
}) {
  const [submitting, setSubmitting] = useState(false);

  async function handleFire() {
    setSubmitting(true);
    try {
      await enqueue("fireOrder", sessionId, { sessionId });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not queue the fire.", "critical");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Button type="button" variant="primary" disabled={disabled || submitting} onClick={handleFire}>
      {firing ? "Firing…" : "Fire (F2)"}
    </Button>
  );
}

function OrderItemRowView({
  item,
  sessionId,
  onDiscard,
}: {
  item: DisplayItem;
  sessionId: string;
  onDiscard: (outboxId: string) => void;
}) {
  const [voidState, voidAction, voidPending] = useActionState(voidPendingItem, INITIAL);
  const [reqState, reqAction, reqPending] = useActionState(requestVoid, INITIAL);
  const [appState, appAction, appPending] = useActionState(approveVoid, INITIAL);
  const [rejState, rejAction, rejPending] = useActionState(rejectVoid, INITIAL);

  const lineTotal = (BigInt(item.unitPricePaise) * BigInt(item.quantity)).toString();
  const notYetSynced = item.syncStatus !== "synced";

  return (
    <div className={styles.itemRow}>
      <span className={styles.itemQty}>{item.quantity}×</span>
      <span className={styles.itemName}>{item.name}</span>
      {item.syncStatus === "pending" || item.syncStatus === "sending" ? <Badge tone="warning">syncing</Badge> : null}
      {item.syncStatus === "rejected" && <Badge tone="critical">sync failed</Badge>}
      <span className={styles.itemPrice}>₹{formatRupees(lineTotal)}</span>

      {item.syncStatus === "rejected" && item.outboxId && (
        <Button type="button" variant="secondary" className={styles.smallButton} onClick={() => onDiscard(item.outboxId!)}>
          Discard
        </Button>
      )}

      {/* Void/remove actions only make sense once the item is actually a
          real, server-confirmed row — a not-yet-synced local item is
          removed by discarding its outbox entry above, not by voiding. */}
      {!notYetSynced && item.status === "pending" && (
        <form action={voidAction} className={styles.voidForm}>
          <input type="hidden" name="orderItemId" value={item.orderItemId} />
          <input type="hidden" name="sessionId" value={sessionId} />
          <select name="reasonCode" className={styles.reasonSelect} defaultValue="guest_changed_mind">
            {REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          <Button type="submit" variant="secondary" className={styles.smallButton} disabled={voidPending}>
            Remove
          </Button>
          {voidState.error && <span style={{ color: "var(--signal-600)" }}>{voidState.error}</span>}
        </form>
      )}

      {!notYetSynced && item.status === "fired" && (
        <form action={reqAction}>
          <input type="hidden" name="orderItemId" value={item.orderItemId} />
          <input type="hidden" name="sessionId" value={sessionId} />
          <Button type="submit" variant="danger" className={styles.smallButton} disabled={reqPending}>
            Request void
          </Button>
          {reqState.error && <span style={{ color: "var(--signal-600)" }}>{reqState.error}</span>}
        </form>
      )}

      {item.status === "served" && <Badge tone="neutral">served</Badge>}

      {item.status === "void_requested" && (
        <>
          <Badge tone="warning">needs manager</Badge>
          <form action={appAction} className={styles.voidForm}>
            <input type="hidden" name="orderItemId" value={item.orderItemId} />
            <input type="hidden" name="sessionId" value={sessionId} />
            <select name="reasonCode" className={styles.reasonSelect} defaultValue="staff_error">
              {REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            <Button type="submit" variant="danger" className={styles.smallButton} disabled={appPending}>
              Approve
            </Button>
          </form>
          <form action={rejAction}>
            <input type="hidden" name="orderItemId" value={item.orderItemId} />
            <input type="hidden" name="sessionId" value={sessionId} />
            <Button type="submit" variant="secondary" className={styles.smallButton} disabled={rejPending}>
              Reject
            </Button>
          </form>
          {appState.error && <span style={{ color: "var(--signal-600)" }}>{appState.error}</span>}
          {rejState.error && <span style={{ color: "var(--signal-600)" }}>{rejState.error}</span>}
        </>
      )}
    </div>
  );
}

function KotRowView({ kot, sessionId, now }: { kot: KotSummary; sessionId: string; now: number | null }) {
  const [state, formAction, pending] = useActionState(reprintKot, INITIAL);
  const elapsedMs = now === null ? null : now - new Date(kot.firedAt).getTime();
  const stuck = elapsedMs !== null && (kot.status === "queued" || kot.status === "print_failed") && elapsedMs > 10_000;

  return (
    <div className={styles.kotRow}>
      <span className={styles.kotMeta}>
        #{kot.kotNumber} · {kot.kitchenSection} · {kot.status}
        {kot.reprintCount > 0 ? ` · reprinted ×${kot.reprintCount}` : ""}
      </span>
      <span className={styles.kotTimer}>{elapsedMs === null ? "…" : formatElapsed(elapsedMs)}</span>
      {stuck && <Badge tone="critical">no ack</Badge>}
      <form action={formAction}>
        <input type="hidden" name="kotId" value={kot.kotId} />
        <input type="hidden" name="sessionId" value={sessionId} />
        <Button type="submit" variant="secondary" className={styles.smallButton} disabled={pending}>
          Reprint
        </Button>
      </form>
      {state.error && <span style={{ color: "var(--signal-600)" }}>{state.error}</span>}
    </div>
  );
}

function MergeControl({ sessionId, targets }: { sessionId: string; targets: MergeCandidate[] }) {
  const [state, formAction, pending] = useActionState(mergeSessions, INITIAL);
  return (
    <form action={formAction} className={styles.mergeRow}>
      <input type="hidden" name="sourceSessionId" value={sessionId} />
      <select name="targetSessionId" className={styles.mergeSelect} required defaultValue="">
        <option value="" disabled>
          Merge into…
        </option>
        {targets.map((t) => (
          <option key={t.sessionId} value={t.sessionId}>
            {t.tableLabels}
          </option>
        ))}
      </select>
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Merging…" : "Merge"}
      </Button>
      {state.error && <span style={{ color: "var(--signal-600)" }}>{state.error}</span>}
    </form>
  );
}
