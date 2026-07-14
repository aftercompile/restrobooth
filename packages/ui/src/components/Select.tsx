"use client";

import { useId, type ReactNode, type SelectHTMLAttributes } from "react";
import styles from "./Input.module.css";

export function Select({
  label,
  error,
  id,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; error?: string; children: ReactNode }) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={selectId}>
        {label}
      </label>
      <select
        id={selectId}
        className={styles.input}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${selectId}-error` : undefined}
        {...props}
      >
        {children}
      </select>
      {error && (
        <span id={`${selectId}-error`} className={styles.error}>
          {error}
        </span>
      )}
    </div>
  );
}
