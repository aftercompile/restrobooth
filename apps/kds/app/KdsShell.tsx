"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { signOut } from "./auth-actions";
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

/**
 * Deliberately no IdleLogoutGuard — every other staff app auto-signs-out
 * after 60 minutes of no mouse/key/touch/scroll, but KDS is a fixed
 * kitchen screen a cook glances at rather than touches; a quiet ticket
 * queue during a lull isn't the same thing as an unattended terminal.
 * Exempted at the owner's explicit request, not silently dropped — see
 * DECISIONS.md's 2026-07-20 entry.
 */
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
      <main className={styles.main}>{children}</main>
    </>
  );
}
