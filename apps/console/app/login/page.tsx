"use client";

import { useActionState } from "react";
import { Button, Card, Input } from "@restrobooth/ui";
import { login, type LoginState } from "./actions";

const initialState: LoginState = { error: null };

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, initialState);

  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "var(--space-3)",
      }}
    >
      <Card style={{ width: "100%", maxWidth: 360 }}>
        <h1 style={{ fontFamily: "var(--font-display)", marginBottom: "var(--space-2)" }}>RestroBooth Console</h1>
        <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <Input label="Email" name="email" type="email" autoComplete="username" required />
          <Input label="Password" name="password" type="password" autoComplete="current-password" required />
          {state.error && (
            <p role="alert" style={{ color: "var(--signal-600)", fontSize: "var(--text-sm)" }}>
              {state.error}
            </p>
          )}
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </Card>
    </main>
  );
}
