"use client";

import { useState, useTransition } from "react";
import { Animate, AnimatePresence, BOOTH_TRANSITION, Chip, Skeleton, motion, useMotionAllowed } from "@restrobooth/ui";
import { getBoothHostRecommendationsAction } from "../actions";
import type { BoothHostPreferences, BoothHostResult, Mood, SpiceLevel, Diet, BudgetBand } from "../../lib/booth-host";
import { PickedForYouRail } from "./PickedForYouRail";
import styles from "./BoothHostIntake.module.css";

const MOODS: { value: Mood; label: string }[] = [
  { value: "quick-bite", label: "Quick bite" },
  { value: "comfort", label: "Comfort food" },
  { value: "celebrating", label: "Celebrating" },
  { value: "light", label: "Something light" },
];
const SPICE_LEVELS: { value: SpiceLevel; label: string }[] = [
  { value: "mild", label: "Mild" },
  { value: "medium", label: "Medium" },
  { value: "hot", label: "Hot" },
];
const DIETS: { value: Diet; label: string }[] = [
  { value: "veg", label: "Veg" },
  { value: "non_veg", label: "Non-veg" },
  { value: "jain", label: "Jain" },
  { value: "egg", label: "Egg" },
];
const BUDGETS: { value: BudgetBand; label: string }[] = [
  { value: "low", label: "₹" },
  { value: "mid", label: "₹₹" },
  { value: "high", label: "₹₹₹" },
];
const ALLERGENS = ["dairy", "gluten", "shellfish", "soy", "egg", "nuts"];
const TOTAL_STEPS = 6;

type Stage = "collapsed" | "intake" | "results" | "dismissed";

/**
 * ADR-0007 §5A — the Booth Host's guest-facing intake, redesigned as a
 * one-question-at-a-time conversational wizard (owner's explicit call,
 * reversing Pass 1's "keep it one screen" choice — asked for twice now,
 * with real detail: progress indicator, per-step Skip). Every question
 * is still optional: "Continue" advances regardless of whether this
 * step's chip is selected, and "Skip" (always visible, ADR-0007 §3)
 * dismisses the WHOLE intake in one tap from any step, not just this
 * one — the "never blocks the menu" guarantee is unchanged, just spread
 * across steps instead of one screen.
 *
 * Free text feeds the reason-string prompt as guest-stated context, not
 * a live re-embedding re-rank — that's a deliberately deferred piece
 * (DECISIONS.md, Phase 6 Slice 2): running the embedding model at
 * request time needs a warm, persistent process to stay inside the
 * 1200ms budget, which is a real fit for this dev server but not
 * guaranteed for every future deployment target, so it wasn't built into
 * the guest-facing path yet.
 *
 * Starts COLLAPSED (Pass 4, 2026-07-24) — the full 6-step wizard used to
 * render open by default, which on a real phone pushed the entire food
 * list below the fold; a guest opening the menu saw zero dishes. A
 * diner scans the QR to see the MENU, not to fill out a form first — the
 * wizard is still one tap away via the slim banner, not removed.
 */
export function BoothHostIntake() {
  const [stage, setStage] = useState<Stage>("collapsed");
  const [step, setStep] = useState(0);
  const [mood, setMood] = useState<Mood>();
  const [spiceLevel, setSpiceLevel] = useState<SpiceLevel>();
  const [diet, setDiet] = useState<Diet>();
  const [budgetBand, setBudgetBand] = useState<BudgetBand>();
  const [avoidAllergens, setAvoidAllergens] = useState<string[]>([]);
  const [freeText, setFreeText] = useState("");
  const [result, setResult] = useState<BoothHostResult | null>(null);
  const [pending, startTransition] = useTransition();
  const motionAllowed = useMotionAllowed();

  function toggleAllergen(a: string) {
    setAvoidAllergens((prev) => (prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]));
  }

  function handleSubmit() {
    startTransition(async () => {
      const trimmedFreeText = freeText.trim();
      const prefs: BoothHostPreferences = {
        ...(mood !== undefined && { mood }),
        ...(spiceLevel !== undefined && { spiceLevel }),
        ...(diet !== undefined && { diet }),
        ...(budgetBand !== undefined && { budgetBand }),
        ...(avoidAllergens.length > 0 && { avoidAllergens }),
        ...(trimmedFreeText.length > 0 && { freeText: trimmedFreeText }),
      };
      const res = await getBoothHostRecommendationsAction(prefs);
      setResult(res);
      setStage("results");
    });
  }

  if (stage === "dismissed") return null;
  if (stage === "collapsed") {
    // A div with button semantics, not a real <button> — same reasoning
    // as MenuItemCard's card: the dismiss control below needs to be a
    // genuine, independently-focusable <button>, and a real <button>
    // can't nest another one (the HTML parser silently breaks it).
    return (
      <Animate>
        <div
          className={styles.banner}
          role="button"
          tabIndex={0}
          onClick={() => setStage("intake")}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setStage("intake");
            }
          }}
        >
          <span className={styles.bannerIcon} aria-hidden="true">
            ✨
          </span>
          <span className={styles.bannerText}>
            <span className={styles.bannerTitle}>Let our AI recommend your meal</span>
            <span className={styles.bannerSub}>A few quick questions, then real picks for you</span>
          </span>
          <button
            type="button"
            className={styles.bannerDismiss}
            aria-label="Dismiss AI recommendation"
            onClick={(e) => {
              e.stopPropagation();
              setStage("dismissed");
            }}
          >
            ✕
          </button>
        </div>
      </Animate>
    );
  }
  if (stage === "results" && result) return <PickedForYouRail result={result} onDismiss={() => setStage("dismissed")} />;
  // The submit -> real completion round-trip can take several real
  // seconds (owner decision, 2026-07-24 — raised from an instant 1200ms
  // fallback-or-nothing to a real up-to-9s wait so genuine AI reasons can
  // land more often; see booth-host.ts). A guest staring at a disabled
  // button for that long reads as broken, so this replaces the whole
  // panel with an explicit "still working" view instead of just
  // disabling the Continue button in place.
  if (pending) return <PersonalizingPanel />;

  const isLastStep = step === TOTAL_STEPS - 1;

  function handleContinue() {
    if (isLastStep) handleSubmit();
    else setStep((s) => s + 1);
  }

  let stepContent;
  if (step === 0) {
    stepContent = <StepChips question="What are you in the mood for?" options={MOODS} value={mood} onChange={setMood} />;
  } else if (step === 1) {
    stepContent = <StepChips question="How spicy do you like it?" options={SPICE_LEVELS} value={spiceLevel} onChange={setSpiceLevel} />;
  } else if (step === 2) {
    stepContent = <StepChips question="Any dietary preference?" options={DIETS} value={diet} onChange={setDiet} />;
  } else if (step === 3) {
    stepContent = <StepChips question="What's your budget?" options={BUDGETS} value={budgetBand} onChange={setBudgetBand} />;
  } else if (step === 4) {
    stepContent = (
      <div className={styles.stepBody}>
        <p className={styles.question}>Avoiding anything?</p>
        <div className={styles.chipsGrid}>
          {ALLERGENS.map((a) => (
            <Chip key={a} selected={avoidAllergens.includes(a)} onToggle={() => toggleAllergen(a)}>
              {a}
            </Chip>
          ))}
        </div>
      </div>
    );
  } else {
    stepContent = (
      <div className={styles.stepBody}>
        <p className={styles.question}>Anything else we should know?</p>
        <input
          type="text"
          className={styles.freeText}
          placeholder="Tell us what you're craving… (optional)"
          value={freeText}
          onChange={(e) => setFreeText(e.target.value)}
          maxLength={140}
        />
      </div>
    );
  }

  return (
    <Animate>
      <div className={styles.panel}>
        <div className={styles.header}>
          <div className={styles.progress} role="progressbar" aria-valuenow={step + 1} aria-valuemin={1} aria-valuemax={TOTAL_STEPS}>
            {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
              <span key={i} className={styles.dot} data-filled={i <= step} />
            ))}
          </div>
          <button type="button" className={styles.skip} onClick={() => setStage("dismissed")}>
            Skip
          </button>
        </div>

        <p className={styles.intro}>✨ Let our AI recommend your meal</p>

        {motionAllowed ? (
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={BOOTH_TRANSITION}
            >
              {stepContent}
            </motion.div>
          </AnimatePresence>
        ) : (
          stepContent
        )}

        <div className={styles.footer}>
          {step > 0 && (
            <button type="button" className={styles.back} onClick={() => setStep((s) => s - 1)}>
              Back
            </button>
          )}
          <button type="button" className={styles.continue} onClick={handleContinue}>
            {isLastStep ? "Show me picks" : "Continue"}
          </button>
        </div>
      </div>
    </Animate>
  );
}

/** The wait view for however long the real completion takes (up to
 *  BOOTH_TIMEOUT_MS) — skeleton cards preview the shape of what's coming
 *  (real PickedForYouRail cards, once they land) so there's no layout
 *  jump when the actual result replaces this. The pulse is gated the
 *  same way every other Booth motion is (`useMotionAllowed()`); the
 *  Skeleton shimmer itself is CSS-only and already reduced-motion-safe
 *  regardless. */
function PersonalizingPanel() {
  const motionAllowed = useMotionAllowed();
  const Icon = motionAllowed ? motion.span : "span";
  return (
    <Animate>
      <div className={styles.panel}>
        <div className={styles.personalizing}>
          <Icon
            aria-hidden="true"
            className={styles.personalizingIcon}
            {...(motionAllowed ? { animate: { scale: [1, 1.15, 1] }, transition: { duration: 1.4, repeat: Infinity, ease: "easeInOut" } } : {})}
          >
            ✨
          </Icon>
          <p className={styles.personalizingText}>Personalizing your recommendation…</p>
          <p className={styles.personalizingSub}>Our AI host is matching dishes to what you told us.</p>
        </div>
        <div className={styles.personalizingCards}>
          {[0, 1, 2].map((i) => (
            <div key={i} className={styles.personalizingCard}>
              <Skeleton width="70%" height="1.1em" />
              <Skeleton width="90%" />
              <Skeleton width="40%" />
            </div>
          ))}
        </div>
      </div>
    </Animate>
  );
}

function StepChips<T extends string>({
  question,
  options,
  value,
  onChange,
}: {
  question: string;
  options: { value: T; label: string }[];
  value: T | undefined;
  onChange: (v: T | undefined) => void;
}) {
  return (
    <div className={styles.stepBody}>
      <p className={styles.question}>{question}</p>
      <div className={styles.chipsGrid}>
        {options.map((o) => (
          <Chip key={o.value} selected={value === o.value} onToggle={() => onChange(value === o.value ? undefined : o.value)}>
            {o.label}
          </Chip>
        ))}
      </div>
    </div>
  );
}
