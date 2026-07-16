import { notFound } from "next/navigation";
import { PosShell } from "../../../PosShell";
import { queryAsCurrentUser } from "../../../../lib/db";
import { getBillableSession, computeBillPreview, getSessionBills } from "./queries";
import { BillView } from "./BillView";
import styles from "./page.module.css";

export default async function BillPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;

  const data = await queryAsCurrentUser(async (tx) => {
    const session = await getBillableSession(tx, sessionId);
    if (!session) return null;
    const bills = await getSessionBills(tx, sessionId);
    const hasActiveBill = bills.some((b) => b.status !== "voided");
    const preview = hasActiveBill ? null : await computeBillPreview(tx, sessionId);
    return { session, bills, preview };
  });

  if (!data) notFound();

  return (
    <PosShell>
      <div className={styles.header}>
        <h1 className={styles.title}>Bill — {data.session.tableLabels}</h1>
        <p className={styles.sub}>
          {data.session.brandName} · {data.session.legalName} ({data.session.gstin})
        </p>
      </div>
      <BillView
        sessionId={sessionId}
        preview={data.preview ?? { lines: [], computed: { lines: [], subtotalPaise: 0n, billDiscountPaise: 0n, chargesPaise: 0n, taxLines: [], taxTotalPaise: 0n, grossPaise: 0n, roundOffPaise: 0n, payablePaise: 0n } }}
        bills={data.bills}
      />
    </PosShell>
  );
}
