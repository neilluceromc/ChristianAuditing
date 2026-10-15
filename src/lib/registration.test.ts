import { describe, expect, it } from "vitest";
import {
  FIN_FILTERS, REGISTRATION_FIELDS, REG_STATES, fieldLabels, finWhere, pageAcross, parseFin, parseRegState,
  regWhere, registrationState, returnSummary,
} from "./registration";

const d = new Date("2026-10-01T00:00:00Z");
const base = { cls: "IT" as const, itVerifiedAt: d, financeConfirmedAt: null, financeReturnedAt: null };

describe("registrationState", () => {
  it("each state, in the spec's order", () => {
    expect(registrationState({ ...base, itVerifiedAt: null })).toBe("awaiting-it");
    expect(registrationState({ ...base, financeConfirmedAt: d })).toBe("registered");
    expect(registrationState({ ...base, financeReturnedAt: d })).toBe("needs-correction");
    expect(registrationState(base)).toBe("with-finance");
  });
  it("a Purchasing asset is never awaiting IT", () => {
    expect(registrationState({ ...base, cls: "PURCHASING", itVerifiedAt: null })).toBe("with-finance");
  });
  it("awaiting IT wins over everything else", () => {
    expect(registrationState({ ...base, itVerifiedAt: null, financeReturnedAt: d })).toBe("awaiting-it");
  });
  it("parses only known states", () => {
    expect(parseRegState("needs-correction")).toBe("needs-correction");
    expect(parseRegState("bogus")).toBeNull();
    expect(REG_STATES).toEqual(["needs-correction", "with-finance", "awaiting-it", "registered"]);
  });
  it("regWhere mirrors registrationState", () => {
    expect(regWhere("awaiting-it")).toEqual({ cls: "IT", itVerifiedAt: null });
    expect(regWhere("registered")).toEqual({ NOT: { cls: "IT", itVerifiedAt: null }, financeConfirmedAt: { not: null } });
    expect(regWhere("needs-correction")).toEqual({ NOT: { cls: "IT", itVerifiedAt: null }, financeConfirmedAt: null, financeReturnedAt: { not: null } });
    expect(regWhere("with-finance")).toEqual({ NOT: { cls: "IT", itVerifiedAt: null }, financeConfirmedAt: null, financeReturnedAt: null });
  });
});

describe("REGISTRATION_FIELDS", () => {
  it("unique keys, other present and last", () => {
    const keys = REGISTRATION_FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.at(-1)).toBe("other");
  });
  it("fieldLabels keeps form order and drops unknown keys", () => {
    expect(fieldLabels(["doc:invoice", "cost", "nope"])).toEqual(["Cost", "Sales invoice"]);
  });
});

describe("returnSummary (Review Focus 5)", () => {
  it("a pre-Phase-35 send-back: reason becomes the note, no items", () => {
    expect(returnSummary({ financeReturnFields: [], financeReturnReason: "Wrong invoice" })).toEqual({ items: [], note: "Wrong invoice" });
  });
  it("a checklist with no note", () => {
    expect(returnSummary({ financeReturnFields: ["cost"], financeReturnReason: null })).toEqual({ items: ["Cost"], note: null });
  });
});

describe("fin filters", () => {
  it("parse and where", () => {
    expect(FIN_FILTERS).toEqual(["with-finance", "needs-correction", "awaiting-it", "approved", "not-capitalised", "no-cost"]);
    expect(parseFin("approved")).toBe("approved");
    expect(parseFin("x")).toBeNull();
    expect(finWhere("approved")).toEqual({ ...regWhere("registered"), financeNotCapitalised: false });
    expect(finWhere("not-capitalised")).toEqual({ ...regWhere("registered"), financeNotCapitalised: true });
    expect(finWhere("no-cost")).toEqual({ cost: null });
  });
});

describe("pageAcross", () => {
  it("a page entirely inside the first group", () => {
    expect(pageAcross(30, 0, 25)).toEqual({ first: { skip: 0, take: 25 }, rest: { skip: 0, take: 0 } });
  });
  it("a page straddling both groups", () => {
    expect(pageAcross(30, 25, 25)).toEqual({ first: { skip: 25, take: 5 }, rest: { skip: 0, take: 20 } });
  });
  it("a page entirely in the rest", () => {
    expect(pageAcross(30, 50, 25)).toEqual({ first: { skip: 0, take: 0 }, rest: { skip: 20, take: 25 } });
  });
});
