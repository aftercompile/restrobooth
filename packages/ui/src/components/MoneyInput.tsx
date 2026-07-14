"use client";

import { useId, useState, type FocusEvent } from "react";
import styles from "./Input.module.css";

/**
 * Rupees in, paise out — bigint, never a float (CLAUDE.md's standing money
 * rule). Returns null for anything that isn't a clean up-to-2-decimal
 * amount. Deliberately REJECTS a third decimal place ("180.505") rather
 * than rounding it: this is direct price entry, not a derived value like
 * tax (the domain-wide half-up rounding rule is for values *computed*
 * from other values — a human typing a price gets exactly what they typed
 * or a validation error, never a silently adjusted number).
 */
export function parseRupeesToPaise(input: string): bigint | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(trimmed);
  if (!match) return null;
  const rupees = BigInt(match[1]!);
  const paiseFraction = (match[2] ?? "").padEnd(2, "0");
  return rupees * 100n + BigInt(paiseFraction);
}

export function formatPaiseAsRupees(paise: bigint): string {
  const negative = paise < 0n;
  const abs = negative ? -paise : paise;
  const rupees = abs / 100n;
  const cents = abs % 100n;
  return `${negative ? "-" : ""}${rupees}.${cents.toString().padStart(2, "0")}`;
}

export function MoneyInput({
  label,
  valuePaise,
  onChangePaise,
  disabled,
}: {
  label: string;
  valuePaise: bigint | null;
  onChangePaise: (paise: bigint | null, raw: string) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const [raw, setRaw] = useState(valuePaise !== null ? formatPaiseAsRupees(valuePaise) : "");
  const [touched, setTouched] = useState(false);

  const parsed = parseRupeesToPaise(raw);
  const invalid = touched && raw.trim() !== "" && parsed === null;

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <div style={{ position: "relative" }}>
        <span
          aria-hidden="true"
          style={{ position: "absolute", left: "var(--space-2)", top: "50%", transform: "translateY(-50%)" }}
        >
          ₹
        </span>
        <input
          id={id}
          className={styles.input}
          style={{ paddingLeft: "calc(var(--space-2) + 14px)" }}
          inputMode="decimal"
          placeholder="0.00"
          value={raw}
          disabled={disabled}
          aria-invalid={invalid}
          aria-describedby={invalid ? `${id}-error` : undefined}
          onChange={(e) => {
            setRaw(e.target.value);
            onChangePaise(parseRupeesToPaise(e.target.value), e.target.value);
          }}
          onBlur={(_e: FocusEvent<HTMLInputElement>) => setTouched(true)}
        />
      </div>
      {invalid && (
        <span id={`${id}-error`} className={styles.error}>
          Enter an amount with at most 2 decimal places, e.g. 180 or 180.50.
        </span>
      )}
    </div>
  );
}
