import { describe, it, expect } from "vitest";
import { withTimeout } from "./timeout.js";

function delay<T>(value: T, ms: number): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

describe("withTimeout", () => {
  it("resolves with the real result when it finishes before the timeout", async () => {
    const result = await withTimeout(delay("ok", 10), 1000);
    expect(result).toBe("ok");
  });

  it("resolves null (never throws, never hangs) when the promise is slower than the timeout", async () => {
    const result = await withTimeout(delay("too-slow", 500), 20);
    expect(result).toBeNull();
  });

  it("resolves null, not a rejection, when the wrapped promise rejects", async () => {
    const rejecting = Promise.reject(new Error("provider is down"));
    await expect(withTimeout(rejecting, 1000)).resolves.toBeNull();
  });

  it("a late rejection from a promise that already lost the race does not surface as an unhandled rejection", async () => {
    // The core ADR-0007 §3 guarantee: a guest-facing caller never sees an
    // exception, no matter how or when the underlying call fails.
    const slowThenRejects = new Promise((_, reject) => setTimeout(() => reject(new Error("late failure")), 30));
    const result = await withTimeout(slowThenRejects, 5);
    expect(result).toBeNull();
    // Give the slow promise time to actually reject in the background —
    // if that rejection were unhandled, vitest would fail this test run.
    await delay(undefined, 50);
  });
});
