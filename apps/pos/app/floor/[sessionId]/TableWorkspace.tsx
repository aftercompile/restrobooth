"use client";

import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { computeBill, type BillLineInput, type TaxRateInput } from "@restrobooth/domain";
import { Button } from "@restrobooth/ui";
import { getOfflineDb } from "../../../lib/offline/db";
import { OrderPad } from "./OrderPad";
import { BillView } from "./bill/BillView";
import type { KotSummary, OrderableMenuItem, OrderItemRow, SessionDetail } from "./queries";
import type { MergeCandidate } from "../queries";
import type { BillPreview, ExistingBill } from "./bill/queries";
import styles from "./OrderPad.module.css";

/**
 * ADR-0004's other half of "no if(offline) branch": billing must not
 * require a page NAVIGATION, because Next.js's dynamic-route client
 * router always revalidates against the server, even for an
 * already-visited page — confirmed directly (killing the network and
 * clicking an already-visited link threw a hard navigation error, not a
 * cache hit). A route change is therefore not offline-safe by construction
 * in this app, regardless of how good the local-first write path is.
 * The fix: order pad and bill are two VIEWS of one already-loaded page,
 * switched with local state, never a navigation. `/floor/[sessionId]/bill`
 * still exists as a standalone route for direct/bookmarked links — those
 * only work online, same as any other fresh navigation.
 */
export function TableWorkspace({
  session,
  order,
  kots,
  menu,
  mergeTargets,
  bills,
}: {
  session: SessionDetail;
  order: { orderId: string; businessDate: string; items: OrderItemRow[] } | null;
  kots: KotSummary[];
  menu: OrderableMenuItem[];
  mergeTargets: MergeCandidate[];
  bills: ExistingBill[];
}) {
  const [view, setView] = useState<"order" | "bill">("order");

  // Independent overlay from the one OrderPad computes internally — same
  // outbox, different shape (this one needs tax rates and a billable-
  // status filter; OrderPad's needs neither). Both are cheap Dexie
  // subscriptions; there's no shared-state benefit to unifying them.
  const outboxEntries = useLiveQuery(
    () => getOfflineDb().outbox.where("sessionId").equals(session.sessionId).sortBy("createdAt"),
    [session.sessionId],
    [],
  );
  const fireEntry = (outboxEntries ?? []).find((e) => e.mutationType === "fireOrder" && e.status !== "applied");
  const pendingAdds = (outboxEntries ?? []).filter((e) => e.mutationType === "addOrderItem" && e.status !== "applied");

  const menuById = new Map(menu.map((m) => [m.menuItemId, m]));
  const serverBillable = (order?.items ?? []).filter((i) => i.status === "fired" || i.status === "served");
  const localBillable = fireEntry
    ? pendingAdds
        .map((e) => {
          const p = e.payload as { orderItemId: string; menuItemId: string; quantity: number };
          const m = menuById.get(p.menuItemId);
          if (!m) return null;
          return {
            orderItemId: p.orderItemId,
            name: m.name,
            quantity: p.quantity,
            unitPricePaise: m.pricePaise,
            taxClassId: m.taxClassId,
            taxRateBps: m.taxRateBps,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null)
    : [];

  const previewLines = [
    ...serverBillable.map((i) => ({
      orderItemId: i.orderItemId,
      name: i.name,
      quantity: i.quantity,
      unitPricePaise: i.unitPricePaise,
      taxClassId: i.taxClassId,
      taxRateBps: menuById.get(i.menuItemId)?.taxRateBps ?? 0,
    })),
    ...localBillable,
  ];

  const billLines: BillLineInput[] = previewLines.map((l) => ({
    id: l.orderItemId,
    grossPaise: BigInt(l.unitPricePaise) * BigInt(l.quantity),
    taxClassId: l.taxClassId,
  }));
  const taxRates: TaxRateInput[] = Array.from(new Map(previewLines.map((l) => [l.taxClassId, l.taxRateBps])).entries()).map(
    ([taxClassId, rateBps]) => ({ taxClassId, rateBps }),
  );
  const computed = computeBill({ lines: billLines, taxRates, isIntraState: true });
  const preview: BillPreview = { lines: previewLines, computed };

  if (view === "bill") {
    return (
      <>
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>Bill — {session.tableLabels}</h1>
            <p className={styles.sub}>{session.brandName}</p>
          </div>
        </div>
        <Button type="button" variant="secondary" onClick={() => setView("order")}>
          ← Back to order
        </Button>
        <BillView sessionId={session.sessionId} preview={preview} bills={bills} />
      </>
    );
  }

  return (
    <OrderPad session={session} order={order} kots={kots} menu={menu} mergeTargets={mergeTargets} onGoToBill={() => setView("bill")} />
  );
}
