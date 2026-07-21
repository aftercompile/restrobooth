"use client";

import { useEffect, useRef, type ReactNode } from "react";
import styles from "./Dialog.module.css";

export function Dialog({
  open,
  onClose,
  title,
  children,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Focus only on the open transition, never re-fired by an `onClose`
  // identity change. `onClose` is near-always an inline arrow function at
  // the call site, so a parent that re-renders while the dialog is open
  // (a ticking clock, a realtime refresh, anything) would otherwise re-run
  // this effect and steal focus BACK to the panel — which forces the
  // browser to immediately close any native popup open inside it (a
  // `<select>` most visibly: it looked like the dropdown "wouldn't stay
  // open," but the real bug was the panel yanking focus out from under it
  // every re-render).
  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rb-dialog-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="rb-dialog-title" className={styles.title}>
          {title}
        </h2>
        {children}
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
    </div>
  );
}
