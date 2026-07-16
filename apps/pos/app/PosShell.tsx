"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { signOut } from "./auth-actions";
import styles from "./PosShell.module.css";

const NAV = [{ href: "/floor", label: "Floor" }];

export function PosShell({ email, children }: { email?: string | undefined; children: ReactNode }) {
  const pathname = usePathname();

  return (
    <>
      <header className={styles.bar}>
        <Link href="/floor" className={styles.mark}>
          <span className={styles.markRail} aria-hidden="true" />
          RestroBooth POS
        </Link>
        <nav className={styles.nav}>
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={styles.navLink}
                aria-current={active ? "page" : undefined}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
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
