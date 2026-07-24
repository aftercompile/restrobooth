"use client";

import { useState, useTransition } from "react";
import { Animate, Chip } from "@restrobooth/ui";
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

type Stage = "intake" | "results" | "dismissed";

/**
 * ADR-0007 §5A — the Booth Host's guest-facing intake. Everything here is
 * optional and the whole panel is skippable in one tap ("Skip is always
 * visible and always one tap") — this renders BELOW the menu link, never
 * blocking it; the menu itself has already painted by the time a guest
 * could even see this (apps/booth/app/menu/page.tsx fetches both in
 * parallel, this component owns none of that data fetch).
 *
 * Deliberately still ONE screen, not a multi-step wizard — every choice
 * here is optional, and forcing a guest through N sequential screens to
 * reach "skip" would be MORE friction than the brief's own "reduce
 * friction" goal, not less. "Conversational" here means warmer questions
 * and the new Chip primitive, not a longer path to get past it.
 *
 * Free text feeds the reason-string prompt as guest-stated context, not
 * a live re-embedding re-rank — that's a deliberately deferred piece
 * (DECISIONS.md, Phase 6 Slice 2): running the embedding model at
 * request time needs a warm, persistent process to stay inside the
 * 1200ms budget, which is a real fit for this dev server but not
 * guaranteed for every future deployment target, so it wasn't built into
 * the guest-facing path yet.
 */
export function BoothHostIntake() {
  const [stage, setStage] = useState<Stage>("intake");
  const [mood, setMood] = useState<Mood>();
  const [spiceLevel, setSpiceLevel] = useState<SpiceLevel>();
  const [diet, setDiet] = useState<Diet>();
  const [budgetBand, setBudgetBand] = useState<BudgetBand>();
  const [avoidAllergens, setAvoidAllergens] = useState<string[]>([]);
  const [freeText, setFreeText] = useState("");
  const [result, setResult] = useState<BoothHostResult | null>(null);
  const [pending, startTransition] = useTransition();

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
  if (stage === "results" && result) return <PickedForYouRail result={result} onDismiss={() => setStage("dismissed")} />;

  return (
    <Animate>
      <div className={styles.panel}>
        <div className={styles.header}>
          <div>
            <p className={styles.title}>Not sure what to order?</p>
            <p className={styles.subtitle}>Answer a few quick questions and we&apos;ll pick for you.</p>
          </div>
          <button type="button" className={styles.skip} onClick={() => setStage("dismissed")}>
            Skip
          </button>
        </div>

        <ChipRow question="What are you in the mood for?" options={MOODS} value={mood} onChange={setMood} />
        <ChipRow question="How spicy?" options={SPICE_LEVELS} value={spiceLevel} onChange={setSpiceLevel} />
        <ChipRow question="Any dietary preference?" options={DIETS} value={diet} onChange={setDiet} />
        <ChipRow question="What's your budget?" options={BUDGETS} value={budgetBand} onChange={setBudgetBand} />

        <div className={styles.row}>
          <span className={styles.question}>Avoiding anything?</span>
          <div className={styles.chips}>
            {ALLERGENS.map((a) => (
              <Chip key={a} selected={avoidAllergens.includes(a)} onToggle={() => toggleAllergen(a)}>
                {a}
              </Chip>
            ))}
          </div>
        </div>

        <input
          type="text"
          className={styles.freeText}
          placeholder="Or tell us what you're craving…"
          value={freeText}
          onChange={(e) => setFreeText(e.target.value)}
          maxLength={140}
        />

        <button type="button" className={styles.submit} disabled={pending} onClick={handleSubmit}>
          {pending ? "Finding your picks…" : "Show me picks"}
        </button>
      </div>
    </Animate>
  );
}

function ChipRow<T extends string>({
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
    <div className={styles.row}>
      <span className={styles.question}>{question}</span>
      <div className={styles.chips}>
        {options.map((o) => (
          <Chip key={o.value} selected={value === o.value} onToggle={() => onChange(value === o.value ? undefined : o.value)}>
            {o.label}
          </Chip>
        ))}
      </div>
    </div>
  );
}
