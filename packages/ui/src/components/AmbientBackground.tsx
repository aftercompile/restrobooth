"use client";

import type { CSSProperties } from "react";
import { useMotionAllowed } from "../motion";
import styles from "./AmbientBackground.module.css";

/**
 * The secondary signature, alongside the state rail (docs/DESIGN.md): a
 * handful of low-opacity kitchen doodles fixed behind all content. CSS-only
 * (no framer-motion import here — lint-motion.mjs stays valid), mounted
 * once per app OUTSIDE the [data-density] wrapper so it never counts as
 * "working content."
 *
 * Deliberately takes no dependency on next/navigation — packages/ui has no
 * `next` dependency at all (ADR-0001: nothing framework-specific in a UI
 * component, same reason there's no Supabase/Vercel API here), so route
 * awareness is the CALLER's job. Pass `mode`: apps whose density is
 * POS/KDS pass "static" unconditionally (their own login screens are work
 * surfaces too, not marketing moments — see DECISIONS.md); Console passes
 * "animate" only from a tiny client wrapper that reads `usePathname()`
 * itself and forwards the result.
 *
 * Either way, `useMotionAllowed()` is the final, non-bypassable gate: false
 * on POS/KDS density unconditionally and false everywhere under
 * prefers-reduced-motion, regardless of what `mode` a caller passes.
 */
const DOODLES = [
  { id: "whisk", top: "8%", left: "6%", size: 72, dx: 10, dy: -14, dr: 8, dur: 26 },
  { id: "chilli", top: "72%", left: "10%", size: 64, dx: -12, dy: 10, dr: -6, dur: 32 },
  { id: "mint", top: "20%", left: "88%", size: 56, dx: -8, dy: 12, dr: 10, dur: 24 },
  { id: "steam", top: "60%", left: "82%", size: 60, dx: 6, dy: -16, dr: 0, dur: 20 },
  { id: "forkKnife", top: "85%", left: "48%", size: 68, dx: 8, dy: 8, dr: -4, dur: 34 },
  { id: "cup", top: "12%", left: "45%", size: 60, dx: -10, dy: -8, dr: 6, dur: 28 },
  { id: "sparkle", top: "40%", left: "4%", size: 32, dx: 6, dy: 6, dr: 20, dur: 18 },
] as const;

function DoodleShape({ id }: { id: (typeof DOODLES)[number]["id"] }) {
  switch (id) {
    case "whisk":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
          <path d="M12 2c-3.5 0-5.5 3-5.5 7 0 3.3 2.5 5 5.5 5s5.5-1.7 5.5-5c0-4-2-7-5.5-7Z" />
          <path d="M12 14v8" />
        </svg>
      );
    case "chilli":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
          <path d="M5 4c1.4-1.3 2.6-1.6 3.4-1.2" />
          <path d="M4.5 6c-1 2-1.2 6.5.7 10.5C7.4 20.5 11 21.5 14 19c3-2.5 3.5-7 1.8-10.7C14 4.7 9.8 3 4.5 6Z" />
        </svg>
      );
    case "mint":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
          <path d="M12 3c-6 2-8 8-4 14 4 6 8 6 12 0 4-6 2-12-4-14 0 5-2 9 0 14" />
        </svg>
      );
    case "steam":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
          <path d="M5 21c2-3-2-5 0-9 2-3-2-5 0-9" />
          <path d="M12 21c2-3-2-5 0-9 2-3-2-5 0-9" />
          <path d="M19 21c2-3-2-5 0-9 2-3-2-5 0-9" />
        </svg>
      );
    case "forkKnife":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
          <path d="M6 2v7M4 2v5c0 1 1 2 2 2s2-1 2-2V2M6 11v11" />
          <path d="M17 2c-2 0-3 2-3 5s1 4 3 4v11" />
        </svg>
      );
    case "cup":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
          <path d="M5 9h11v6c0 3-2.5 5-5.5 5S5 18 5 15V9Z" />
          <path d="M16 10c2 0 3.5 1.3 3.5 3s-1.5 3-3.5 3" />
          <path d="M8 6c0-1 1-1 1-2s-1-1-1-2M12 6c0-1 1-1 1-2s-1-1-1-2" />
        </svg>
      );
    case "sparkle":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
          <path d="M12 2l1.8 7.2L21 11l-7.2 1.8L12 20l-1.8-7.2L3 11l7.2-1.8L12 2Z" />
        </svg>
      );
  }
}

export function AmbientBackground({ mode = "static" }: { mode?: "animate" | "static" }) {
  const motionAllowed = useMotionAllowed();
  const animated = motionAllowed && mode === "animate";

  return (
    <div className={styles.layer} data-motion={animated ? "animate" : "static"} aria-hidden="true">
      {DOODLES.map((d) => (
        <div
          key={d.id}
          className={styles.doodle}
          style={
            {
              top: d.top,
              left: d.left,
              width: d.size,
              height: d.size,
              "--dx": `${d.dx}px`,
              "--dy": `${d.dy}px`,
              "--dr": `${d.dr}deg`,
              "--dur": `${d.dur}s`,
            } as CSSProperties
          }
        >
          <DoodleShape id={d.id} />
        </div>
      ))}
    </div>
  );
}
