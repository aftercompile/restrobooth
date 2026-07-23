/**
 * ADR-0007 §3 — "if the model is down, slow, or over budget, the product
 * still works." This is the ONE place that guarantee is enforced: every
 * AI call in this codebase is wrapped in `withTimeout`, and the wrapper
 * resolves to `null` on EITHER a timeout or a rejection (network error,
 * API error, anything) — never throws. The caller's job is just "render
 * nothing if this is null," never a try/catch, never an error toast on a
 * guest surface (a guest never learns an AI feature exists and failed).
 *
 * Booth calls pass 1200ms; console analysis calls pass 30_000. The
 * timeout value is the caller's decision, not a default hidden in here.
 */
export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  // Catches a rejection regardless of whether the real promise or the
  // timeout wins the race below — without this, a promise that loses the
  // race but rejects later throws an unhandled rejection.
  const guarded = promise.catch(() => null);

  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });

  const result = await Promise.race([guarded, timeout]);
  clearTimeout(timer!);
  return result;
}
