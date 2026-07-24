"use client";

import { useEffect, useState } from "react";
import {
  Animate,
  BankIcon,
  Button,
  Card,
  CashIcon,
  CheckCircleIcon,
  ReceiptIcon,
  SmartphoneIcon,
  formatPaiseAsRupees,
  useToast,
} from "@restrobooth/ui";
import { finalizeGuestBillAction, payGuestBillAction } from "../actions";
import type { GuestBill, GuestPaymentMethod } from "../../lib/payment-mutations";
import { FeedbackForm } from "./FeedbackForm";
import styles from "./PayPanel.module.css";

type View = "loading" | "error" | "choose" | "paying" | "paid" | "pending-cash" | "pending-upi";

/** "Pay online" is its own prominent CTA, not a third grid tile — it's the
 *  one method that actually completes the visit end to end (auto-settles,
 *  closes the table). UPI/cash both still need a staff member to confirm
 *  receipt before anything's final, so they read as the secondary,
 *  "or hand it to your server" options underneath. */
const ALT_METHODS: { value: GuestPaymentMethod; label: string; icon: typeof CashIcon }[] = [
  { value: "upi_intent", label: "UPI app", icon: SmartphoneIcon },
  { value: "cash", label: "Cash", icon: CashIcon },
];

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
  const [payingMethod, setPayingMethod] = useState<GuestPaymentMethod | null>(null);

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
    setPayingMethod(method);
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

  if (view === "loading") {
    return (
      <Card>
        <p className={styles.loading}>Preparing your bill…</p>
      </Card>
    );
  }
  if (view === "error") {
    return (
      <Card>
        <p role="alert" className={styles.error}>
          {error}
        </p>
      </Card>
    );
  }
  if (!bill) return null;

  const showFeedback = view === "paid" || view === "pending-cash" || view === "pending-upi";
  const altMethods = upiAvailable ? ALT_METHODS : ALT_METHODS.filter((m) => m.value !== "upi_intent");
  const paying = view === "paying";

  return (
    <>
      <Animate>
        <Card className={styles.billCard}>
          <div className={styles.billHead}>
            <span className={styles.billHeadIconWrap}>
              <ReceiptIcon className={styles.billHeadIcon} />
            </span>
            <div>
              <div className={styles.billHeadTitle}>Your bill</div>
              <div className={styles.invoice}>Invoice {bill.invoiceNo}</div>
            </div>
          </div>

          <div className={styles.breakdown}>
            <div className={styles.breakdownRow}>
              <span>Subtotal</span>
              <span>₹{formatPaiseAsRupees(BigInt(bill.subtotalPaise))}</span>
            </div>
            <div className={styles.breakdownRow}>
              <span>Tax</span>
              <span>₹{formatPaiseAsRupees(BigInt(bill.taxPaise))}</span>
            </div>
            {BigInt(bill.roundOffPaise) !== 0n && (
              <div className={styles.breakdownRow}>
                <span>Round off</span>
                <span>₹{formatPaiseAsRupees(BigInt(bill.roundOffPaise))}</span>
              </div>
            )}
          </div>
          <div className={styles.totalRow}>
            <span className={styles.totalLabel}>Total payable</span>
            <span className={styles.totalAmount}>₹{formatPaiseAsRupees(BigInt(bill.payablePaise))}</span>
          </div>

          {(view === "choose" || view === "paying") && (
            <div className={styles.methods}>
              <Button type="button" variant="primary" className={styles.payOnlineButton} disabled={paying} onClick={() => handlePay("mock")}>
                {paying && payingMethod === "mock" ? "Processing…" : "Pay online"}
              </Button>

              <div className={styles.altDivider}>
                <span>or pay another way</span>
              </div>

              <div className={styles.altMethods}>
                {altMethods.map((m) => {
                  const isPaying = paying && payingMethod === m.value;
                  return (
                    <button key={m.value} type="button" className={styles.methodButton} disabled={paying} onClick={() => handlePay(m.value)}>
                      <span className={styles.methodIconWrap}>
                        <m.icon className={styles.methodIcon} />
                      </span>
                      <span className={styles.methodLabel}>{isPaying ? "Processing…" : m.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {view === "paid" && (
            <Animate>
              <div className={styles.confirmedBlock}>
                <CheckCircleIcon className={styles.confirmedIcon} />
                <span>Paid — thank you!</span>
              </div>
            </Animate>
          )}

          {view === "pending-upi" && (
            <Animate>
              <div className={styles.pendingBlock}>
                <p className={styles.pendingText}>Tap below to pay in your UPI app, then show your server — they&apos;ll confirm once received.</p>
                {upiUrl && (
                  <a href={upiUrl} className={styles.upiLink}>
                    <SmartphoneIcon className={styles.upiLinkIcon} />
                    Open UPI app
                  </a>
                )}
              </div>
            </Animate>
          )}

          {view === "pending-cash" && (
            <Animate>
              <div className={styles.pendingBlock}>
                <BankIcon className={styles.pendingIcon} aria-hidden="true" />
                <p className={styles.pendingText}>Please pay your server — they&apos;ll confirm once received.</p>
              </div>
            </Animate>
          )}
        </Card>
      </Animate>

      {showFeedback && (
        <Animate delayIndex={1}>
          <FeedbackForm />
        </Animate>
      )}
    </>
  );
}
