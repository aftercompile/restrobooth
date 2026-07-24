import styles from "./Skeleton.module.css";

/**
 * A loading placeholder — CSS-only shimmer (`prefers-reduced-motion`
 * collapses it to a static tone, same discipline as every other motion
 * primitive here, no JS gate needed since this never imports framer-motion).
 */
export function Skeleton({ width, height = "1em", className }: { width?: string; height?: string; className?: string }) {
  return (
    <span
      className={[styles.skeleton, className].filter(Boolean).join(" ")}
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}
