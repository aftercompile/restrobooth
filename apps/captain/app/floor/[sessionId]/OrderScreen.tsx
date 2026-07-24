"use client";

import { useActionState, useState, type ReactNode } from "react";
import { Badge, Card, CardHeader, Button } from "@restrobooth/ui";
import { callForBill, fireOrder, markKotServed, requestVoid, voidPendingItem, type ActionState } from "./actions";
import type { KotSummary, OrderableMenuItem, OrderItemRow, SessionDetail } from "./queries";
import { AddItemPicker } from "./AddItemPicker";
import { UnseatDialog } from "./UnseatDialog";
import styles from "./OrderScreen.module.css";

const INITIAL: ActionState = { error: null };

function formatRupees(paise: string): string {
  const n = BigInt(paise);
  return `${n / 100n}.${(n % 100n).toString().padStart(2, "0")}`;
}

export function OrderScreen({
  session,
  order,
  kots,
  menu,
  upsellSlot,
}: {
  session: SessionDetail;
  order: { orderId: string; businessDate: string; items: OrderItemRow[] } | null;
  kots: KotSummary[];
  menu: OrderableMenuItem[];
  /** A Server Component slot (Suspense-wrapped, page.tsx builds it), not
   *  raw data — this screen is a Client Component and can't itself await
   *  the 9s-budgeted AI call; the parent streams it in instead. */
  upsellSlot: ReactNode;
}) {
  const [showUnseat, setShowUnseat] = useState(false);

  const items = order?.items ?? [];
  const pendingItems = items.filter((i) => i.status === "pending");
  const activeItems = items.filter((i) => i.status !== "pending" && i.status !== "voided");
  const total = items
    .filter((i) => i.status !== "voided")
    .reduce((sum, i) => sum + BigInt(i.unitPricePaise) * BigInt(i.quantity), 0n);

  // A directly-revisited URL can land here after the session already
  // reached a terminal status — same guard as apps/pos's OrderPad.
  const isTerminal = session.status === "closed" || session.status === "abandoned" || session.status === "merged_into";

  // A guard, not a server rule: calling for the bill with un-fired items
  // still sitting in the order would freeze the menu (DOMAIN.md §3.1)
  // before the kitchen ever saw them. The server only cares about the
  // session's own status transition (dining -> bill_requested) — this is
  // just keeping the captain from doing something they'd regret.
  const canCallForBill = session.status === "dining" && pendingItems.length === 0;

  return (
    <>
      <div className={styles.header}>
        <h1 className={styles.title}>
          {session.tableLabels}
          {session.guestName && <span className={styles.guestName}> — {session.guestName}</span>}
        </h1>
        <p className={styles.sub}>
          {session.brandName} · {session.covers} cover{session.covers === 1 ? "" : "s"} · {session.status}
          {session.guestPhone && ` · ${session.guestPhone}`}
        </p>
        {session.guestNotes && <p className={styles.guestNotes}>Note: {session.guestNotes}</p>}
        <div className={styles.total}>₹{formatRupees(total.toString())}</div>
        {!isTerminal && (
          <div className={styles.unseatRow}>
            <Button type="button" variant="danger" className={styles.unseatButton} onClick={() => setShowUnseat(true)}>
              Unseat table
            </Button>
          </div>
        )}
      </div>

      {showUnseat && (
        <UnseatDialog
          sessionId={session.sessionId}
          hasActiveItems={activeItems.length > 0 || kots.length > 0}
          onClose={() => setShowUnseat(false)}
        />
      )}

      <Card padded={false}>
        <CardHeader title="Order" count={items.filter((i) => i.status !== "voided").length} />
        {activeItems.length === 0 && pendingItems.length === 0 && (
          <p className={styles.itemRow}>No items yet — add from the menu below.</p>
        )}
        {activeItems.map((item) => (
          <OrderItemRowView key={item.orderItemId} item={item} sessionId={session.sessionId} />
        ))}
        {pendingItems.map((item) => (
          <OrderItemRowView key={item.orderItemId} item={item} sessionId={session.sessionId} />
        ))}
      </Card>

      {upsellSlot}

      <div className={styles.fireBar}>
        <FireButton sessionId={session.sessionId} disabled={pendingItems.length === 0} />
      </div>

      {kots.length > 0 && (
        <>
          <p className={styles.sectionTitle}>Kitchen</p>
          <Card padded={false}>
            {kots.map((k) => (
              <KotRowView key={k.kotId} kot={k} sessionId={session.sessionId} />
            ))}
          </Card>
        </>
      )}

      <div className={styles.billBar}>
        <CallForBillButton sessionId={session.sessionId} disabled={!canCallForBill} />
      </div>

      <p className={styles.sectionTitle}>Add item</p>
      <AddItemPicker sessionId={session.sessionId} menu={menu} />
    </>
  );
}

function FireButton({ sessionId, disabled }: { sessionId: string; disabled: boolean }) {
  const [state, formAction, pending] = useActionState(fireOrder, INITIAL);
  return (
    <form action={formAction}>
      <input type="hidden" name="sessionId" value={sessionId} />
      <Button type="submit" variant="primary" className={styles.fireButton} disabled={disabled || pending}>
        {pending ? "Firing…" : "Fire to kitchen"}
      </Button>
      {state.error && <p style={{ color: "var(--signal-600)", marginTop: 6 }}>{state.error}</p>}
    </form>
  );
}

/** A ticket's kitchen status plus, once bumped, the one action a captain
 *  actually takes on it: carry it to the table and mark it delivered. Not
 *  bumped yet → status text only, nothing to do. Bumped with items still
 *  'fired' → the button. Bumped and fully delivered → a quiet confirmation,
 *  same shape as OrderItemRowView's own "served" badge below. */
function KotRowView({ kot, sessionId }: { kot: KotSummary; sessionId: string }) {
  const [state, formAction, pending] = useActionState(markKotServed, INITIAL);
  const readyToServe = kot.status === "bumped" && kot.unservedCount > 0;

  return (
    <div className={styles.kotRow}>
      <span className={styles.kotMeta}>
        #{kot.kotNumber} · {kot.kitchenSection} · {kot.status}
      </span>
      {readyToServe && (
        <form action={formAction}>
          <input type="hidden" name="kotId" value={kot.kotId} />
          <input type="hidden" name="sessionId" value={sessionId} />
          <Button type="submit" variant="primary" className={styles.smallButton} disabled={pending}>
            {pending ? "Marking…" : "Mark served"}
          </Button>
        </form>
      )}
      {kot.status === "bumped" && kot.unservedCount === 0 && <Badge tone="live">served</Badge>}
      {state.error && <p style={{ color: "var(--signal-600)", width: "100%" }}>{state.error}</p>}
    </div>
  );
}

function CallForBillButton({ sessionId, disabled }: { sessionId: string; disabled: boolean }) {
  const [state, formAction, pending] = useActionState(callForBill, INITIAL);
  return (
    <form action={formAction}>
      <input type="hidden" name="sessionId" value={sessionId} />
      <Button type="submit" variant="secondary" className={styles.billButton} disabled={disabled || pending}>
        {pending ? "Calling…" : "Call for bill"}
      </Button>
      {state.error && <p style={{ color: "var(--signal-600)", marginTop: 6 }}>{state.error}</p>}
    </form>
  );
}

function OrderItemRowView({ item, sessionId }: { item: OrderItemRow; sessionId: string }) {
  const [voidState, voidAction, voidPending] = useActionState(voidPendingItem, INITIAL);
  const [reqState, reqAction, reqPending] = useActionState(requestVoid, INITIAL);

  const lineTotal = (BigInt(item.unitPricePaise) * BigInt(item.quantity)).toString();

  return (
    <div className={styles.itemRow}>
      <span className={styles.itemQty}>{item.quantity}×</span>
      <span className={styles.itemName}>{item.name}</span>
      <span className={styles.itemPrice}>₹{formatRupees(lineTotal)}</span>

      {item.status === "pending" && (
        <form action={voidAction}>
          <input type="hidden" name="orderItemId" value={item.orderItemId} />
          <input type="hidden" name="sessionId" value={sessionId} />
          <Button type="submit" variant="secondary" className={styles.smallButton} disabled={voidPending}>
            Remove
          </Button>
          {voidState.error && <p style={{ color: "var(--signal-600)", width: "100%" }}>{voidState.error}</p>}
        </form>
      )}

      {item.status === "fired" && (
        <form action={reqAction}>
          <input type="hidden" name="orderItemId" value={item.orderItemId} />
          <input type="hidden" name="sessionId" value={sessionId} />
          <Button type="submit" variant="danger" className={styles.smallButton} disabled={reqPending}>
            Flag for void
          </Button>
          {reqState.error && <p style={{ color: "var(--signal-600)", width: "100%" }}>{reqState.error}</p>}
        </form>
      )}

      {item.status === "served" && <Badge tone="neutral">served</Badge>}
      {item.status === "void_requested" && <Badge tone="warning">needs manager</Badge>}
    </div>
  );
}
