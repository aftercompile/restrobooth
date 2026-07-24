"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useDragControls } from "framer-motion";
import { AnimatePresence, BOOTH_TRANSITION, motion, useMotionAllowed } from "../motion";
import styles from "./BottomSheet.module.css";

/**
 * The premium item-detail primitive — no bottom-sheet existed anywhere in
 * this system before (Dialog is a centered modal). Framer-motion only
 * (transform/opacity — drag included, since drag-to-dismiss is itself a
 * transform), gated on useMotionAllowed() same as OrderStatusBoard's own
 * direct `motion` usage: the static branch renders instantly with no
 * motion component in the tree, matching the structural-guard contract
 * motion.tsx's own header describes. Booth is the only density this ships
 * on today (lint-motion.mjs bans framer-motion in pos/kds/captain), but
 * nothing here is Booth-specific — reusable if another surface earns one.
 */
export function BottomSheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const motionAllowed = useMotionAllowed();
  const dragControls = useDragControls();
  const titleId = "rb-sheet-title";

  // Same focus-on-open-only and Escape-to-close contract as Dialog.tsx —
  // see that file's comment for why the effect deliberately excludes
  // onClose's identity from its dependency array.
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

  if (!motionAllowed) {
    if (!open) return null;
    return (
      <div className={styles.backdrop} onClick={onClose}>
        <div
          ref={panelRef}
          className={styles.panel}
          role="dialog"
          aria-modal="true"
          aria-labelledby={title ? titleId : undefined}
          tabIndex={-1}
          onClick={(e) => e.stopPropagation()}
        >
          <div className={styles.grabber} aria-hidden="true" />
          {title && (
            <h2 id={titleId} className={styles.title}>
              {title}
            </h2>
          )}
          {children}
        </div>
      </div>
    );
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className={styles.backdrop}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
        >
          <motion.div
            ref={panelRef}
            className={styles.panel}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={BOOTH_TRANSITION}
            drag="y"
            dragListener={false}
            dragControls={dragControls}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 120 || info.velocity.y > 500) onClose();
            }}
          >
            {/* dragListener={false} above means only THIS handle starts a
                drag (dragControls.start) — the panel body stays normally
                scrollable instead of fighting drag-to-dismiss for every
                touch, the standard framer-motion "drag handle" pattern. */}
            <div
              className={styles.grabber}
              aria-hidden="true"
              onPointerDown={(e) => dragControls.start(e)}
              style={{ touchAction: "none" }}
            />
            {title && (
              <h2 id={titleId} className={styles.title}>
                {title}
              </h2>
            )}
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
