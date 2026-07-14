"use client";

import type { CSSProperties, ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useDensity } from "./DensityProvider";

/**
 * ============================================================================
 * The motion guard. Read this before adding any animation anywhere.
 * ============================================================================
 *
 * docs/DESIGN.md is unambiguous: **POS and KDS have ZERO animation.**
 * "`transition: none` on the entire subtree. A 200 ms transition on a
 * billing screen is a bug. Speed is the aesthetic there."
 *
 * tokens/motion.css already enforces that for CSS — but Framer Motion
 * animates by writing inline styles from JavaScript (rAF/WAAPI), which
 * sails straight through `transition: none !important` and
 * `animation: none !important`. A CSS kill-switch cannot stop it. So the
 * guard has to be structural, and it is:
 *
 *   `useMotionAllowed()` returns false on POS/KDS (and whenever the user
 *   has prefers-reduced-motion set), and `<Animate>` then renders a PLAIN
 *   <div> with no motion component in the tree at all — not a motion
 *   component configured to animate quickly. There is no duration to get
 *   accidentally raised later, and no MotionConfig a caller could override.
 *
 * Framer's own `MotionConfig reducedMotion="always"` is NOT sufficient
 * here: it disables transform/layout animation but deliberately still
 * permits opacity and colour animation. "Reduced" is not "none", and on a
 * billing screen the requirement really is none.
 *
 * scripts/lint-motion.mjs fails the build if `framer-motion` is imported
 * directly anywhere in apps/pos or apps/kds, so this can't be quietly
 * bypassed by reaching around <Animate>.
 */
export function useMotionAllowed(): boolean {
  const density = useDensity();
  const prefersReduced = useReducedMotion();
  if (density === "pos" || density === "kds") return false;
  return !prefersReduced;
}

// docs/DESIGN.md's Console motion budget: "Restrained. 150 ms, ease-out,
// opacity/transform only." Booth is allowed to be richer. These are the
// only two transitions in the system — one rhythm everywhere
// (motion-consistency), rather than a bespoke curve per component.
export const CONSOLE_TRANSITION = { duration: 0.15, ease: [0, 0, 0.2, 1] } as const; // ease-out
export const BOOTH_TRANSITION = { type: "spring", stiffness: 300, damping: 30 } as const;

/** Enter: fade + a short rise. Transform/opacity ONLY — never width/height/top/left. */
export const ENTER = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0 },
} as const;

/**
 * Entrance animation for a block or a list item. Degrades to a plain <div>
 * wherever motion is banned — see the header above for why that has to be
 * structural rather than a config flag.
 *
 * `delayIndex` staggers list entrances at 35 ms/item (the 30-50 ms the UX
 * guidance recommends), capped at 8 so a 100-item menu doesn't take three
 * seconds to finish appearing.
 *
 * The prop surface is deliberately narrow: this is an *entrance*, not a
 * general-purpose motion escape hatch. Anything richer should import
 * `motion` directly and gate it on `useMotionAllowed()` explicitly.
 */
export function Animate({
  children,
  delayIndex = 0,
  className,
  style,
}: {
  children: ReactNode;
  delayIndex?: number;
  className?: string | undefined;
  style?: CSSProperties | undefined;
}) {
  const allowed = useMotionAllowed();
  const density = useDensity();

  if (!allowed) {
    return (
      <div className={className} style={style}>
        {children}
      </div>
    );
  }

  const base = density === "booth" ? BOOTH_TRANSITION : CONSOLE_TRANSITION;

  // Spread conditionally rather than passing an explicit `undefined`:
  // framer-motion declares these as `style?: MotionStyle` (no `| undefined`),
  // and this repo runs exactOptionalPropertyTypes, which distinguishes
  // "absent" from "present but undefined". The cast is for MotionStyle's
  // transform shorthands (x/y/scale), which it types more narrowly than
  // CSSProperties does — a plain CSSProperties is always valid at runtime.
  const optional = {
    ...(className !== undefined ? { className } : {}),
    ...(style !== undefined ? { style } : {}),
  } as Pick<React.ComponentProps<typeof motion.div>, "className" | "style">;

  return (
    <motion.div
      {...optional}
      initial="hidden"
      animate="visible"
      variants={ENTER}
      transition={{ ...base, delay: Math.min(delayIndex, 8) * 0.035 }}
    >
      {children}
    </motion.div>
  );
}

export { motion, AnimatePresence } from "framer-motion";
