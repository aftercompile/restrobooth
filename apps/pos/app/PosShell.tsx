"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { CalendarIcon, FloorIcon, MenuBookIcon } from "@restrobooth/ui";
import { AvatarMenu } from "./AvatarMenu";
import { OfflineStatusBar } from "./OfflineStatusBar";
import styles from "./PosShell.module.css";

const NAV = [
  { href: "/floor", label: "Floor", Icon: FloorIcon },
  { href: "/menu", label: "Menu", Icon: MenuBookIcon },
  { href: "/day", label: "Day", Icon: CalendarIcon },
];

export function PosShell({ email, children }: { email?: string | undefined; children: ReactNode }) {
  const pathname = usePathname();

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
                <item.Icon className={styles.navIcon} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <span className={styles.spacer} />
        <AvatarMenu email={email} />
      </header>
      <OfflineStatusBar />
      <main className={styles.main}>{children}</main>
    </>
  );
}
