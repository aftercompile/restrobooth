"use client";

import { useState } from "react";
import { Animate, Button, Card, CheckCircleIcon, motion, useMotionAllowed, useToast } from "@restrobooth/ui";
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
  const toast = useToast();
  const motionAllowed = useMotionAllowed();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit() {
    if (rating < 1) {
      toast("Please choose a rating.", "critical");
      return;
    }
    setSubmitting(true);
    const result = await submitFeedbackAction(rating, comment);
    setSubmitting(false);
    if (result.error) {
      toast(result.error, "critical");
      return;
    }
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <Animate>
        <Card>
          <div className={styles.thanks}>
            <CheckCircleIcon className={styles.thanksIcon} />
            <span>Thanks for letting us know!</span>
          </div>
        </Card>
      </Animate>
    );
  }

  return (
    <Card>
      <h2 className={styles.title}>How was your meal?</h2>
      <div className={styles.panel}>
        <div className={styles.stars} role="radiogroup" aria-label="Rating, 1 to 5 stars">
          {STARS.map((star) => {
            const filled = star <= rating;
            const Comp = motionAllowed ? motion.button : "button";
            return (
              <Comp
                key={star}
                type="button"
                role="radio"
                aria-checked={filled}
                aria-label={`${star} star${star === 1 ? "" : "s"}`}
                className={styles.star}
                data-filled={filled}
                onClick={() => setRating(star)}
                {...(motionAllowed ? { whileTap: { scale: 0.85 } } : {})}
              >
                ★
              </Comp>
            );
          })}
        </div>
        <textarea
          className={styles.comment}
          placeholder="Anything else? (optional)"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={3}
        />
        <Button type="button" variant="primary" className={styles.submitButton} disabled={submitting} onClick={handleSubmit}>
          {submitting ? "Sending…" : "Send feedback"}
        </Button>
      </div>
    </Card>
  );
}
