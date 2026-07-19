import { describe, expect, test } from "vitest";
import { evaluateGuestTokenAccess, guestTokenDenialMessage } from "./qrToken";

const NOW = new Date("2026-07-19T12:00:00Z");
const FUTURE = new Date("2026-07-19T14:00:00Z");
const PAST = new Date("2026-07-19T10:00:00Z");

const VALID = {
  tokenFound: true,
  revokedAt: null,
  rotatesAt: FUTURE,
  now: NOW,
  hasOpenTableSession: true,
};

describe("evaluateGuestTokenAccess", () => {
  test("a valid, unexpired, unrevoked token at an open table is allowed", () => {
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

  test("a valid token for a table with no open session is denied — the screenshot-from-home case", () => {
    expect(evaluateGuestTokenAccess({ ...VALID, hasOpenTableSession: false })).toEqual({
      ok: false,
      reason: "no_open_session",
    });
  });

  test("precedence: not_found wins over every other reason", () => {
    expect(
      evaluateGuestTokenAccess({
        tokenFound: false,
        revokedAt: PAST,
        rotatesAt: PAST,
        now: NOW,
        hasOpenTableSession: false,
      }),
    ).toEqual({ ok: false, reason: "not_found" });
  });

  test("precedence: revoked wins over expired and no_open_session", () => {
    expect(
      evaluateGuestTokenAccess({
        tokenFound: true,
        revokedAt: PAST,
        rotatesAt: PAST,
        now: NOW,
        hasOpenTableSession: false,
      }),
    ).toEqual({ ok: false, reason: "revoked" });
  });
});

describe("guestTokenDenialMessage", () => {
  test("no_open_session gets the specific, actionable message", () => {
    expect(guestTokenDenialMessage("no_open_session")).toMatch(/staff/i);
  });

  test("not_found, revoked, and expired all get the same vague rescan message", () => {
    const notFound = guestTokenDenialMessage("not_found");
    expect(guestTokenDenialMessage("revoked")).toBe(notFound);
    expect(guestTokenDenialMessage("expired")).toBe(notFound);
  });
});
