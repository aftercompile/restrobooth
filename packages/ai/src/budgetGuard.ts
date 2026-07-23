import { sql, eq, schema, type RlsTx } from "@restrobooth/db";

/** The closed set — matches ai_usage_ledger's `ai_usage_feature_valid`
 *  check constraint exactly. A typo here is a compile error, not a
 *  silently-created unbudgeted bucket. */
export type AIFeature =
  | "booth_host"
  | "upsell"
  | "review_extraction"
  | "menu_engineering"
  | "forecasting"
  | "ask_restrobooth"
  | "content_studio";

export interface BudgetStatus {
  usedTokens: number;
  budgetTokens: number;
  /** 0–100+; can exceed 100 (the guard blocks the NEXT call, it doesn't
   *  retroactively cap a month that's already gone over). */
  percentUsed: number;
  /** false once usedTokens >= budgetTokens — ADR-0007 §4's hard stop. */
  allowed: boolean;
}

/**
 * ADR-0007 §4 — "a per-outlet monthly token budget, enforced server-side
 * BEFORE the call is made, not after." Callers check this, and only
 * proceed to call a provider if `allowed` is true. The 80%-warn threshold
 * is a console-UI concern (render a warning banner using `percentUsed`),
 * not this function's job — this function only draws the hard 100% line.
 *
 * `outletId` decides the budget row; the SUM is over whatever rows are
 * currently accessible under the transaction's RLS scope — pass a
 * privileged (RLS-bypassing) tx to get the true whole-outlet total, or an
 * RLS-scoped tx if a narrower, staff-visible total is what's wanted (e.g.
 * a console dashboard that should only ever show what that staff member
 * could see anyway).
 */
export async function checkBudget(tx: RlsTx, outletId: string): Promise<BudgetStatus> {
  const outlet = (await tx.select().from(schema.outlets).where(eq(schema.outlets.id, outletId)))[0];
  if (!outlet) throw new Error(`outlet not found: ${outletId}`);
  const budgetTokens = outlet.aiMonthlyTokenBudget;

  const result = await tx.execute<{ [key: string]: unknown; used: string | null }>(sql`
    select coalesce(sum(input_tokens + output_tokens), 0) as used
    from ai_usage_ledger
    where outlet_id = ${outletId}
      and business_date >= date_trunc('month', current_date)
      and business_date < date_trunc('month', current_date) + interval '1 month'
  `);
  const usedTokens = Number(result.rows[0]?.used ?? 0);

  return {
    usedTokens,
    budgetTokens,
    percentUsed: budgetTokens > 0 ? (usedTokens / budgetTokens) * 100 : 100,
    allowed: usedTokens < budgetTokens,
  };
}

export interface RecordUsageParams {
  outletId: string;
  storeId?: string | null;
  businessDate: string;
  feature: AIFeature;
  providerId: string;
  inputTokens: number;
  outputTokens: number;
  costPaise: bigint;
}

/** Writes the ledger row a completed call is billed against. Called
 *  AFTER a real provider call returns (never for a stub/cache-hit
 *  response — those cost nothing and would only pollute the budget with
 *  phantom usage). Idempotency is the caller's job if it matters for a
 *  given feature (none of Slice 1's callers replay a completed AI call). */
export async function recordUsage(tx: RlsTx, params: RecordUsageParams): Promise<void> {
  await tx.insert(schema.aiUsageLedger).values({
    id: crypto.randomUUID(),
    businessDate: params.businessDate,
    outletId: params.outletId,
    storeId: params.storeId ?? null,
    feature: params.feature,
    providerId: params.providerId,
    inputTokens: params.inputTokens,
    outputTokens: params.outputTokens,
    costPaise: params.costPaise,
  });
}
