import Link from "next/link";
import type { ReactNode } from "react";
import { AlertsBadge } from "./AlertsBadge";
import { AvatarMenu } from "./AvatarMenu";
import { getAwaitingPaymentCount } from "./header-queries";
import { HeaderSearch } from "./HeaderSearch";
import { OfflineStatusBar } from "./OfflineStatusBar";
import { PosNav } from "./PosNav";
import { getDayStatuses } from "./day/queries";
import { queryAsCurrentUser } from "../lib/db";
import styles from "./PosShell.module.css";

/**
 * Now an async Server Component (was a bare client shell) — the "Live
 * Header" context strip and alerts badge need real, server-queried data
 * (docs/DESIGN.md's 2026-07-19 "Amendment 3": wired to signals that
 * already exist, nothing invented). `usePathname()` for the active nav
 * tab and the AvatarMenu/HeaderSearch/AlertsBadge's own interactivity
 * stay in their own small client components — the standard Next.js
 * server-shell-around-client-leaves split, not a new pattern.
 *
 * Both queries run inside ONE RLS-scoped transaction (getDayStatuses is
 * the exact function apps/pos/app/day/queries.ts already exports — reused,
 * not duplicated) rather than two separate queryAsCurrentUser calls, so
 * every page pays for one connection acquisition, not two.
 */
export async function PosShell({ email, children }: { email?: string | undefined; children: ReactNode }) {
  const { days, awaitingPayment } = await queryAsCurrentUser(async (tx) => {
    const [days, awaitingPayment] = await Promise.all([getDayStatuses(tx), getAwaitingPaymentCount(tx)]);
    return { days, awaitingPayment };
  });
  const openCount = days.filter((d) => d.status === "open").length;
  const businessDate = days.find((d) => d.status === "open")?.businessDate ?? null;

  return (
    <>
      <header className={styles.bar}>
        <Link href="/floor" className={styles.mark}>
          <span className={styles.markRail} aria-hidden="true" />
          RestroBooth POS
        </Link>
        {/* A segmented track, not an underline — the active tab gets its
            own pill so it reads as "this is where you are" at a glance,
            not just a thin rule under some text. */}
        <PosNav />

        <div className={styles.contextStrip}>
          {businessDate ? (
            <>
              <span className={styles.contextDate}>{businessDate}</span>
              <span className={styles.contextDivider} aria-hidden="true" />
              <span className={openCount === days.length ? styles.contextOk : styles.contextWarn}>
                {openCount}/{days.length} outlets open
              </span>
            </>
          ) : (
            <span className={styles.contextWarn}>No open business day</span>
          )}
        </div>

        <span className={styles.spacer} />
        <HeaderSearch />
        <AlertsBadge awaitingPayment={awaitingPayment} />
        <AvatarMenu email={email} />
      </header>
      <OfflineStatusBar />
      <main className={styles.main}>{children}</main>
    </>
  );
}
