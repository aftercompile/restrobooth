"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarIcon, FloorIcon, MenuBookIcon } from "@restrobooth/ui";
import styles from "./PosShell.module.css";

const NAV = [
  { href: "/floor", label: "Floor", Icon: FloorIcon },
  { href: "/menu", label: "Menu", Icon: MenuBookIcon },
  { href: "/day", label: "Day", Icon: CalendarIcon },
];

/**
 * Split out of PosShell so PosShell itself can become an async Server
 * Component (it now fetches the header's context-strip/alerts data) —
 * `usePathname()` for the active-tab highlight is the one piece of the
 * header that has to stay client.
 */
export function PosNav() {
  const pathname = usePathname();

  return (
    <nav className={styles.nav}>
      {NAV.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link key={item.href} href={item.href} className={styles.navLink} aria-current={active ? "page" : undefined}>
            <item.Icon className={styles.navIcon} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
