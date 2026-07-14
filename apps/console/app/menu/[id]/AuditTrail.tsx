import { Card, DataRow } from "@restrobooth/ui";

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
              {new Date(row.createdAt).toLocaleString()} · {row.actorUserId.slice(0, 8)}
            </span>
          }
        />
      ))}
    </Card>
  );
}
