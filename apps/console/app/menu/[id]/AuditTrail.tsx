import { Card, DataRow } from "@restrobooth/ui";

// Pinned to Asia/Kolkata explicitly, not the runtime's default locale — a
// server deployed outside India would otherwise render this audit trail
// in a different timezone/format than the restaurant actually operates
// in. (This is a Server Component with no client re-render, so it's not a
// hydration-mismatch risk the way the same unpinned call was in
// apps/pos/app/day/DayList.tsx — just a quieter, still-real i18n bug.)
function formatTimestampIST(date: Date): string {
  return date.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
}

type AuditRow = {
  id: string;
  action: string;
  fromStatus: string | null;
  toStatus: string | null;
  actorUserId: string;
  createdAt: Date;
};

export function AuditTrail({ rows }: { rows: AuditRow[] }) {
  if (rows.length === 0) {
    return <p style={{ fontSize: "var(--text-sm)", opacity: 0.6 }}>No history yet.</p>;
  }
  return (
    <Card>
      {[...rows].reverse().map((row) => (
        <DataRow
          key={row.id}
          label={`${row.action}${row.toStatus ? ` → ${row.toStatus}` : ""}`}
          trailing={
            <span style={{ fontSize: "var(--text-sm)", opacity: 0.7 }}>
              {formatTimestampIST(new Date(row.createdAt))} · {row.actorUserId.slice(0, 8)}
            </span>
          }
        />
      ))}
    </Card>
  );
}
