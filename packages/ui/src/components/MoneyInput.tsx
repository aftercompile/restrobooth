"use client";

import { useId, useState, type FocusEvent } from "react";
import styles from "./Input.module.css";
import { formatPaiseAsRupees, parseRupeesToPaise } from "./money";

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
