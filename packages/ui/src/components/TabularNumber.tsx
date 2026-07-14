import type { ReactNode } from "react";
import styles from "./TabularNumber.module.css";

/**
 * Wraps any price, quantity, timer, or total. `font-variant-numeric:
 * tabular-nums` is non-negotiable across the whole system (docs/DESIGN.md
 * quality floor) — a total that shifts a pixel as it counts looks wrong.
 * A dedicated component, not just a utility class, so it shows up once in
 * every screen's component tree — that's what makes "did we forget this
 * somewhere" reviewable at a glance.
 */
export function TabularNumber({ children }: { children: ReactNode }) {
  return <span className={styles.num}>{children}</span>;
}
