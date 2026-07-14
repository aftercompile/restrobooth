import type { ReactNode } from "react";
import styles from "./Badge.module.css";

export type BadgeTone = "neutral" | "live" | "warning" | "critical";

/**
 * A label, not a state channel — StateRail is the ONLY primitive that
 * encodes entity state via colour (docs/DESIGN.md). Badge tones exist for
 * static categorisation (a channel name, a diet mark) where there is no
 * "this needs attention" meaning riding on the colour.
 */
export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={[styles.badge, styles[tone]].join(" ")}>{children}</span>;
}
