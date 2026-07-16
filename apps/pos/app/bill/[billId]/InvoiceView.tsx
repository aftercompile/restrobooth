import type { InvoiceData } from "../../floor/[sessionId]/bill/queries";
import { PrintButton } from "./PrintButton";
import styles from "./page.module.css";

function formatRupees(paise: string | bigint): string {
  const n = typeof paise === "bigint" ? paise : BigInt(paise);
  const negative = n < 0n;
  const abs = negative ? -n : n;
  return `${negative ? "-" : ""}₹${(abs / 100n).toString()}.${(abs % 100n).toString().padStart(2, "0")}`;
}

function formatDateIST(dateStr: string): string {
  // business_date is a plain "YYYY-MM-DD" — parse as UTC-midnight to avoid
  // the browser's local timezone shifting it to the previous/next day.
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString("en-IN", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" });
}

function formatDateTimeIST(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatAddress(address: unknown): string {
  if (!address || typeof address !== "object") return "";
  const a = address as Record<string, unknown>;
  return [a.line1, a.city].filter((p): p is string => typeof p === "string" && p.length > 0).join(", ");
}

const COMPONENT_LABEL: Record<string, string> = { cgst: "CGST", sgst: "SGST", igst: "IGST", cess: "Cess" };
const METHOD_LABEL: Record<string, string> = {
  cash: "Cash",
  upi_intent: "UPI",
  upi_collect: "UPI",
  card: "Card",
  netbanking: "Netbanking",
  wallet: "Wallet",
  pending_dues: "Pending dues",
};
const REASON_LABEL: Record<string, string> = {
  guest_dispute: "Guest dispute",
  billing_error: "Billing error",
  duplicate_payment: "Duplicate payment",
  goodwill_gesture: "Goodwill gesture",
};

export function InvoiceView({ invoice }: { invoice: InvoiceData }) {
  const isDraft = invoice.status === "draft" || invoice.status === "discarded";

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <PrintButton />
      </div>

      <div className={styles.sheet}>
        <div className={styles.masthead}>
          <div>
            <h1 className={styles.brand}>{invoice.brandName}</h1>
            <p className={styles.legal}>{invoice.legalName}</p>
            {invoice.tradeName && <p className={styles.legal}>Trading as {invoice.tradeName}</p>}
            <p className={styles.legal}>GSTIN {invoice.gstin}</p>
          </div>
          <div className={styles.mastheadRight}>
            <p className={styles.docTitle}>TAX INVOICE</p>
            <p>{invoice.outletName}</p>
            <p>{formatAddress(invoice.outletAddress)}</p>
          </div>
        </div>

        <div className={styles.metaRow}>
          <div>
            <p>
              <strong>Invoice No.</strong> {invoice.invoiceNo ?? "— (not yet finalised)"}
            </p>
            <p>
              <strong>Date</strong> {formatDateIST(invoice.businessDate)}
            </p>
          </div>
          <div>
            <p>
              <strong>Table</strong> {invoice.tableLabels}
            </p>
            <p>
              <strong>Status</strong> {invoice.status}
            </p>
          </div>
        </div>

        <table className={styles.linesTable}>
          <thead>
            <tr>
              <th className={styles.colName}>Item</th>
              <th className={styles.colNum}>Qty</th>
              <th className={styles.colNum}>Rate</th>
              <th className={styles.colNum}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((l, i) => (
              <tr key={i}>
                <td>{l.name}</td>
                <td className={styles.colNum}>{l.quantity}</td>
                <td className={styles.colNum}>{formatRupees(l.unitPricePaise)}</td>
                <td className={styles.colNum}>{formatRupees(BigInt(l.unitPricePaise) * BigInt(l.quantity))}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className={styles.totals}>
          <div className={styles.totalsRow}>
            <span>Subtotal</span>
            <span>{formatRupees(invoice.subtotalPaise)}</span>
          </div>
          {BigInt(invoice.discountPaise) > 0n && (
            <div className={styles.totalsRow}>
              <span>Discount</span>
              <span>-{formatRupees(invoice.discountPaise)}</span>
            </div>
          )}
          {BigInt(invoice.chargesPaise) > 0n && (
            <div className={styles.totalsRow}>
              <span>Service charge</span>
              <span>{formatRupees(invoice.chargesPaise)}</span>
            </div>
          )}
          {invoice.taxLines.map((t, i) => (
            <div className={styles.totalsRow} key={i}>
              <span>
                {COMPONENT_LABEL[t.component] ?? t.component} @ {(t.rateBps / 100).toFixed(2)}%
              </span>
              <span>{formatRupees(t.amountPaise)}</span>
            </div>
          ))}
          {BigInt(invoice.roundOffPaise) !== 0n && (
            <div className={styles.totalsRow}>
              <span>Round off</span>
              <span>{formatRupees(invoice.roundOffPaise)}</span>
            </div>
          )}
          <div className={`${styles.totalsRow} ${styles.grand}`}>
            <span>Payable</span>
            <span>{formatRupees(invoice.payablePaise)}</span>
          </div>
        </div>

        {invoice.payments.length > 0 && (
          <div className={styles.payments}>
            <p className={styles.sectionLabel}>Payments</p>
            {invoice.payments.map((p, i) => (
              <div className={styles.totalsRow} key={i}>
                <span>
                  {METHOD_LABEL[p.method] ?? p.method} · {formatDateTimeIST(p.createdAt)}
                </span>
                <span>{formatRupees(p.amountPaise)}</span>
              </div>
            ))}
          </div>
        )}

        {invoice.creditNotes.length > 0 && (
          <div className={styles.payments}>
            <p className={styles.sectionLabel}>Credit notes</p>
            {invoice.creditNotes.map((c, i) => (
              <div className={styles.totalsRow} key={i}>
                <span>
                  {c.creditNoteNo} · {REASON_LABEL[c.reasonCode] ?? c.reasonCode} · {formatDateTimeIST(c.issuedAt)}
                </span>
                <span>-{formatRupees(c.amountPaise)}</span>
              </div>
            ))}
          </div>
        )}

        {isDraft && <p className={styles.draftNotice}>Not a valid tax invoice — draft, no invoice number assigned.</p>}

        <p className={styles.footer}>This is a computer-generated invoice.</p>
      </div>
    </div>
  );
}
