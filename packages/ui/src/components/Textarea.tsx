"use client";

import { useId, type TextareaHTMLAttributes } from "react";
import inputStyles from "./Input.module.css";
import styles from "./Textarea.module.css";

export function Textarea({
  label,
  error,
  id,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; error?: string }) {
  const generatedId = useId();
  const textareaId = id ?? generatedId;
  return (
    <div className={inputStyles.field}>
      <label className={inputStyles.label} htmlFor={textareaId}>
        {label}
      </label>
      <textarea
        id={textareaId}
        className={styles.textarea}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${textareaId}-error` : undefined}
        {...props}
      />
      {error && (
        <span id={`${textareaId}-error`} className={inputStyles.error}>
          {error}
        </span>
      )}
    </div>
  );
}
