"use server";

import { revalidatePath } from "next/cache";
import { addToCart, callWaiter, placeOrder, removeFromCart } from "../lib/order-mutations";
import { finalizeGuestBill, payGuestBill, submitFeedback, type GuestBill, type GuestPaymentMethod, type GuestPaymentResult } from "../lib/payment-mutations";
import { getBoothHostRecommendations, type BoothHostPreferences, type BoothHostResult } from "../lib/booth-host";
import { getGuestContext } from "../lib/guest-context";

export interface SimpleActionState {
  error: string | null;
}
const OK: SimpleActionState = { error: null };

/** Called directly (not via a <form>) from a tap — mirrors
 *  apps/captain/app/floor/[sessionId]/AddItemPicker.tsx's useTransition
 *  pattern, just without FormData boilerplate since there's only one arg. */
export async function addToCartAction(menuItemId: string): Promise<SimpleActionState> {
  const result = await addToCart(menuItemId);
  if (!result.ok) return { error: result.error };
  revalidatePath("/");
  revalidatePath("/menu");
  return OK;
}

export async function removeFromCartAction(orderItemId: string): Promise<SimpleActionState> {
  const result = await removeFromCart(orderItemId);
  if (!result.ok) return { error: result.error };
  revalidatePath("/");
  return OK;
}

/** useActionState-shaped (ignores prevState/formData) — matches
 *  apps/captain's FireButton pattern: a <form action> gives us a shared
 *  pending flag + inline error display for free. */
export async function placeOrderAction(_prev: SimpleActionState, _formData: FormData): Promise<SimpleActionState> {
  const result = await placeOrder();
  if (!result.ok) return { error: result.error };
  revalidatePath("/");
  return OK;
}

/** Called directly from BoothShell's header button — same shape as
 *  addToCartAction. Revalidates both pages since the button lives in the
 *  shell both share. */
export async function callWaiterAction(): Promise<SimpleActionState> {
  const result = await callWaiter();
  if (!result.ok) return { error: result.error };
  revalidatePath("/");
  revalidatePath("/menu");
  return OK;
}

/** Called directly from PayPanel on mount — idempotent (returns the
 *  existing bill if one's already finalised), so a re-visit or a refresh
 *  never double-bills. */
export async function finalizeGuestBillAction(): Promise<{ error: string | null; bill: GuestBill | null }> {
  const result = await finalizeGuestBill();
  if (!result.ok) return { error: result.error, bill: null };
  const { ok: _ok, ...bill } = result;
  return { error: null, bill };
}

export async function payGuestBillAction(
  method: GuestPaymentMethod,
): Promise<{ error: string | null; result: GuestPaymentResult | null }> {
  const result = await payGuestBill(method);
  if (!result.ok) return { error: result.error, result: null };
  const { ok: _ok, ...paymentResult } = result;
  revalidatePath("/");
  return { error: null, result: paymentResult };
}

export async function submitFeedbackAction(rating: number, comment: string): Promise<SimpleActionState> {
  const result = await submitFeedback(rating, comment);
  if (!result.ok) return { error: result.error };
  return OK;
}

/** Called from BoothHostIntake on submit — never blocks the menu itself,
 *  which is already rendered by the time a guest can even reach this
 *  (ADR-0007 §3). A missing/expired guest session degrades to an empty
 *  rail rather than an error — this is a "nice to have" surface, not a
 *  core flow, so it fails quiet the same way a timed-out AI call does. */
export async function getBoothHostRecommendationsAction(prefs: BoothHostPreferences): Promise<BoothHostResult> {
  const guest = await getGuestContext();
  if (!guest) return { items: [], aiUsed: false };
  return getBoothHostRecommendations({ storeId: guest.storeId, outletId: guest.outletId }, prefs);
}
