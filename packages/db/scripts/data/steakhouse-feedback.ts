/**
 * Phase 6 Slice 4 — a deterministic, clearly-labeled SYNTHETIC guest-
 * feedback corpus for the Ember & Oak generator (import-steakhouse.ts).
 * Owner decision (2026-07-24, "paste-path + synthetic feedback"): the
 * review dataset promised at Phase 6 kickoff never arrived, and real
 * `feedback.comment` rows are near-empty (only whatever live Playwright
 * testing created). Rather than let the review→action report and eval
 * stay empty, this corpus gives it real volume — same honesty framing as
 * the generator's own orders/bills: GENERATED fixture content, seeded and
 * reproducible, never presented as if a real guest wrote it.
 *
 * Hand-written to span all six aspects (taste/portion/temperature/wait/
 * price/service) across positive/negative/mixed sentiment, so both the
 * keyword-rule fallback and (when configured) the LLM extraction path
 * have unambiguous, varied real signal to classify.
 */
export interface FeedbackTemplate {
  rating: number;
  /** Whether `text` needs a real dish name filled in (from an item
   *  actually ordered in that session — never an invented dish). */
  needsDish: boolean;
  text: (dishName: string) => string;
}

export const FEEDBACK_TEMPLATES: FeedbackTemplate[] = [
  // Taste — positive
  { rating: 5, needsDish: true, text: (d) => `The ${d} was absolutely delicious — best we've had in a while.` },
  { rating: 5, needsDish: true, text: (d) => `${d} was cooked perfectly, full of flavor.` },
  { rating: 4, needsDish: true, text: (d) => `Really enjoyed the ${d}, will order it again.` },
  { rating: 5, needsDish: true, text: (d) => `Best ${d} we've had in Bandra, hands down.` },
  // Taste — negative
  { rating: 2, needsDish: true, text: (d) => `The ${d} was bland and honestly disappointing.` },
  { rating: 1, needsDish: true, text: (d) => `Very disappointed — the ${d} tasted like it had been sitting out.` },
  // Temperature — positive
  { rating: 5, needsDish: true, text: (d) => `${d} arrived piping hot, exactly how we like it.` },
  // Temperature — negative
  { rating: 2, needsDish: true, text: (d) => `Our ${d} arrived lukewarm — we had to send it back.` },
  { rating: 3, needsDish: true, text: (d) => `${d} was good but it was cold by the time it reached our table.` },
  // Portion — positive
  { rating: 4, needsDish: true, text: (d) => `Generous portion on the ${d}, more than enough for two.` },
  // Portion — negative
  { rating: 3, needsDish: true, text: (d) => `${d} was tasty but the portion felt small for the price.` },
  // Wait / service — positive (dish-independent)
  { rating: 5, needsDish: false, text: () => `Fast, friendly service — our server was attentive all night.` },
  { rating: 4, needsDish: false, text: () => `No wait at all on a Friday night, impressive for how busy it was.` },
  // Wait — negative (dish-independent)
  { rating: 2, needsDish: false, text: () => `Waited nearly 40 minutes for our table despite a reservation.` },
  { rating: 3, needsDish: false, text: () => `Service was slow tonight, though the food made up for it.` },
  // Service — negative (dish-independent)
  { rating: 1, needsDish: false, text: () => `Our server was rude and seemed to ignore us the whole evening.` },
  // Price — positive
  { rating: 5, needsDish: true, text: (d) => `Great value for the ${d} — reasonably priced for the quality.` },
  // Price — negative
  { rating: 2, needsDish: true, text: (d) => `The ${d} was good but overpriced for what you actually get.` },
  // Mixed
  { rating: 3, needsDish: true, text: (d) => `${d} was delicious but the wait for our table was way too long.` },
  { rating: 4, needsDish: true, text: (d) => `Loved the ${d}, though it arrived a bit later than expected.` },
  // Neutral / low-signal (dish-independent, exercises "no unambiguous cue" honestly)
  { rating: 4, needsDish: false, text: () => `Nice ambiance, would come back for a special occasion.` },
  { rating: 3, needsDish: false, text: () => `Solid meal overall, nothing extraordinary but no complaints.` },
];

export interface FeedbackSessionMeta {
  sessionId: string;
  businessDate: string;
  closedAt: Date;
  /** Real dish names actually ordered in this session — a template that
   *  needsDish only ever fills in one of these, never an invented name. */
  dishNames: string[];
}

export interface GeneratedFeedbackRow {
  id: string;
  businessDate: string;
  tableSessionId: string;
  outletId: string;
  storeId: string;
  rating: number;
  comment: string;
  createdAt: Date;
}

/**
 * Shared by both the from-scratch generator (import-steakhouse.ts, for a
 * clean environment's first import) and the standalone idempotent
 * backfill (backfill-feedback.ts, for adding feedback onto a fixture
 * that's already imported — the common case once Ember & Oak already has
 * real order history locally or live, where a full wipe-and-reimport
 * would be a much larger and riskier operation than this needs). Same
 * `rand` function both callers already use (mulberry32-seeded for the
 * generator, so its own full-generation run stays fully deterministic).
 */
export function generateSyntheticFeedback(
  sessions: FeedbackSessionMeta[],
  rand: () => number,
  target: { outletId: string; storeId: string },
  rate = 0.09,
): GeneratedFeedbackRow[] {
  const rows: GeneratedFeedbackRow[] = [];
  for (const meta of sessions) {
    if (rand() >= rate) continue;
    const template = FEEDBACK_TEMPLATES[Math.floor(rand() * FEEDBACK_TEMPLATES.length)]!;
    const dishName = template.needsDish ? meta.dishNames[Math.floor(rand() * meta.dishNames.length)] : undefined;
    if (template.needsDish && !dishName) continue; // nothing to honestly reference — skip rather than guess
    rows.push({
      id: crypto.randomUUID(),
      businessDate: meta.businessDate,
      tableSessionId: meta.sessionId,
      outletId: target.outletId,
      storeId: target.storeId,
      rating: template.rating,
      comment: template.text(dishName ?? ""),
      createdAt: new Date(meta.closedAt.getTime() + (10 + Math.floor(rand() * 60)) * 60000),
    });
  }
  return rows;
}
