"use client";

import { useState } from "react";
import { Animate, Button, Card, CheckCircleIcon, motion, useMotionAllowed, useToast } from "@restrobooth/ui";
import { submitFeedbackAction } from "../actions";
import styles from "./FeedbackForm.module.css";

const STARS = [1, 2, 3, 4, 5] as const;

/** The thank-you message reacts to the REAL rating the guest just
 *  submitted — not a generic line for every outcome. Still entirely
 *  honest: this is a reaction to real input, not a claim about anything
 *  that didn't happen. */
function thanksMessage(rating: number): string {
  if (rating >= 4) return "So glad you enjoyed it — see you again soon!";
  if (rating === 3) return "Thanks for the honest feedback.";
  return "Thanks for telling us — we'll do better next time.";
}

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
            <span>{thanksMessage(rating)}</span>
          </div>
        </Card>
      </Animate>
    );
  }

  return (
    <Card>
      <h2 className={styles.title}>How was your dining experience?</h2>
      <p className={styles.subtitle}>Your feedback helps our chef and team get even better.</p>
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
