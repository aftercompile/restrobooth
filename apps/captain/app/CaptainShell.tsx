"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "./auth-actions";
import styles from "./CaptainShell.module.css";

/**
 * Deliberately no nav bar — the captain app is one flow (floor -> order),
 * not a set of destinations, so there is nothing to switch between the way
 * apps/pos's PosShell switches to a future Reports page.
 */
export function CaptainShell({ children }: { children: ReactNode }) {
  return (
    <>
      <header className={styles.bar}>
        <Link href="/floor" className={styles.mark}>
          <span className={styles.markRail} aria-hidden="true" />
          Captain
        </Link>
        <span className={styles.spacer} />
        <form action={signOut}>
          <button type="submit" className={styles.signOut}>
            Sign out
          </button>
        </form>
      </header>
      <main className={styles.main}>{children}</main>
    </>
  );
}
