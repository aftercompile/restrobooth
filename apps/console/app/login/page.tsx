"use client";

import { useActionState } from "react";
import { Animate, Button, Input } from "@restrobooth/ui";
import { login, type LoginState } from "./actions";
import styles from "./page.module.css";

const initialState: LoginState = { error: null };

// The signature element, used as an explainer. Someone signing in for the
// first time learns the rail here, before they ever have to read one at
// speed on a live floor.
const LEGEND = [
  { color: "var(--ramp-fresh)", text: "Live and available" },
  { color: "var(--ramp-warming)", text: "Needs attention soon" },
  { color: "var(--ramp-hot)", text: "Late" },
  { color: "var(--ramp-critical)", text: "86'd, voided, critical" },
];

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, initialState);

  return (
    <div className={styles.page}>
      <aside className={styles.brandPane}>
        <div className={styles.mark}>
          <span className={styles.markRail} aria-hidden="true" />
          <span>
            Restro<span className={styles.markDim}>Booth</span>
          </span>
        </div>

        <div>
          <h1 className={styles.pitch}>The restaurant OS that runs at 9 PM.</h1>
          <p className={styles.pitchSub}>
            Billing, kitchen, and floor — built for the shift, not the demo. Every row carries a rail; its colour is its
            state.
          </p>
        </div>

        <ul className={styles.legend}>
          {LEGEND.map((l) => (
            <li key={l.text} className={styles.legendRow}>
              <span className={styles.legendRail} style={{ background: l.color }} aria-hidden="true" />
              {l.text}
            </li>
          ))}
        </ul>
      </aside>

      <main className={styles.formPane}>
        <Animate className={styles.formInner}>
          <h2 className={styles.title}>Sign in</h2>
          <p className={styles.sub}>Console access for owners and staff.</p>

          <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            <Input label="Email" name="email" type="email" autoComplete="username" required autoFocus />
            <Input label="Password" name="password" type="password" autoComplete="current-password" required />

            {state.error && (
              <p role="alert" className={styles.error}>
                {state.error}
              </p>
            )}

            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </Animate>
      </main>
    </div>
  );
}
