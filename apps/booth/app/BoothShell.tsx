"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
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
  children,
}: {
  tableLabel: string;
  brandName: string;
  children: ReactNode;
}) {
  const pathname = usePathname();

  return (
    <>
      <header className={styles.bar}>
        <div className={styles.context}>
          <span className={styles.table}>Table {tableLabel}</span>
          <span className={styles.brand}>{brandName}</span>
        </div>
        <nav className={styles.nav}>
          <Link href="/" className={styles.navLink} aria-current={pathname === "/" ? "page" : undefined}>
            Your order
          </Link>
          <Link href="/menu" className={styles.navLink} aria-current={pathname === "/menu" ? "page" : undefined}>
            Menu
          </Link>
        </nav>
      </header>
      <main className={styles.main}>{children}</main>
    </>
  );
}
