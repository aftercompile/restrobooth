"use client";

import { useActionState, useState } from "react";
import { Badge, Button, Card, Input } from "@restrobooth/ui";
import { closeDay, openDay, type ActionState } from "./actions";
import type { DayStatus } from "./queries";
import styles from "./page.module.css";

const INITIAL: ActionState = { error: null };

function formatRupees(paise: string | null): string {
  if (paise === null) return "—";
  const n = BigInt(paise);
  const negative = n < 0n;
  const abs = negative ? -n : n;
  return `${negative ? "-" : ""}₹${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
}

/**
 * `Date.toLocaleTimeString()` with no explicit locale/options resolves the
 * RUNTIME's default locale — which differs between the server (Node's ICU
 * default, often 24-hour) and the browser (the visitor's own locale,
 * often 12-hour) — so the exact same timestamp renders two different
 * strings and React discards the server HTML as a hydration mismatch. IST
 * is pinned explicitly (business_date is always Asia/Kolkata in this
 * project) so the string is identical everywhere, not just consistent
 * between server and client by accident.
 */
function formatTimeIST(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false });
}

export function DayList({ days }: { days: DayStatus[] }) {
  return (
    <div className={styles.grid}>
      {days.map((day) => (
        <DayCard key={day.outletId} day={day} />
      ))}
    </div>
  );
}

function DayCard({ day }: { day: DayStatus }) {
  const [expanded, setExpanded] = useState(false);
  const isOpen = day.status === "open";

  return (
    <Card interactive className={styles.dayCard}>
      <div className={styles.dayCardHead}>
        <span className={styles.outletName}>{day.outletName}</span>
        <Badge tone={isOpen ? "live" : "neutral"}>{isOpen ? "open" : "no open day"}</Badge>
      </div>

      {isOpen ? (
        <div className={styles.dayMetrics}>
          <div className={styles.metric}>
            <span className={styles.metricValue}>{formatRupees(day.openingFloatPaise)}</span>
            <span className={styles.metricLabel}>Opening float</span>
          </div>
          <div className={styles.metric}>
            <span className={styles.metricValue}>{day.openedAt ? formatTimeIST(day.openedAt) : "—"}</span>
            <span className={styles.metricLabel}>Opened at</span>
          </div>
          <div className={styles.metric}>
            <span className={styles.metricValue}>{day.businessDate ?? "—"}</span>
            <span className={styles.metricLabel}>Business date</span>
          </div>
        </div>
      ) : (
        <p className={styles.dayEmptyNote}>Nothing can be billed here until a day is opened.</p>
      )}

      <div className={styles.dayCardFoot}>
        {expanded ? (
          isOpen ? (
            <CloseDayForm day={day} onDone={() => setExpanded(false)} />
          ) : (
            <OpenDayForm outletId={day.outletId} onDone={() => setExpanded(false)} />
          )
        ) : isOpen ? (
          <Button type="button" variant="secondary" onClick={() => setExpanded(true)}>
            Close day
          </Button>
        ) : (
          <Button type="button" variant="primary" onClick={() => setExpanded(true)}>
            Open day
          </Button>
        )}
      </div>
    </Card>
  );
}

function OpenDayForm({ outletId, onDone }: { outletId: string; onDone: () => void }) {
  // Success is signalled by revalidatePath replacing this card entirely
  // (status flips to "open") — no local success state to track here.
  const [state, formAction, pending] = useActionState(openDay, INITIAL);
  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="outletId" value={outletId} />
      <Input label="Opening float (₹)" name="openingFloat" type="number" step="0.01" min={0} defaultValue="0" className={styles.narrowInput} />
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? "Opening…" : "Confirm"}
      </Button>
      <Button type="button" variant="secondary" onClick={onDone}>
        Cancel
      </Button>
      {state.error && <span className={styles.checklistError}>{state.error}</span>}
    </form>
  );
}

function CloseDayForm({ day, onDone }: { day: DayStatus; onDone: () => void }) {
  const [state, formAction, pending] = useActionState(closeDay, INITIAL);
  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="businessDayId" value={day.businessDayId ?? ""} />
      <input type="hidden" name="outletId" value={day.outletId} />
      <input type="hidden" name="terminalId" value={day.terminalId ?? ""} />
      <input type="hidden" name="drawerId" value={day.drawerId ?? ""} />
      <Input label="Counted cash (₹)" name="countedCash" type="number" step="0.01" min={0} className={styles.narrowInput} required />
      <Input label="Variance note (if any)" name="varianceNote" className={styles.narrowInput} />
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? "Closing…" : "Confirm close"}
      </Button>
      <Button type="button" variant="secondary" onClick={onDone}>
        Cancel
      </Button>
      {state.error && <span className={styles.checklistError}>{state.error}</span>}
    </form>
  );
}
