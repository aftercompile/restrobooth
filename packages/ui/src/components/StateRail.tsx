import type { CSSProperties, ReactNode } from "react";
import styles from "./StateRail.module.css";

/**
 * Two families of state, one rail (docs/DESIGN.md):
 *
 *  - The TIME-TEMPERATURE ramp — fresh → warming → hot → critical. Grafted
 *    from Direction C. Use it for anything whose state is elapsed time: a
 *    KDS ticket ageing, a table's dwell, a late order.
 *  - LIFECYCLE states — idle (not live yet) and archived (retired). A menu
 *    item is not "hot" or "cold"; it is draft, live, 86'd, or archived.
 *    Forcing those onto a temperature ramp would be a lie about what the
 *    colour means, and the rail only works because its colour means
 *    exactly one thing.
 *
 * Both families share the rail because the RULE is what's shared: this is
 * the only primitive in the system permitted to encode state with colour.
 * Everything else stays quiet so this stays legible.
 */
export type RailState = "fresh" | "warming" | "hot" | "critical" | "idle" | "archived";

const RAIL_COLOR: Record<RailState, string> = {
  fresh: "var(--ramp-fresh)",
  warming: "var(--ramp-warming)",
  hot: "var(--ramp-hot)",
  critical: "var(--ramp-critical)",
  idle: "var(--text-muted)",
  archived: "var(--border-strong)",
};

/**
 * The signature element: a 4px (POS/KDS) / 6px (Console/Booth) rail on an
 * entity's leading edge whose colour IS its state.
 *
 * Colour is never the only channel: `critical` also gets a diagonal hatch,
 * `archived` a dashed break — both survive greyscale and a glare-lit
 * kitchen screen. Callers are expected to show the state in words or a
 * number alongside (this component deliberately renders no label of its
 * own — composition, not a monolithic "row" component).
 */
export function StateRail({
  state,
  children,
  style,
  label,
  glow,
}: {
  state: RailState;
  children: ReactNode;
  style?: CSSProperties | undefined;
  /** Screen-reader text for the rail's meaning, since colour conveys it visually. */
  label?: string | undefined;
  /** DESIGN.md's Booth-only "glowing card edge on your order" — opt-in, not
   *  a density-wide effect, since most StateRail uses (a menu row, a KDS
   *  ticket) are not the one hero "your order" card the glow is for. A
   *  no-op everywhere except booth density (CSS-scoped, see .module.css). */
  glow?: boolean | undefined;
}) {
  return (
    <div
      className={[styles.rail, glow && styles.glow].filter(Boolean).join(" ")}
      data-rail={state}
      style={{ ["--rail-color" as string]: RAIL_COLOR[state], ...style }}
    >
      {label && <span className={styles.srOnly}>{label}</span>}
      {children}
    </div>
  );
}
