/**
 * A handful of hand-authored line icons, not a library import (DESIGN.md's
 * quality floor calls for "one family, consistent stroke" — Phosphor was
 * the reference, but nothing in this repo has ever needed an icon before
 * now, and pulling in a package for two glyphs is the wrong trade per
 * CLAUDE.md's "ask before adding a heavy dependency" rule). Same visual
 * language as these: 1.5px stroke, rounded caps/joins, 24×24 viewBox,
 * `currentColor` so callers set colour via CSS `color`.
 */
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export function RefreshIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M20 11a8 8 0 0 0-14.6-4.4M4 4v4.5h4.5" />
      <path d="M4 13a8 8 0 0 0 14.6 4.4M20 20v-4.5h-4.5" />
    </svg>
  );
}

export function ReceiptIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M6 2.5h12v19l-2.5-1.5L13 21l-1-1.5-1 1.5-2.5-1.5L6 21.5v-19Z" />
      <path d="M8.5 8h7M8.5 11.5h7M8.5 15h4.5" />
    </svg>
  );
}
