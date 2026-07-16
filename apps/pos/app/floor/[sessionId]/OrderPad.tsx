"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, CardHeader } from "@restrobooth/ui";
import { createClient } from "../../../lib/supabase/client";
import {
  approveVoid,
  fireOrder,
  rejectVoid,
  reprintKot,
  requestVoid,
  voidPendingItem,
  type ActionState,
} from "./actions";
import { mergeSessions } from "../actions";
import type { KotSummary, OrderableMenuItem, OrderItemRow, SessionDetail } from "./queries";
import type { MergeCandidate } from "../queries";
import { AddItemPicker } from "./AddItemPicker";
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

export function OrderPad({
  session,
  order,
  kots,
  menu,
  mergeTargets,
}: {
  session: SessionDetail;
  order: { orderId: string; businessDate: string; items: OrderItemRow[] } | null;
  kots: KotSummary[];
  menu: OrderableMenuItem[];
  mergeTargets: MergeCandidate[];
}) {
  const router = useRouter();
  // Starts null, not Date.now() — see FloorMap.tsx's identical comment.
  // Server and client must render the same thing on the first paint, or
  // React discards the server HTML as a hydration mismatch.
  const [now, setNow] = useState<number | null>(null);

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

  const items = order?.items ?? [];
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
          <h1 className={styles.title}>{session.tableLabels}</h1>
          <p className={styles.sub}>
            {session.brandName} · {session.covers} cover{session.covers === 1 ? "" : "s"} · {session.status}
          </p>
        </div>
        <div className={styles.total}>₹{formatRupees(total.toString())}</div>
      </div>

      <Link href={`/floor/${session.sessionId}/bill`}>Go to bill →</Link>

      <div className={styles.columns}>
        <div>
          <Card padded={false}>
            <CardHeader title="Order" count={items.filter((i) => i.status !== "voided").length} />
            {activeItems.length === 0 && pendingItems.length === 0 && (
              <p className={styles.itemRow}>No items yet — add from the menu.</p>
            )}
            {activeItems.map((item) => (
              <OrderItemRowView key={item.orderItemId} item={item} sessionId={session.sessionId} />
            ))}
            {pendingItems.map((item) => (
              <OrderItemRowView key={item.orderItemId} item={item} sessionId={session.sessionId} />
            ))}
          </Card>

          <div className={styles.fireBar}>
            <FireButton sessionId={session.sessionId} disabled={pendingItems.length === 0} />
          </div>

          <p className={styles.sectionTitle}>KOTs</p>
          <Card padded={false}>
            {kots.length === 0 && <p className={styles.itemRow}>None fired yet.</p>}
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

function FireButton({ sessionId, disabled }: { sessionId: string; disabled: boolean }) {
  const [state, formAction, pending] = useActionState(fireOrder, INITIAL);
  return (
    <form action={formAction}>
      <input type="hidden" name="sessionId" value={sessionId} />
      <Button type="submit" variant="primary" disabled={disabled || pending}>
        {pending ? "Firing…" : "Fire (F2)"}
      </Button>
      {state.error && <span style={{ color: "var(--signal-600)", marginLeft: 8 }}>{state.error}</span>}
    </form>
  );
}

function OrderItemRowView({ item, sessionId }: { item: OrderItemRow; sessionId: string }) {
  const [voidState, voidAction, voidPending] = useActionState(voidPendingItem, INITIAL);
  const [reqState, reqAction, reqPending] = useActionState(requestVoid, INITIAL);
  const [appState, appAction, appPending] = useActionState(approveVoid, INITIAL);
  const [rejState, rejAction, rejPending] = useActionState(rejectVoid, INITIAL);

  const lineTotal = (BigInt(item.unitPricePaise) * BigInt(item.quantity)).toString();

  return (
    <div className={styles.itemRow}>
      <span className={styles.itemQty}>{item.quantity}×</span>
      <span className={styles.itemName}>{item.name}</span>
      <span className={styles.itemPrice}>₹{formatRupees(lineTotal)}</span>

      {item.status === "pending" && (
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

      {item.status === "fired" && (
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
