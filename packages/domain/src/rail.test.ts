import { describe, expect, test } from "vitest";
import { rampStateForElapsed, TABLE_DWELL_THRESHOLDS } from "./rail";

describe("rampStateForElapsed", () => {
  test("just seated is fresh", () => {
    expect(rampStateForElapsed(0, TABLE_DWELL_THRESHOLDS)).toBe("fresh");
    expect(rampStateForElapsed(14 * 60_000, TABLE_DWELL_THRESHOLDS)).toBe("fresh");
  });

  test("boundaries are inclusive on the way up — exactly at a threshold is already the next state", () => {
    expect(rampStateForElapsed(15 * 60_000, TABLE_DWELL_THRESHOLDS)).toBe("warming");
    expect(rampStateForElapsed(30 * 60_000, TABLE_DWELL_THRESHOLDS)).toBe("hot");
    expect(rampStateForElapsed(60 * 60_000, TABLE_DWELL_THRESHOLDS)).toBe("critical");
  });

  test("one millisecond before a boundary stays in the lower state", () => {
    expect(rampStateForElapsed(15 * 60_000 - 1, TABLE_DWELL_THRESHOLDS)).toBe("fresh");
    expect(rampStateForElapsed(30 * 60_000 - 1, TABLE_DWELL_THRESHOLDS)).toBe("warming");
    expect(rampStateForElapsed(60 * 60_000 - 1, TABLE_DWELL_THRESHOLDS)).toBe("hot");
  });

  test("well past critical stays critical — it does not wrap or overflow", () => {
    expect(rampStateForElapsed(5 * 60 * 60_000, TABLE_DWELL_THRESHOLDS)).toBe("critical");
  });

  test("custom thresholds (e.g. a tighter KOT-aging clock) are respected", () => {
    const kotThresholds = { warmingAfterMs: 5 * 60_000, hotAfterMs: 10 * 60_000, criticalAfterMs: 15 * 60_000 };
    expect(rampStateForElapsed(6 * 60_000, kotThresholds)).toBe("warming");
    expect(rampStateForElapsed(6 * 60_000, TABLE_DWELL_THRESHOLDS)).toBe("fresh");
  });
});
