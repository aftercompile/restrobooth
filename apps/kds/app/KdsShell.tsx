"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { signOut } from "./auth-actions";
import { IdleLogoutGuard } from "./IdleLogoutGuard";
import styles from "./KdsShell.module.css";

/** useFormStatus must be read from inside the <form> it tracks, hence the
 *  split from KdsShell. Static label swap only — KDS is zero-motion. */
function SignOutSubmit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={styles.signOut} disabled={pending}>
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}

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
          <SignOutSubmit />
        </form>
      </header>
      <IdleLogoutGuard />
      <main className={styles.main}>{children}</main>
    </>
  );
}
