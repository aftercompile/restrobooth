import type { ReactNode } from "react";
import styles from "./Chip.module.css";

/**
 * A pill toggle — selection, not status (Badge is the static-label
 * primitive, StateRail is the only colour-as-state channel; a Chip is
 * neither, it's an input). Brass is a FILL on selection, never text
 * colour (scripts/lint-brass.mjs) — selected state pairs brass with
 * `--ink`-level text for contrast, same discipline as Button's primary
 * variant.
 */
export function Chip({
  selected = false,
  onToggle,
  children,
  disabled = false,
}: {
  selected?: boolean;
  onToggle?: () => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={styles.chip}
      data-selected={selected}
      disabled={disabled}
      aria-pressed={selected}
      onClick={onToggle}
    >
      {children}
    </button>
  );
}
