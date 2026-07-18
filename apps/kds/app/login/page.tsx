"use client";

import { useActionState } from "react";
import { Button, Card, Input } from "@restrobooth/ui";
import { login, type LoginState } from "./actions";
import styles from "./page.module.css";

const initialState: LoginState = { error: null };

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, initialState);

  return (
    <div className={styles.page}>
      <Card className={styles.panel}>
        <div>
          <p className={styles.mark}>
            <span className={styles.markRail} aria-hidden="true" />
            Restro<span className={styles.markDim}>Booth</span> KDS
          </p>
          <p className={styles.sub}>Sign in to open the board.</p>
        </div>

        <form action={formAction} className={styles.form}>
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
      </Card>
    </div>
  );
}
