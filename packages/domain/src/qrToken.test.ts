import { describe, expect, test } from "vitest";
import {
  evaluateGuestSeatEligibility,
  evaluateGuestTokenAccess,
  guestTokenDenialMessage,
  seatEligibilityDenialMessage,
} from "./qrToken";

const NOW = new Date("2026-07-19T12:00:00Z");
const FUTURE = new Date("2026-07-19T14:00:00Z");
const PAST = new Date("2026-07-19T10:00:00Z");

const VALID = {
  tokenFound: true,
  revokedAt: null,
  rotatesAt: FUTURE,
  now: NOW,
};

describe("evaluateGuestTokenAccess", () => {
  test("a valid, unexpired, unrevoked token is allowed", () => {
    expect(evaluateGuestTokenAccess(VALID)).toEqual({ ok: true });
  });

  test("an unknown token hash is denied before anything else is checked", () => {
    expect(evaluateGuestTokenAccess({ ...VALID, tokenFound: false })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  test("a revoked token is denied even if not yet past rotates_at", () => {
    expect(evaluateGuestTokenAccess({ ...VALID, revokedAt: PAST })).toEqual({
      ok: false,
      reason: "revoked",
    });
  });

  test("a token past its rotates_at is denied — the screenshot-from-last-week case", () => {
    expect(evaluateGuestTokenAccess({ ...VALID, rotatesAt: PAST })).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  test("now exactly equal to rotatesAt is still valid (boundary is exclusive on the expired side)", () => {
    expect(evaluateGuestTokenAccess({ ...VALID, rotatesAt: NOW })).toEqual({ ok: true });
  });

  test("precedence: not_found wins over every other reason", () => {
    expect(
      evaluateGuestTokenAccess({
        tokenFound: false,
        revokedAt: PAST,
        rotatesAt: PAST,
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: "not_found" });
  });

  test("precedence: revoked wins over expired", () => {
    expect(
      evaluateGuestTokenAccess({
        tokenFound: true,
        revokedAt: PAST,
        rotatesAt: PAST,
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: "revoked" });
  });
});

describe("guestTokenDenialMessage", () => {
  test("every reason gets the same vague rescan message (deliberately, not distinguishable to an attacker)", () => {
    const notFound = guestTokenDenialMessage("not_found");
    expect(guestTokenDenialMessage("revoked")).toBe(notFound);
    expect(guestTokenDenialMessage("expired")).toBe(notFound);
  });
});

describe("evaluateGuestSeatEligibility", () => {
  const ELIGIBLE = { businessDayOpen: true, tableStatus: "available" as const };

  test("an open outlet with an available table is eligible", () => {
    expect(evaluateGuestSeatEligibility(ELIGIBLE)).toEqual({ ok: true });
  });

  test("no open business day is denied", () => {
    expect(evaluateGuestSeatEligibility({ ...ELIGIBLE, businessDayOpen: false })).toEqual({
      ok: false,
      reason: "outlet_not_open",
    });
  });

  test("a table flagged out_of_service is denied", () => {
    expect(evaluateGuestSeatEligibility({ ...ELIGIBLE, tableStatus: "out_of_service" })).toEqual({
      ok: false,
      reason: "table_out_of_service",
    });
  });

  test("precedence: outlet_not_open wins over table_out_of_service", () => {
    expect(
      evaluateGuestSeatEligibility({ businessDayOpen: false, tableStatus: "out_of_service" }),
    ).toEqual({ ok: false, reason: "outlet_not_open" });
  });
});

describe("seatEligibilityDenialMessage", () => {
  test("each reason gets its own specific, actionable message", () => {
    expect(seatEligibilityDenialMessage("outlet_not_open")).toMatch(/hasn.t opened/i);
    expect(seatEligibilityDenialMessage("table_out_of_service")).toMatch(/isn.t available/i);
  });
});
