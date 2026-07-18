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

export default function HubPage() {
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
          <a key={t.key} href={t.url} className={styles.tile}>
            <span className={styles.tileLabel}>{t.label}</span>
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
