import type { ReactNode } from "react";
import { StateRail, type RailState } from "./StateRail";
import styles from "./DataRow.module.css";

/**
 * A single line item — a bill line, a KOT ticket line, a report row.
 * Composes StateRail when `railState` is given, exactly as docs/DESIGN.md
 * expects ("everything showing state composes it") rather than
 * reimplementing its own colour treatment.
 */
export function DataRow({
  label,
  trailing,
  railState,
}: {
  label: ReactNode;
  trailing?: ReactNode;
  railState?: RailState;
}) {
  const row = (
    <div className={styles.row}>
      <span className={styles.label}>{label}</span>
      {trailing !== undefined && <span className={styles.trailing}>{trailing}</span>}
    </div>
  );
  return railState ? <StateRail state={railState}>{row}</StateRail> : row;
}
