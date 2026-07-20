"use client";

import { useState } from "react";
import { Button, Card, CardHeader } from "@restrobooth/ui";
import { submitFeedbackAction } from "../actions";
import styles from "./FeedbackForm.module.css";

const STARS = [1, 2, 3, 4, 5] as const;

/**
 * Rating (required) + free-text comment (optional) — the owner-confirmed
 * scope for this slice. Deliberately no aspect tags / structured
 * breakdown: Phase 6's AI layer is the one that mines aspects/sentiment
 * out of this same comment text later (RESTROBOOTH_BRIEF.md) — this step
 * only captures the raw signal, it doesn't analyze it.
 */
export function FeedbackForm() {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (rating < 1) {
      setError("Please choose a rating.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const result = await submitFeedbackAction(rating, comment);
    setSubmitting(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <Card>
        <div className={styles.thanks}>Thanks for letting us know!</div>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader title="How was your meal?" />
      <div className={styles.panel}>
        <div className={styles.stars} role="radiogroup" aria-label="Rating, 1 to 5 stars">
          {STARS.map((star) => (
            <button
              key={star}
              type="button"
              role="radio"
              aria-checked={rating === star}
              aria-label={`${star} star${star === 1 ? "" : "s"}`}
              className={styles.star}
              data-filled={star <= rating}
              onClick={() => setRating(star)}
            >
              ★
            </button>
          ))}
        </div>
        <textarea
          className={styles.comment}
          placeholder="Anything else? (optional)"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={3}
        />
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        <Button type="button" variant="primary" disabled={submitting} onClick={handleSubmit}>
          {submitting ? "Sending…" : "Send feedback"}
        </Button>
      </div>
    </Card>
  );
}
