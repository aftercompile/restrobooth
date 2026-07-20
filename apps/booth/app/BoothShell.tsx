"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
  const pathname = usePathname();
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
        <div className={styles.right}>
          <nav className={styles.nav}>
            <Link href="/" className={styles.navLink} aria-current={pathname === "/" ? "page" : undefined}>
              Your order
            </Link>
            <Link href="/menu" className={styles.navLink} aria-current={pathname === "/menu" ? "page" : undefined}>
              Menu
            </Link>
          </nav>
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
        </div>
      </header>
      <main className={styles.main}>{children}</main>
    </>
  );
}
