import styles from "./RampLegend.module.css";

/**
 * A key for the state rail's colour, shown once near whatever grid of
 * StateRail cards it's explaining (the POS/Captain floor today; nothing
 * stops KDS from using it for the KOT-age ramp later — hence the generic
 * `items` prop rather than a hardcoded table-dwell copy). Purely
 * informational: no data, no interactivity, matching CLAUDE.md's "the rail
 * is the only thing permitted to encode state with colour" — this just
 * labels that channel, it doesn't add a second one.
 */
export interface RampLegendItem {
  label: string;
  /** A rail colour token, e.g. "var(--ramp-fresh)" or "var(--text-muted)"
   *  for the idle/no-rail-colour case — same values StateRail itself uses. */
  color: string;
  /** The precise threshold ("15m+"), shown as a native tooltip rather than
   *  always-visible text — a legend explaining 4-5 states was eating real
   *  width next to the header's action buttons; the short label is what a
   *  glance needs, the exact minute cutoff is a hover away. */
  detail?: string;
}

export function RampLegend({ items }: { items: RampLegendItem[] }) {
  return (
    <ul className={styles.legend}>
      {items.map((item) => (
        <li key={item.label} className={styles.item} title={item.detail ? `${item.label} — ${item.detail}` : item.label}>
          <span className={styles.swatch} style={{ background: item.color }} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}
