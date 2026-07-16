import { notFound } from "next/navigation";
import { queryAsCurrentUser } from "../../../lib/db";
import { getInvoiceData } from "../../floor/[sessionId]/bill/queries";
import { InvoiceView } from "./InvoiceView";

export default async function InvoicePage({ params }: { params: Promise<{ billId: string }> }) {
  const { billId } = await params;
  const invoice = await queryAsCurrentUser((tx) => getInvoiceData(tx, billId));
  if (!invoice) notFound();

  return <InvoiceView invoice={invoice} />;
}
