"use client";

import { useEffect, useState } from "react";
import { Badge } from "@restrobooth/ui";
import styles from "./page.module.css";

// Three separate Next.js apps, three separate deployments — this page
// hands off with a plain cross-origin link, not a route. Each target
// still gates on its own login; this page has no auth of its own to add.
const TERMINALS = [
  {
    key: "pos",
    label: "POS",
    tagline: "Speed. Keyboard-first. Zero latency.",
    url: process.env.NEXT_PUBLIC_POS_URL ?? "http://localhost:3001",
  },
  {
    key: "kds",
    label: "KDS",
    tagline: "Readable at 2 metres. Ticket aging. One gesture: bump.",
    url: process.env.NEXT_PUBLIC_KDS_URL ?? "http://localhost:3002",
  },
  {
    key: "captain",
    label: "Captain",
    tagline: "Take order at table, fire KOT, call for bill.",
    url: process.env.NEXT_PUBLIC_CAPTAIN_URL ?? "http://localhost:3003",
  },
] as const;

// No real SSO yet (deferred — each of the 5 apps deploys to its own
// domain today, and real cross-app session sharing needs a shared root
// domain nobody's committed to). This is the cheap substitute agreed on
// instead: Hub remembers which tile you land on, same-origin only (its
// own localStorage — cross-origin storage isn't available without the
// domain decision SSO itself is waiting on), so a "Last used" hint is
// there next time without needing a real shared session.
const LAST_APP_KEY = "rb.hub.lastApp";

export default function HubPage() {
  const [lastApp, setLastApp] = useState<string | null>(null);

  useEffect(() => {
    setLastApp(localStorage.getItem(LAST_APP_KEY));
  }, []);

  return (
    <main className={styles.page}>
      <div className={styles.mark}>
        <span className={styles.markRail} aria-hidden="true" />
        RestroBooth
      </div>
      <h1 className={styles.title}>Pick a terminal</h1>
      <p className={styles.sub}>You&apos;ll sign in once you land on it.</p>

      <div className={styles.grid}>
        {TERMINALS.map((t) => (
          <a
            key={t.key}
            href={t.url}
            className={styles.tile}
            onClick={() => localStorage.setItem(LAST_APP_KEY, t.key)}
          >
            <span className={styles.tileTop}>
              <span className={styles.tileLabel}>{t.label}</span>
              {lastApp === t.key && <Badge tone="neutral">Last used</Badge>}
            </span>
            <span className={styles.tileTagline}>{t.tagline}</span>
            <span className={styles.tileArrow} aria-hidden="true">
              →
            </span>
          </a>
        ))}
      </div>
    </main>
  );
}
