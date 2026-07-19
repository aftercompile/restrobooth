"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDownIcon } from "@restrobooth/ui";
import { signOut } from "./auth-actions";
import styles from "./AvatarMenu.module.css";

/**
 * Replaces the bare "email + Sign out button" pair with a single trigger,
 * matching the header redesign brief. No open/close transition — the
 * "keep POS zero-motion" call this session applies everywhere in the
 * shell except the floor grid specifically, and this lives in the shell.
 */
export function AvatarMenu({ email }: { email?: string | undefined }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const initial = email ? email.charAt(0).toUpperCase() : "?";

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button type="button" className={styles.trigger} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu">
        <span className={styles.avatar} aria-hidden="true">
          {initial}
        </span>
        <ChevronDownIcon className={styles.chevron} />
      </button>
      {open && (
        <div className={styles.menu} role="menu">
          {email && <div className={styles.email}>{email}</div>}
          <form action={signOut}>
            <button type="submit" className={styles.signOut} role="menuitem">
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
