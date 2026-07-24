"use client";

import { useTransition } from "react";
import type { ReactNode } from "react";
import { BellIcon, useToast } from "@restrobooth/ui";
import { callWaiterAction } from "./actions";
import styles from "./BoothShell.module.css";

/**
 * Deliberately NOT packages/ui's AppShell — that's the desktop, dark-header
 * chrome built for Console (nav + actions row, wide layout). The Booth is
 * a phone, one guest, two destinations — a slim bar is the whole shell it
 * needs. Same ADR-0001 split as every other app's own Shell: the design
 * system owns tokens/components, the app owns its own chrome and routing.
 *
 * The old Order/Menu tab toggle is gone (Booth redesign Pass 1, guided
 * journey) — discovery now lives on the menu itself (the persistent
 * CartPill routes menu → order) and the order screen carries its own
 * "Add more items" link back to the menu, so nothing that toggle did is
 * actually lost, it's just not header chrome anymore.
 */
export function BoothShell({
  tableLabel,
  brandName,
  waiterCalled,
  children,
}: {
  tableLabel: string;
  brandName: string;
  waiterCalled: boolean;
  children: ReactNode;
}) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  function handleCallWaiter() {
    startTransition(async () => {
      const result = await callWaiterAction();
      if (result.error) toast(result.error, "critical");
      else if (!waiterCalled) toast("A staff member has been notified", "neutral");
    });
  }

  return (
    <>
      <header className={styles.bar}>
        <div className={styles.context}>
          <span className={styles.table}>Table {tableLabel}</span>
          <span className={styles.brand}>{brandName}</span>
        </div>
        <button
          type="button"
          className={styles.callWaiterButton}
          data-called={waiterCalled}
          disabled={pending}
          onClick={handleCallWaiter}
          aria-label={waiterCalled ? "Waiter notified — tap to call again" : "Call waiter"}
          title={waiterCalled ? "Waiter notified" : "Call waiter"}
        >
          <BellIcon className={styles.bellIcon} />
        </button>
      </header>
      <main className={styles.main}>{children}</main>
    </>
  );
}
