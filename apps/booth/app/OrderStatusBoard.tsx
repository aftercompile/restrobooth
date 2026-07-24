"use client";

import { AnimatePresence, BOOTH_TRANSITION, motion, StateRail, useMotionAllowed, type RailState } from "@restrobooth/ui";
import type { GuestKot, GuestOrderItem } from "../lib/order-queries";
import styles from "./OrderStatusBoard.module.css";

/** Real, derived stages — not invented ones. order_items only has
 *  pending/fired/served (no "ready" of its own), but kots.status DOES
 *  (queued/printed/.../preparing/ready/bumped) — a KOT can be fully
 *  cooked (ready/bumped) while its order_items are still "fired" because
 *  no staff member has marked them served/delivered yet. That gap IS a
 *  real, honest third stage ("kitchen's done, food's on its way to your
 *  table"), not a guess — Pass 4 (2026-07-24) surfaces it by reading the
 *  SAME `kots` array apps/booth/app/page.tsx already fetches (used for
 *  estimatedMinutesRemaining) and threading it one level deeper, not by
 *  adding a new query. */
type OrderStage = "cooking" | "ready" | "served";

function deriveStage(items: GuestOrderItem[], kots: GuestKot[]): OrderStage {
  if (items.length > 0 && items.every((i) => i.status === "served")) return "served";
  if (kots.length > 0 && kots.every((k) => k.status === "ready" || k.status === "bumped" || k.status === "voided")) return "ready";
  return "cooking";
}

const STAGES: { key: OrderStage; label: string }[] = [
  { key: "cooking", label: "Cooking" },
  { key: "ready", label: "Ready" },
  { key: "served", label: "Served" },
];

/** order_item.status (fired/served/void_requested — pending items live in
 *  CartSection.tsx instead, not here) to a friendly label + the rail
 *  state that carries it. packages/domain doesn't own this mapping, it's
 *  guest-facing presentation, not a business rule.
 *
 *  `stage` disambiguates "fired": order_items has no "ready" state of its
 *  own (see deriveStage's own comment), so without this every item would
 *  keep reading "Cooking" even after the header above has already said
 *  the kitchen is done — a guest reading both at once would see them as
 *  contradicting each other, not two views of the same order. */
function guestStatus(status: string, stage: OrderStage): { label: string; rail: RailState } {
  switch (status) {
    case "fired":
      return stage === "ready" ? { label: "Ready", rail: "fresh" } : { label: "Cooking", rail: "warming" };
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
 *
 * `estimatedMinutesRemaining` is real, not invented (apps/booth/app/page.tsx's
 * own comment has the derivation — this store's real historical average
 * prep time per kitchen section, minus real elapsed time since the KOT
 * fired) — null whenever nothing's still cooking or there's no history
 * yet to estimate from, in which case the friendly header just omits it
 * rather than guessing.
 */
export function OrderStatusBoard({
  items,
  kots,
  estimatedMinutesRemaining,
}: {
  items: GuestOrderItem[];
  kots: GuestKot[];
  estimatedMinutesRemaining?: number | null;
}) {
  const motionAllowed = useMotionAllowed();

  if (items.length === 0) return null;

  const stage = deriveStage(items, kots);
  const stageIndex = STAGES.findIndex((s) => s.key === stage);

  const headingText =
    stage === "served"
      ? "Enjoy your meal!"
      : stage === "ready"
        ? "Your food is ready — on its way to your table"
        : "Your order is on its way";

  return (
    <>
      <div className={styles.stages} role="progressbar" aria-valuenow={stageIndex + 1} aria-valuemin={1} aria-valuemax={STAGES.length}>
        {STAGES.map((s, i) => (
          <div key={s.key} className={styles.stageStep} data-active={i === stageIndex} data-done={i < stageIndex}>
            <span className={styles.stageDot} />
            <span className={styles.stageLabel}>{s.label}</span>
          </div>
        ))}
      </div>

      <p className={styles.heading}>
        {headingText}
        {stage === "cooking" && estimatedMinutesRemaining != null && (
          <span className={styles.estimate}> — usually ready in about {estimatedMinutesRemaining} min</span>
        )}
      </p>

      <StateRail state="fresh" glow>
        <div className={styles.board}>
          {items.map((item) => {
          const { label, rail } = guestStatus(item.status, stage);
          const tile = (
            <div className={styles.tile}>
              <span>
                <span className={styles.name}>{item.name}</span>
                {item.quantity > 1 && <span className={styles.qty}>×{item.quantity}</span>}
              </span>
              <span className={styles.statusLabel} data-tone={rail}>
                {item.status === "fired" && stage === "cooking" &&
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
    </>
  );
}
