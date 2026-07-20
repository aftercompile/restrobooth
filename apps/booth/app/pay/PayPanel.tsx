"use client";

import { useEffect, useState } from "react";
import { Button, Card, CardHeader, formatPaiseAsRupees, TabularNumber, useToast } from "@restrobooth/ui";
import { finalizeGuestBillAction, payGuestBillAction } from "../actions";
import type { GuestBill, GuestPaymentMethod } from "../../lib/payment-mutations";
import { FeedbackForm } from "./FeedbackForm";
import styles from "./PayPanel.module.css";

type View = "loading" | "error" | "choose" | "paying" | "paid" | "pending-cash" | "pending-upi";

/**
 * ADR-0010's hybrid settle model, entirely client-side state after the
 * initial load — no route change between "choose a method" and "thanks
 * for the feedback," which sidesteps the one real edge case that mattered
 * here: the mock path CLOSES the guest's own session as part of settling
 * it, and getGuestContext() would otherwise reject a closed session on a
 * server re-fetch. Everything downstream of the first finalise stays a
 * client state transition, never a navigation.
 */
export function PayPanel({ upiAvailable }: { upiAvailable: boolean }) {
  const toast = useToast();
  const [view, setView] = useState<View>("loading");
  const [bill, setBill] = useState<GuestBill | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [upiUrl, setUpiUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { error, bill } = await finalizeGuestBillAction();
      if (cancelled) return;
      if (error || !bill) {
        setError(error ?? "Could not prepare your bill.");
        setView("error");
        return;
      }
      setBill(bill);
      setView(bill.status === "settled" ? "paid" : "choose");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handlePay(method: GuestPaymentMethod) {
    setView("paying");
    const { error, result } = await payGuestBillAction(method);
    if (error || !result) {
      toast(error ?? "Something went wrong — please try again.", "critical");
      setView("choose");
      return;
    }
    if (result.settled) {
      setView("paid");
    } else if (method === "upi_intent") {
      setUpiUrl(result.upiUrl ?? null);
      setView("pending-upi");
    } else {
      setView("pending-cash");
    }
  }

  if (view === "loading") return <p>Preparing your bill…</p>;
  if (view === "error") {
    return (
      <p role="alert" className={styles.error}>
        {error}
      </p>
    );
  }
  if (!bill) return null;

  const showFeedback = view === "paid" || view === "pending-cash" || view === "pending-upi";

  return (
    <>
      <Card>
        <CardHeader title="Your bill" />
        <div className={styles.panel}>
          <div className={styles.totalRow}>
            <span>Total payable</span>
            <TabularNumber>₹{formatPaiseAsRupees(BigInt(bill.payablePaise))}</TabularNumber>
          </div>
          <p className={styles.invoice}>Invoice {bill.invoiceNo}</p>

          {(view === "choose" || view === "paying") && (
            <div className={styles.methods}>
              <Button type="button" variant="primary" disabled={view === "paying"} onClick={() => handlePay("mock")}>
                {view === "paying" ? "Paying…" : "Pay online"}
              </Button>
              {upiAvailable && (
                <Button type="button" variant="secondary" disabled={view === "paying"} onClick={() => handlePay("upi_intent")}>
                  Pay via UPI app
                </Button>
              )}
              <Button type="button" variant="secondary" disabled={view === "paying"} onClick={() => handlePay("cash")}>
                Pay with cash
              </Button>
            </div>
          )}

          {view === "paid" && <p className={styles.confirmed}>Paid ✓ — thank you!</p>}

          {view === "pending-upi" && (
            <div className={styles.pendingBlock}>
              <p>Tap below to pay in your UPI app, then show your server — they&apos;ll confirm once received.</p>
              {upiUrl && (
                <a href={upiUrl} className={styles.upiLink}>
                  Open UPI app
                </a>
              )}
            </div>
          )}

          {view === "pending-cash" && <p className={styles.confirmed}>Please pay your server — they&apos;ll confirm once received.</p>}
        </div>
      </Card>

      {showFeedback && <FeedbackForm />}
    </>
  );
}
