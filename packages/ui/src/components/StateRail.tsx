import type { CSSProperties, ReactNode } from "react";
import styles from "./StateRail.module.css";

export type RailState = "fresh" | "warming" | "hot" | "critical";

const RAIL_COLOR: Record<RailState, string> = {
  fresh: "var(--ramp-fresh)",
  warming: "var(--ramp-warming)",
  hot: "var(--ramp-hot)",
  critical: "var(--ramp-critical)",
};

/**
 * The signature element (docs/DESIGN.md): a 4-6px rail on an entity's
 * leading edge whose colour and fill level IS its state — a table, a
 * ticket, a bill row, an outlet in a report. This is the ONLY primitive
 * allowed to encode state with colour; everything else in the system
 * stays quiet so this stays legible.
 *
 * Colour is never the only channel: pass `state="critical"` and the rail
 * also gets a diagonal hatch, and callers are expected to show the
 * numeric age alongside it (this component doesn't render that text
 * itself — composition, not a monolithic "ticket" component).
 */
export function StateRail({
  state,
  children,
  style,
}: {
  state: RailState;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      className={styles.rail}
      data-critical={state === "critical"}
      style={{ ["--rail-color" as string]: RAIL_COLOR[state], ...style }}
    >
      {children}
    </div>
  );
}
