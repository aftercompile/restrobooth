import type { HTMLAttributes, ReactNode } from "react";
import styles from "./Card.module.css";

/**
 * `padded` defaults to true for standalone content. Set it FALSE when the
 * card wraps a list of DataRows: the rows bring their own padding, and a
 * padded card would inset them away from its leading edge — which is
 * exactly where the state rail has to sit to read as an edge.
 */
export function Card({
  className,
  padded = true,
  ...props
}: HTMLAttributes<HTMLDivElement> & { padded?: boolean }) {
  return (
    <div
      className={[styles.card, padded ? styles.padded : null, className].filter(Boolean).join(" ")}
      {...props}
    />
  );
}

/** The header strip of a card — a category name and its item count. */
export function CardHeader({ title, count }: { title: ReactNode; count?: ReactNode }) {
  return (
    <div className={styles.cardHead}>
      <h2 className={styles.cardTitle}>{title}</h2>
      {count !== undefined && <span className={styles.cardCount}>{count}</span>}
    </div>
  );
}
