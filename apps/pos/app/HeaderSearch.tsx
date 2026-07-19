"use client";

import { useActionState, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { SearchIcon } from "@restrobooth/ui";
import { lookupInvoice, type SearchActionState } from "./header-actions";
import styles from "./HeaderSearch.module.css";

const INITIAL: SearchActionState = { error: null };

/**
 * One field, two real destinations — no fuzzy global index, no invented
 * search backend (CLAUDE.md: don't ship UI for data that doesn't exist).
 * A query containing "/" is treated as an invoice number (that's the
 * actual format — "AMD/25-26/000123", DOMAIN.md's invoice series — a
 * table label never contains one) and resolved server-side via
 * getBillByInvoiceNo(), redirecting straight to the printable invoice.
 * Anything else is a table-label search: since a label isn't unique
 * across outlets, this can't redirect to a single page — it hands off to
 * /floor?q=..., which FloorMap reads to filter its own grid in place.
 */
export function HeaderSearch() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [state, formAction, pending] = useActionState(lookupInvoice, INITIAL);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    const trimmed = value.trim();
    if (!trimmed) {
      e.preventDefault();
      return;
    }
    if (!trimmed.includes("/")) {
      e.preventDefault();
      router.push(`/floor?q=${encodeURIComponent(trimmed)}`);
    }
    // else: let the form submit natively — formAction (lookupInvoice) handles it.
  }

  return (
    <form action={formAction} onSubmit={handleSubmit} className={styles.form}>
      <SearchIcon className={styles.icon} />
      <input
        type="text"
        name="invoiceNo"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Table or invoice…"
        className={styles.input}
        aria-label="Search table or invoice"
        disabled={pending}
      />
      {state.error && <span className={styles.error}>{state.error}</span>}
      {pending && <span className={styles.pending}>Searching…</span>}
    </form>
  );
}
