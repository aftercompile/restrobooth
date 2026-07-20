"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AppShell, shellClasses } from "@restrobooth/ui";
import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { signOut } from "./auth-actions";
import { IdleLogoutGuard } from "./IdleLogoutGuard";

const NAV = [
  { href: "/menu", label: "Menu" },
  // Reports, Inventory, Outlets land in later phases. Deliberately not
  // stubbed out as dead links — an empty nav destination that does nothing
  // is worse than one that isn't there yet.
];

/**
 * The console's own shell: owns routing (next/link, usePathname) and hands
 * @restrobooth/ui's framework-agnostic AppShell the rendered nav. That
 * split is ADR-0001 in practice — the design system knows how a nav link
 * looks, the app knows where it goes.
 */
export function ConsoleShell({ email, children }: { email?: string | undefined; children: ReactNode }) {
  const pathname = usePathname();

  return (
    <>
      <AppShell
        nav={NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={shellClasses.navLink}
              aria-current={active ? "page" : undefined}
            >
              {item.label}
            </Link>
          );
        })}
        actions={
          <>
            {email && <span className={shellClasses.userEmail}>{email}</span>}
            <SignOutButton />
          </>
        }
      >
        {children}
      </AppShell>
      <IdleLogoutGuard />
    </>
  );
}

function SignOutButton() {
  return (
    <form action={signOut}>
      <SignOutSubmit />
    </form>
  );
}

/** useFormStatus must be read from inside the <form> it tracks, hence the
 *  split from SignOutButton. */
function SignOutSubmit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      style={{
        font: "inherit",
        fontWeight: 600,
        fontSize: "var(--text-sm)",
        cursor: pending ? "not-allowed" : "pointer",
        opacity: pending ? 0.6 : 1,
        background: "transparent",
        border: "1px solid rgb(255 255 255 / 28%)",
        borderRadius: "var(--radius)",
        color: "#fff",
        minHeight: 36,
        padding: "0 12px",
      }}
    >
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
