import type { ReactNode } from "react";
import { StateRail, type RailState } from "./StateRail";
import styles from "./DataRow.module.css";

/**
 * A single line item — a bill line, a KOT ticket, a menu item, a report
 * row. Composes StateRail whenever it has state to show, exactly as
 * docs/DESIGN.md expects ("everything showing state composes it") rather
 * than inventing its own colour treatment.
 *
 * `href` makes the row a link. It stays a real <a> (not a div with an
 * onClick) so middle-click, keyboard focus, and "open in new tab" all
 * work — and the focus ring is never removed.
 */
export function DataRow({
  label,
  trailing,
  railState,
  railLabel,
  href,
  muted,
}: {
  label: ReactNode;
  trailing?: ReactNode;
  railState?: RailState;
  /** Screen-reader text for the rail's colour, e.g. "86'd — unavailable". */
  railLabel?: string;
  href?: string;
  muted?: boolean;
}) {
  const row = (
    <div className={[styles.row, muted ? styles.muted : null].filter(Boolean).join(" ")}>
      <span className={styles.label}>{label}</span>
      {trailing !== undefined && <span className={styles.trailing}>{trailing}</span>}
    </div>
  );

  const withRail = railState ? (
    <StateRail state={railState} label={railLabel}>
      {row}
    </StateRail>
  ) : (
    row
  );

  if (href) {
    return (
      <a href={href} className={styles.interactive}>
        {withRail}
      </a>
    );
  }
  return withRail;
}
