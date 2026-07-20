"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { signOut } from "./auth-actions";
import { IdleLogoutGuard } from "./IdleLogoutGuard";
import styles from "./CaptainShell.module.css";

/** useFormStatus must be read from inside the <form> it tracks, hence the
 *  split from CaptainShell. Static label swap only — Captain is zero-motion. */
function SignOutSubmit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={styles.signOut} disabled={pending}>
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}

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
          <SignOutSubmit />
        </form>
      </header>
      <IdleLogoutGuard />
      <main className={styles.main}>{children}</main>
    </>
  );
}
