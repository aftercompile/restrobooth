"use client";

import { AnimatePresence, BOOTH_TRANSITION, motion, StateRail, useMotionAllowed, type RailState } from "@restrobooth/ui";
import type { GuestOrderItem } from "../lib/order-queries";
import styles from "./OrderStatusBoard.module.css";

/** order_item.status (fired/served/void_requested — pending items live in
 *  CartSection.tsx instead, not here) to a friendly label + the rail
 *  state that carries it. packages/domain doesn't own this mapping, it's
 *  guest-facing presentation, not a business rule. */
function guestStatus(status: string): { label: string; rail: RailState } {
  switch (status) {
    case "fired":
      return { label: "Cooking", rail: "warming" };
    case "served":
      return { label: "Served", rail: "fresh" };
    case "void_requested":
      return { label: "Being adjusted", rail: "idle" };
    default:
      return { label: status, rail: "idle" };
  }
}

/**
 * DESIGN.md's split-flap board — this slice's faithful rendition is a
 * per-item tile that FLIPS (rotateX spring) when its status changes, not a
 * full character-level Solari board (a later enhancement). Motion is
 * gated structurally on useMotionAllowed(), per packages/ui/src/motion.tsx's
 * own instruction for anything beyond <Animate> — importing `motion`
 * directly here, exactly as that file's header describes.
 *
 * Only items already sent to the kitchen (fired/served/void_requested)
 * render here — a still-editable cart line lives in CartSection.tsx
 * instead, since "in your cart" isn't kitchen status, it's an order the
 * guest can still change.
 */
export function OrderStatusBoard({ items }: { items: GuestOrderItem[] }) {
  const motionAllowed = useMotionAllowed();

  if (items.length === 0) return null;

  return (
    <StateRail state="fresh" glow>
      <div className={styles.board}>
        {items.map((item) => {
        const { label, rail } = guestStatus(item.status);
        const tile = (
          <div className={styles.tile}>
            <span>
              <span className={styles.name}>{item.name}</span>
              {item.quantity > 1 && <span className={styles.qty}>×{item.quantity}</span>}
            </span>
            <span className={styles.statusLabel} data-tone={rail}>
              {item.status === "fired" &&
                (motionAllowed ? (
                  <motion.span
                    aria-hidden="true"
                    className={styles.cookingPot}
                    animate={{ rotate: [-8, 8, -8] }}
                    transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
                  >
                    🍲
                  </motion.span>
                ) : (
                  <span aria-hidden="true" className={styles.cookingPot}>
                    🍲
                  </span>
                ))}
              {label}
            </span>
          </div>
        );

        if (!motionAllowed) return <div key={item.orderItemId}>{tile}</div>;

        return (
          <AnimatePresence mode="wait" key={item.orderItemId} initial={false}>
            <motion.div
              key={item.status}
              initial={{ rotateX: -90, opacity: 0 }}
              animate={{ rotateX: 0, opacity: 1 }}
              exit={{ rotateX: 90, opacity: 0 }}
              transition={BOOTH_TRANSITION}
              style={{ transformStyle: "preserve-3d" }}
            >
              {tile}
            </motion.div>
          </AnimatePresence>
        );
        })}
      </div>
    </StateRail>
  );
}
