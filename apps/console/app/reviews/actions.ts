"use server";

import { and, eq, isNull, isNotNull, schema } from "@restrobooth/db";
import { extractReviewAspects, type ExtractedFinding } from "@restrobooth/ai";
import { revalidatePath } from "next/cache";
import { queryAsCurrentUser } from "../../lib/db";

export type ActionState = { error: string | null };

function requiredString(formData: FormData, key: string): string {
  const value = formData.get(key);
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${key} is required`);
  return value.trim();
}

function optionalString(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function optionalRating(formData: FormData, key: string): number | null {
  const raw = optionalString(formData, key);
  if (raw === null) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 5) throw new Error(`${key} must be a whole number from 1 to 5`);
  return n;
}

// Same walk-the-cause-chain shape item-actions.ts's own fullErrorMessage
// uses (Drizzle wraps the real Postgres error in .cause, not .message).
function fullErrorMessage(err: unknown): string {
  const parts: string[] = [];
  let current: unknown = err;
  while (current instanceof Error) {
    if (!current.message.startsWith("Failed query:")) parts.push(current.message);
    current = current.cause;
  }
  return parts.join(" | ");
}

interface FindingInsert {
  outletId: string;
  storeId: string;
  sourceType: "guest_feedback" | "external_review";
  externalReviewId: string | null;
  feedbackId: string | null;
  feedbackBusinessDate: string | null;
  aspect: ExtractedFinding["aspect"];
  sentiment: ExtractedFinding["sentiment"];
  menuItemId: string | null;
  snippet: string;
  aiUsed: boolean;
}

function toFindingRows(
  findings: ExtractedFinding[],
  aiUsed: boolean,
  target: { outletId: string; storeId: string } & (
    | { sourceType: "external_review"; externalReviewId: string }
    | { sourceType: "guest_feedback"; feedbackId: string; feedbackBusinessDate: string }
  ),
): FindingInsert[] {
  return findings.map((f) => ({
    outletId: target.outletId,
    storeId: target.storeId,
    sourceType: target.sourceType,
    externalReviewId: target.sourceType === "external_review" ? target.externalReviewId : null,
    feedbackId: target.sourceType === "guest_feedback" ? target.feedbackId : null,
    feedbackBusinessDate: target.sourceType === "guest_feedback" ? target.feedbackBusinessDate : null,
    aspect: f.aspect,
    sentiment: f.sentiment,
    menuItemId: f.menuItemId,
    snippet: f.snippet,
    aiUsed,
  }));
}

/** Paste an aggregator review, then run it through extraction immediately
 *  — a staff member submitting a review wants to see what came out of it,
 *  not come back later. `extractReviewAspects` degrades to the keyword
 *  fallback on its own (no key / over budget / timeout); either way this
 *  always stores real findings, `aiUsed` says which path produced them. */
export async function submitExternalReview(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const storeId = requiredString(formData, "storeId");
    const sourcePlatform = requiredString(formData, "sourcePlatform");
    const reviewText = requiredString(formData, "reviewText");
    const externalRating = optionalRating(formData, "externalRating");
    const authorLabel = optionalString(formData, "authorLabel");
    const reviewedOn = optionalString(formData, "reviewedOn");

    await queryAsCurrentUser(async (tx, userId) => {
      const [store] = await tx.select({ outletId: schema.stores.outletId }).from(schema.stores).where(eq(schema.stores.id, storeId));
      if (!store) throw new Error("Store not found");

      const reviewId = crypto.randomUUID();
      const { findings, aiUsed } = await extractReviewAspects(tx, { outletId: store.outletId, storeId, reviewText });

      await tx.insert(schema.externalReviews).values({
        id: reviewId,
        outletId: store.outletId,
        storeId,
        sourcePlatform: sourcePlatform as "zomato" | "swiggy" | "google" | "other",
        externalRating,
        authorLabel,
        reviewText,
        reviewedOn,
        extractedAt: new Date(),
        extractionAiUsed: aiUsed,
        createdBy: userId,
      });

      if (findings.length > 0) {
        await tx.insert(schema.reviewExtractions).values(
          toFindingRows(findings, aiUsed, { outletId: store.outletId, storeId, sourceType: "external_review", externalReviewId: reviewId }).map((r) => ({
            id: crypto.randomUUID(),
            ...r,
          })),
        );
      }
    });
  } catch (err) {
    return { error: fullErrorMessage(err) || "Could not submit review" };
  }
  revalidatePath("/reviews");
  return { error: null };
}

const PENDING_BATCH_LIMIT = 25;

/** Batch-extracts whatever accessible guest feedback has a comment but
 *  hasn't been processed yet. Bounded per call (a Console button click
 *  runs inside a normal request, not a background job — no queue exists
 *  in this codebase and this slice doesn't need one at expected volume);
 *  clicking again processes the next batch. */
export async function extractPendingFeedback(): Promise<ActionState> {
  try {
    await queryAsCurrentUser(async (tx) => {
      const pending = await tx
        .select({
          id: schema.feedback.id,
          businessDate: schema.feedback.businessDate,
          outletId: schema.feedback.outletId,
          storeId: schema.feedback.storeId,
          comment: schema.feedback.comment,
        })
        .from(schema.feedback)
        .where(and(isNotNull(schema.feedback.comment), isNull(schema.feedback.extractedAt)))
        .limit(PENDING_BATCH_LIMIT);

      for (const row of pending) {
        if (!row.comment) continue;
        const { findings, aiUsed } = await extractReviewAspects(tx, { outletId: row.outletId, storeId: row.storeId, reviewText: row.comment });

        if (findings.length > 0) {
          await tx.insert(schema.reviewExtractions).values(
            toFindingRows(findings, aiUsed, {
              outletId: row.outletId,
              storeId: row.storeId,
              sourceType: "guest_feedback",
              feedbackId: row.id,
              feedbackBusinessDate: row.businessDate,
            }).map((r) => ({ id: crypto.randomUUID(), ...r })),
          );
        }

        await tx
          .update(schema.feedback)
          .set({ extractedAt: new Date(), extractionAiUsed: aiUsed })
          .where(and(eq(schema.feedback.id, row.id), eq(schema.feedback.businessDate, row.businessDate)));
      }
    });
  } catch (err) {
    return { error: fullErrorMessage(err) || "Could not extract pending feedback" };
  }
  revalidatePath("/reviews");
  return { error: null };
}
