import { describe, expect, it } from "vitest";
import {
  HOLD_DEFAULT_DAYS, HOLDS_LIST_CONFIG, buildHoldOrderBy, buildHoldWhere, defaultHoldExpiry, expireDue,
  holdStatus, isHoldExpired, minHoldExpiry, parseReservationTab,
} from "./holds";

const today = "2026-09-21";

describe("hold expiry dates", () => {
  it("defaults to seven calendar days from today and floors at today", () => {
    expect(HOLD_DEFAULT_DAYS).toBe(7);
    expect(defaultHoldExpiry(today)).toBe("2026-09-28");
    expect(minHoldExpiry(today)).toBe(today);
  });
  it("is expired only once the day has passed on the Manila calendar", () => {
    expect(isHoldExpired(new Date("2026-09-20T12:00:00Z"), today)).toBe(true);
    expect(isHoldExpired(new Date("2026-09-21T00:00:00Z"), today)).toBe(false);
    expect(isHoldExpired(new Date("2026-09-22T00:00:00Z"), today)).toBe(false);
  });
});

describe("holdStatus — the pill's text and tone", () => {
  it("counts down, then reads today, then counts up as expired", () => {
    expect(holdStatus(new Date("2026-09-24T00:00:00Z"), today)).toMatchObject({ days: 3, text: "expires in 3 d", tone: "neutral", expired: false });
    expect(holdStatus(new Date("2026-09-22T00:00:00Z"), today)).toMatchObject({ days: 1, text: "expires tomorrow", tone: "neutral", expired: false });
    expect(holdStatus(new Date("2026-09-21T00:00:00Z"), today)).toMatchObject({ days: 0, text: "expires today", tone: "accent", expired: false });
    expect(holdStatus(new Date("2026-09-19T00:00:00Z"), today)).toMatchObject({ days: -2, text: "expired 2 d ago", tone: "accent", expired: true });
  });
});

describe("the sweep gate", () => {
  it("is due at start and then hourly", () => {
    const now = new Date("2026-09-21T03:00:00Z");
    expect(expireDue(null, now)).toBe(true);
    expect(expireDue(new Date("2026-09-21T02:30:00Z"), now)).toBe(false);
    expect(expireDue(new Date("2026-09-21T01:59:00Z"), now)).toBe(true);
  });
});

describe("reservation tabs (moved from the server module)", () => {
  it("falls back to ACTIVE for anything unknown", () => {
    expect(parseReservationTab("CLOSED")).toBe("CLOSED");
    expect(parseReservationTab("nope")).toBe("ACTIVE");
    expect(parseReservationTab(null)).toBe("ACTIVE");
  });
});

describe("the /reservations list config", () => {
  const empty = { q: "", page: 1, sort: [], filters: {} };
  it("declares the two facets and four sort keys, expiring-first by default", () => {
    expect(HOLDS_LIST_CONFIG).toEqual({ facets: ["employee", "department"], sortable: ["expiresAt", "createdAt", "employee", "tag"], defaultSort: [{ key: "expiresAt", dir: "asc" }] });
  });
  it("scopes the where to the tab's states and layers search and facets on top", () => {
    expect(buildHoldWhere("CLOSED", empty)).toEqual({ state: { in: ["RELEASED", "EXPIRED"] } });
    const w = buildHoldWhere("ACTIVE", { ...empty, q: "nina", filters: { employee: ["e1"], department: ["d1"] } });
    expect(w.state).toEqual({ in: ["ACTIVE"] });
    expect(w.employeeId).toEqual({ in: ["e1"] });
    expect(w.employee).toEqual({ departmentId: { in: ["d1"] } });
    expect(w.OR).toEqual([
      { asset: { tag: { contains: "nina", mode: "insensitive" } } },
      { asset: { model: { contains: "nina", mode: "insensitive" } } },
      { employee: { name: { contains: "nina", mode: "insensitive" } } },
      { employee: { employeeNo: { contains: "nina", mode: "insensitive" } } },
    ]);
  });
  it("orders by the chosen key with nulls last on expiry and an id tiebreak", () => {
    expect(buildHoldOrderBy([])).toEqual([{ expiresAt: { sort: "asc", nulls: "last" } }, { id: "asc" }]);
    expect(buildHoldOrderBy([{ key: "employee", dir: "desc" }])).toEqual([{ employee: { name: "desc" } }, { id: "asc" }]);
    expect(buildHoldOrderBy([{ key: "tag", dir: "asc" }, { key: "createdAt", dir: "desc" }])).toEqual([{ asset: { tag: "asc" } }, { createdAt: "desc" }, { id: "asc" }]);
  });
});
