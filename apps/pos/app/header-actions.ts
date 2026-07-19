"use server";

import { redirect } from "next/navigation";
import { queryAsCurrentUser } from "../lib/db";
import { getBillByInvoiceNo } from "./header-queries";

export type SearchActionState = { error: string | null };

export async function lookupInvoice(_prev: SearchActionState, formData: FormData): Promise<SearchActionState> {
  const invoiceNo = String(formData.get("invoiceNo") ?? "").trim();
  if (!invoiceNo) return { error: "Enter an invoice number" };

  const result = await queryAsCurrentUser((tx) => getBillByInvoiceNo(tx, invoiceNo));
  if (!result) return { error: `No invoice "${invoiceNo}" found` };

  redirect(`/bill/${result.billId}`);
}
