"use client";

import type { ReactNode } from "react";
import { signOut } from "./auth-actions";
import styles from "./KdsShell.module.css";

export function KdsShell({ email, children }: { email?: string | undefined; children: ReactNode }) {
  return (
    <>
      <header className={styles.bar}>
        <span className={styles.mark}>
          <span className={styles.markRail} aria-hidden="true" />
          RestroBooth KDS
        </span>
        <span className={styles.spacer} />
        {email && <span className={styles.userEmail}>{email}</span>}
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
