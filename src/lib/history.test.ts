import { describe, expect, it } from "vitest";
import { emptyNames, formatHistoryValue, historyEntries, historyFieldLabel, historyNameIds, historyRows, timelinePhrase, type HistoryNames } from "./history";

const at = new Date("2026-08-16T09:41:00Z");
const names: HistoryNames = {
  category: new Map([["cat1", "Laptop"]]),
  type: new Map([["typ1", "Ultrabook"]]),
  vendor: new Map([["ven1", "Acme Supply"]]),
  // the page keys employees by id AND employee number (lifecycle audits record the number)
  employee: new Map([["emp1", "Nina Robles"], ["EMP-0097", "Nina Robles"]]),
};

describe("historyRows — one row per FIELD, not per save (README 7c)", () => {
  it("expands a multi-field diff into rows sharing the entry timestamp, with labels in words", () => {
    const rows = historyRows([{
      id: "e1", actorLabel: "J. Sarmiento", action: "update", createdAt: at,
      diff: { status: { from: "SPARE", to: "DEPLOYED" }, assignee: { from: null, to: "EMP-0097" } },
    }], names);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ field: "Status", from: "Spare", to: "Deployed", first: true, action: "Updated" });
    expect(rows[1]).toMatchObject({ field: "Holder", from: "—", to: "Nina Robles", first: false });
    expect(rows[0].at).toEqual(at);
  });
  it("renders diff-less entries (SECRET_READ) as a single action row with the action's label", () => {
    const rows = historyRows([{ id: "e2", actorLabel: "System Admin", action: "SECRET_READ", createdAt: at, diff: null }], emptyNames());
    expect(rows).toEqual([
      { key: "e2", at, actor: "System Admin", action: "Secret read", field: "—", from: "—", to: "—", first: true },
    ]);
  });
  it("stringifies values and blanks nullish to —", () => {
    const rows = historyRows([{ id: "e3", actorLabel: "x", action: "update", createdAt: at, diff: { cost: { from: 55000, to: null } } }], emptyNames());
    expect(rows[0]).toMatchObject({ field: "Cost", from: "55000", to: "—" });
  });
  it("Worklist H4: a triage's version and its undo's reference are never rows of their own", () => {
    const rows = historyRows([{
      id: "e5", actorLabel: "x", action: "lifecycle.triage", createdAt: at,
      diff: { triage: { from: null, to: "Keep as spare" }, version: { from: null, to: at.toISOString() }, undoes: { from: null, to: "e1" } },
    }], emptyNames());
    expect(rows.map((r) => r.field)).toEqual(["Triage"]);
  });
  it("shows an unmapped action as its own code", () => {
    const rows = historyRows([{ id: "e4", actorLabel: "x", action: "something.new", createdAt: at, diff: null }], emptyNames());
    expect(rows[0].action).toBe("something.new");
  });
});

describe("historyEntries — one group per audit entry, newest first as given", () => {
  it("keeps each entry's field rows together and in order", () => {
    const groups = historyEntries([
      { id: "e1", actorLabel: "A", action: "update", createdAt: at, diff: { a: { from: 1, to: 2 }, b: { from: 1, to: 2 }, c: { from: 1, to: 2 }, d: { from: 1, to: 2 } } },
      { id: "e2", actorLabel: "B", action: "SECRET_READ", createdAt: at, diff: null },
    ], emptyNames());
    expect(groups.map((g) => g.key)).toEqual(["e1", "e2"]);
    expect(groups[0].fields.map((f) => f.field)).toEqual(["A", "B", "C", "D"]);
    expect(groups[1].fields).toHaveLength(1);
    expect(groups[1]).toMatchObject({ actor: "B", action: "Secret read", at });
  });
});

describe("historyFieldLabel — the shared FIELD_LABELS, capitalised", () => {
  it("reads known keys from the table", () => {
    expect(historyFieldLabel("categoryId")).toBe("Category");
    expect(historyFieldLabel("assigneeId")).toBe("Holder");
    expect(historyFieldLabel("warrantyUntil")).toBe("Warranty end");
  });
  it("calls the lifecycle's assignee the holder", () => {
    expect(historyFieldLabel("assignee")).toBe("Holder");
  });
  it("labels triage's reason and note apart (Phase 40 §8)", () => {
    expect(historyFieldLabel("reason")).toBe("Reason");
    expect(historyFieldLabel("note")).toBe("Note");
  });
  it("splits an unknown camelCase key into words", () => {
    expect(historyFieldLabel("repairEndedAt")).toBe("Repair ended at");
  });
});

describe("formatHistoryValue", () => {
  const f = (key: string, v: unknown) => formatHistoryValue(key, v, names);

  it("turns category, type, vendor and holder ids into names", () => {
    expect(f("categoryId", "cat1")).toBe("Laptop");
    expect(f("typeId", "typ1")).toBe("Ultrabook");
    expect(f("vendorId", "ven1")).toBe("Acme Supply");
    expect(f("assigneeId", "emp1")).toBe("Nina Robles");
  });
  it("resolves the lifecycle's assignee by employee number, or by id", () => {
    expect(f("assignee", "EMP-0097")).toBe("Nina Robles");
    expect(f("assignee", "emp1")).toBe("Nina Robles");
  });
  it("names a reservation's hold, and keeps an unresolved one as written", () => {
    expect(f("hold", "EMP-0097")).toBe("Nina Robles");
    expect(f("hold", "EMP-0001")).toBe("EMP-0001");
    expect(f("hold", null)).toBe("—");
  });
  it("shows (removed) for an id that no longer exists", () => {
    expect(f("categoryId", "gone")).toBe("(removed)");
    expect(f("typeId", "gone")).toBe("(removed)");
    expect(f("vendorId", "gone")).toBe("(removed)");
    expect(f("assigneeId", "gone")).toBe("(removed)");
  });
  it("keeps an unresolved lifecycle assignee as written (it is an employee number or a name already)", () => {
    expect(f("assignee", "EMP-0001")).toBe("EMP-0001");
  });
  it("blanks null, empty and undefined to —, including for id keys", () => {
    expect(f("cost", null)).toBe("—");
    expect(f("notes", "")).toBe("—");
    expect(f("notes", undefined)).toBe("—");
    expect(f("categoryId", null)).toBe("—");
    expect(f("assigneeId", "")).toBe("—");
  });
  it("shows booleans as Yes / No", () => {
    expect(f("financeNotCapitalised", true)).toBe("Yes");
    expect(f("financeNotCapitalised", false)).toBe("No");
  });
  it("shows a date-only value as d MMM yyyy", () => {
    expect(f("purchasedAt", "2026-01-05T00:00:00.000Z")).toBe("5 Jan 2026");
    expect(f("purchasedAt", "2026-01-05")).toBe("5 Jan 2026");
    expect(f("warrantyUntil", new Date("2027-03-31T00:00:00Z"))).toBe("31 Mar 2027");
  });
  it("shows a timestamp in Asia/Manila with HH:mm", () => {
    // 09:41Z is 17:41 in Manila
    expect(f("returnedAt", "2026-08-16T09:41:00.000Z")).toBe("16 Aug 2026 17:41");
    expect(f("returnedAt", at)).toBe("16 Aug 2026 17:41");
    // 20:00Z is already the next day in Manila
    expect(f("returnedAt", "2026-08-16T20:00:00Z")).toBe("17 Aug 2026 04:00");
  });
  it("only reads dates under date-like keys: a serial or name that equals a date is left as written", () => {
    expect(f("serial", "2026-01-05")).toBe("2026-01-05");
    expect(f("model", "2026-01-05T09:41:00Z")).toBe("2026-01-05T09:41:00Z");
    expect(f("loanDueAt", "2026-01-05")).toBe("5 Jan 2026");
    expect(f("defectiveSince", "2026-01-05")).toBe("5 Jan 2026");
  });
  it("leaves a string that only looks a little like a date alone", () => {
    expect(f("purchasedAt", "2026-13-45")).toBe("2026-13-45");
    expect(f("serial", "2026-13-45")).toBe("2026-13-45");
    expect(f("serial", "SN-2026-01-05")).toBe("SN-2026-01-05");
  });
  it("shows numbers and plain strings as written", () => {
    expect(f("cost", 55000)).toBe("55000");
    expect(f("model", "DEPLOYED")).toBe("DEPLOYED");
    expect(f("cost", 0)).toBe("0");
  });
  it("Phase 40 §6: a status reads as its word (Loan, not TEMPORARY), employment as its word; unknown values as written", () => {
    expect(f("status", "DEPLOYED")).toBe("Deployed");
    expect(f("status", "TEMPORARY")).toBe("Loan");
    expect(f("status", "SOMETHING_NEW")).toBe("SOMETHING_NEW");
    expect(f("employment", "OFFBOARDING")).toBe("Leaving");
    expect(f("employment", "ACTIVE")).toBe("Active");
  });
  it("shows the Finance send-back as its checklist labels, a dash, then the note", () => {
    expect(f("financeReturn", { fields: ["Cost", "Sales invoice"], note: "Invoice is for another PO" }))
      .toBe("Cost, Sales invoice — Invoice is for another PO");
    expect(f("financeReturn", { fields: ["Cost"], note: null })).toBe("Cost");
    expect(f("financeReturn", { fields: [], note: "Wrong PO" })).toBe("Wrong PO");
    expect(f("financeReturn", { fields: [], note: "" })).toBe("—");
  });
  it("Task 6's send-back also names the team it went to — still its labels and note, never key: value pairs", () => {
    expect(f("financeReturn", { fields: ["Cost", "Sales invoice"], note: "Invoice is for another PO", team: "IT" }))
      .toBe("Cost, Sales invoice — Invoice is for another PO · to IT");
    expect(f("financeReturn", { fields: ["Serial number"], note: null, team: "PURCHASING" })).toBe("Serial number · to Purchasing");
    expect(f("financeReturn", { fields: [], note: "", team: "IT" })).toBe("to IT");
  });
  it("shows any other object as key: value pairs and never [object Object]", () => {
    expect(f("lines", { qty: 2, ready: true })).toBe("qty: 2; ready: Yes");
    expect(f("lines", { startsAt: "2026-01-05T00:00:00Z", who: null })).toBe("startsAt: 5 Jan 2026; who: —");
    expect(f("lines", { inner: { a: 1 } })).not.toContain("[object Object]");
    expect(f("lines", {})).toBe("—");
  });
  it("shows an array as a comma list", () => {
    expect(f("decisions", ["a", "b"])).toBe("a, b");
    expect(f("decisions", [])).toBe("—");
  });
  it("renders an unknown key's value like any other", () => {
    expect(f("brandNewField", "x")).toBe("x");
  });
});

describe("historyNameIds — the ids a page has to resolve", () => {
  it("collects each kind's from and to, once", () => {
    const ids = historyNameIds([
      { id: "e1", actorLabel: "A", action: "update", createdAt: at, diff: { categoryId: { from: "c1", to: "c2" }, typeId: { from: null, to: "t1" }, vendorId: { from: "v1", to: "v1" } } },
      { id: "e2", actorLabel: "A", action: "update", createdAt: at, diff: { assigneeId: { from: "m1", to: "m2" }, categoryId: { from: "c2", to: "c3" } } },
      { id: "e3", actorLabel: "A", action: "lifecycle.assign", createdAt: at, diff: { assignee: { from: null, to: "EMP-0097" } } },
    ]);
    expect(ids.category.sort()).toEqual(["c1", "c2", "c3"]);
    expect(ids.type).toEqual(["t1"]);
    expect(ids.vendor).toEqual(["v1"]);
    expect(ids.employee.sort()).toEqual(["EMP-0097", "m1", "m2"]);
  });
  it("collects a reservation's hold as an employee", () => {
    const ids = historyNameIds([
      { id: "e1", actorLabel: "A", action: "reservation.placed", createdAt: at, diff: { hold: { from: null, to: "EMP-0097" } } },
      { id: "e2", actorLabel: "A", action: "reservation.released", createdAt: at, diff: { hold: { from: "EMP-0097", to: null } } },
    ]);
    expect(ids.employee).toEqual(["EMP-0097"]);
  });
  it("ignores non-string values, diff-less entries and unrelated keys", () => {
    const ids = historyNameIds([
      { id: "e1", actorLabel: "A", action: "SECRET_READ", createdAt: at, diff: null },
      { id: "e2", actorLabel: "A", action: "update", createdAt: at, diff: { cost: { from: 1, to: 2 }, categoryId: { from: 5, to: "" } } },
    ]);
    expect(ids).toEqual({ category: [], type: [], vendor: [], employee: [] });
  });
});

describe("timelinePhrase — a timeline row's words", () => {
  const emps = new Map([["EMP-0097", "Nina Robles"]]);
  const e = (action: string, diff: unknown) => ({ actorLabel: "J. Sarmiento", action, diff });
  it("reads an assignment with the holder's name, without the actor or the tag", () => {
    expect(timelinePhrase(e("lifecycle.assign", { assignee: { from: null, to: "EMP-0097" } }), "BR-LT-0148", emps))
      .toBe("assigned to Nina Robles");
  });
  it("names the person a hold was placed for", () => {
    expect(timelinePhrase(e("reservation.placed", { hold: { from: null, to: "EMP-0097" }, expiresAt: { from: null, to: "2026-08-23T00:00:00.000Z" } }), "BR-HS-0502", emps))
      .toMatch(/^reserved for Nina Robles until /);
  });
  it("says when a change came through Cris, and still words an unknown action", () => {
    const via = { via: { from: null, to: "Cris" } };
    expect(timelinePhrase(e("lifecycle.assign", { assignee: { from: null, to: "EMP-0097" }, ...via }), "BR-LT-0148", emps))
      .toBe("assigned to Nina Robles (via Cris)");
    // a labelled action with no sentence of its own still falls back to its label, never the raw code
    expect(timelinePhrase(e("rotate-secret", via), "BR-LT-0148", emps)).toBe("Webhook secret rotated (via Cris)");
  });
  it("keeps an unresolved holder as written", () => {
    expect(timelinePhrase(e("lifecycle.assign", { assignee: { from: null, to: "EMP-0001" } }), "BR-LT-0148", emps))
      .toBe("assigned to EMP-0001");
  });
  it("names the fields an update changed", () => {
    expect(timelinePhrase(e("update", { categoryId: { from: "a", to: "b" }, model: { from: "x", to: "y" } }), "BR-LT-0148", emps))
      .toBe("updated category, model");
  });
  it("reads the Finance send-back as a sentence", () => {
    expect(timelinePhrase(e("finance.return", { financeReturn: { from: null, to: { fields: ["Cost"], note: "Wrong PO" } } }), "BR-LT-0148", emps))
      .toBe("sent back: Cost — “Wrong PO”");
  });
  it("never shows a raw code for an action it has a label for", () => {
    expect(timelinePhrase(e("reservation.released", null), "BR-HS-0502", emps)).toBe("released the hold");
  });
  it("falls back to an unknown action's own code", () => {
    expect(timelinePhrase(e("something.new", null), "BR-LT-0148", emps)).toBe("something.new");
  });
});
