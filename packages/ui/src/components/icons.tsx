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

export function FloorIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1" />
    </svg>
  );
}

export function MenuBookIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 4.5c2-1 5-1 8 0v15c-3-1-6-1-8 0v-15Z" />
      <path d="M20 4.5c-2-1-5-1-8 0v15c3-1 6-1 8 0v-15Z" />
    </svg>
  );
}

export function CalendarIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3.5" y="4.5" width="17" height="16" rx="2" />
      <path d="M3.5 9.5h17M8 2.5v4M16 2.5v4" />
    </svg>
  );
}

export function SeatIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="6" r="3" />
      <path d="M6 21v-3a6 6 0 0 1 12 0v3" />
    </svg>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M5 8.5 12 15.5 19 8.5" />
    </svg>
  );
}

export function CashIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="2.5" y="6.5" width="19" height="11" rx="1.5" />
      <circle cx="12" cy="12" r="2.75" />
      <path d="M5.5 6.5v11M18.5 6.5v11" />
    </svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M20 20 15.2 15.2" />
    </svg>
  );
}

export function BellIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M6 10a6 6 0 0 1 12 0c0 4 1.5 5.5 2 6.5H4c.5-1 2-2.5 2-6.5Z" />
      <path d="M10 19.5a2.2 2.2 0 0 0 4 0" />
    </svg>
  );
}

export function CardIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="2.5" y="5" width="19" height="14" rx="2" />
      <path d="M2.5 9.5h19" />
      <path d="M6 14.5h4" />
    </svg>
  );
}

/** UPI / mobile-pay — a phone with a rupee mark, not a generic wallet, so
 *  it reads distinctly from CardIcon/WalletIcon at a glance. */
export function SmartphoneIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="6.5" y="2.5" width="11" height="19" rx="2" />
      <path d="M10.5 19h3" />
      <path d="M9.5 8.5h5M9.5 8.5c0 2 1.5 2 2.5 2.7c1 .7 2.5 1 2.5 2.8h-5" />
    </svg>
  );
}

export function BankIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3 9.5 12 4l9 5.5" />
      <path d="M4.5 9.5h15v9.5h-15z" />
      <path d="M4 19h16M8 9.5V19M12 9.5V19M16 9.5V19" />
    </svg>
  );
}

export function WalletIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3 7.5A2 2 0 0 1 5 5.5h13a1.5 1.5 0 0 1 1.5 1.5v1" />
      <rect x="3" y="7.5" width="18" height="12" rx="2" />
      <path d="M15.5 13a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z" />
    </svg>
  );
}

export function CheckCircleIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.5 10.7 15.5 16 9.5" />
    </svg>
  );
}
