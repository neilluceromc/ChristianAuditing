import { describe, expect, it } from "vitest";
import { auditSentence } from "./activity";
import { actionDot } from "@/components/patterns/activity-feed";

const base = { actorLabel: "J. Sarmiento", action: "update", diff: null as unknown, entityLabel: "BR-LT-0148" };

describe("auditSentence — subject-first, one sentence (README 4b)", () => {
  it("update names the fields", () => {
    expect(auditSentence({ ...base, diff: { status: { from: "SPARE", to: "DEPLOYED" }, assignee: { from: null, to: "EMP-0042" } } }))
      .toBe("J. Sarmiento updated status, assignee on BR-LT-0148");
  });
  it("create reads as registration", () => {
    expect(auditSentence({ ...base, action: "create" })).toBe("J. Sarmiento created BR-LT-0148");
  });
  it("SECRET_READ is called out plainly", () => {
    expect(auditSentence({ ...base, action: "SECRET_READ", diff: { label: { from: null, to: "bios" } } }))
      .toBe("J. Sarmiento revealed the secret \"bios\" on BR-LT-0148");
  });
  it("approval.requested names the ref", () => {
    expect(auditSentence({ ...base, action: "approval.requested", diff: { approval: { from: null, to: "APR-2042" } } }))
      .toBe("J. Sarmiento requested APR-2042 on BR-LT-0148");
  });
  it("register reads as registration, not the raw verb", () => {
    expect(auditSentence({ ...base, action: "register" })).toBe("J. Sarmiento registered BR-LT-0148");
  });
  it("finance.confirm says what was confirmed", () => {
    expect(auditSentence({ ...base, action: "finance.confirm", diff: { financeConfirmed: { from: null, to: "M. Cruz" } } }))
      .toBe("J. Sarmiento confirmed BR-LT-0148's details");
  });
  it("it.verify reads as IT's check, not the raw verb", () => {
    expect(auditSentence({ ...base, action: "it.verify", diff: { itVerified: { from: null, to: "R. Bautista" } } }))
      .toBe("J. Sarmiento checked BR-LT-0148");
  });
  it("Phase 15 direct actions read as sentences", () => {
    const base = { actorLabel: "J. Sarmiento", entityLabel: "BR-LT-0148" };
    expect(auditSentence({ ...base, action: "lifecycle.assign", diff: { assignee: { from: null, to: "EMP-0097" } } }))
      .toBe("J. Sarmiento assigned BR-LT-0148 to EMP-0097");
    expect(auditSentence({ ...base, action: "lifecycle.return", diff: { status: { from: "DEPLOYED", to: "SPARE" }, returnedAt: { from: null, to: "x" } } }))
      .toBe("J. Sarmiento returned BR-LT-0148 for triage");
    expect(auditSentence({ ...base, action: "lifecycle.return", diff: { status: { from: "DEPLOYED", to: "MISSING" } } }))
      .toBe("J. Sarmiento returned BR-LT-0148 as MISSING");
    expect(auditSentence({ ...base, action: "lifecycle.change-status", diff: { status: { from: "SPARE", to: "DEFECTIVE" } } }))
      .toBe("J. Sarmiento changed BR-LT-0148 to DEFECTIVE");
    expect(auditSentence({ ...base, action: "lifecycle.replace", diff: { replacedBy: { from: null, to: "BR-LT-0201" } } }))
      .toBe("J. Sarmiento replaced BR-LT-0148 with BR-LT-0201");
    expect(auditSentence({
      ...base, entityLabel: "BR-LT-0201", action: "lifecycle.replace",
      diff: { replaces: { from: null, to: "BR-LT-0148" }, assignee: { from: null, to: "EMP-0097" } },
    })).toBe("J. Sarmiento put BR-LT-0201 in place of BR-LT-0148 for EMP-0097");
    expect(auditSentence({ ...base, action: "lifecycle.triage", diff: { triage: { from: null, to: "Keep as spare" } } }))
      .toBe("J. Sarmiento triaged BR-LT-0148: Keep as spare");
  });
  it("finance.return carries the reason — the reason IS the record", () => {
    expect(auditSentence({ ...base, action: "finance.return", diff: { financeReturn: { from: null, to: "Serial does not match the box" } } }))
      .toBe("J. Sarmiento sent BR-LT-0148 back to IT \u00b7 Serial does not match the box");
  });
  it("finance.return without a reason does not render a dangling separator", () => {
    expect(auditSentence({ ...base, action: "finance.return" })).toBe("J. Sarmiento sent BR-LT-0148 back to IT");
  });
  it("finance.resubmit reads as IT handing it back", () => {
    expect(auditSentence({ ...base, action: "finance.resubmit" }))
      .toBe("J. Sarmiento marked BR-LT-0148 corrected for Finance");
  });
  it("unknown actions degrade to actor — action — entity", () => {
    expect(auditSentence({ ...base, action: "document.signed" })).toBe("J. Sarmiento document.signed BR-LT-0148");
  });
  it("import-create reads as an import, not a plain registration", () => {
    expect(auditSentence({ ...base, action: "import-create" })).toBe("J. Sarmiento imported BR-LT-0148");
  });
  it("import-create names the status when the import created an asset already SPARE, silently (no suffix)", () => {
    expect(
      auditSentence({ ...base, action: "import-create", diff: { status: { from: null, to: "SPARE" } } }),
    ).toBe("J. Sarmiento imported BR-LT-0148");
  });
  it("import-create names a non-SPARE status — A-5's recorded fact, finally shown where it matters (I-6)", () => {
    // Scope decision 13: import is the one surface that can create an asset
    // already DEPLOYED to a holder with no approval. Without this, that
    // asset's row on /inventory/activity reads identically to an imported
    // SPARE, which is the exact gap A-5 (recording `status` in the diff) was
    // supposed to close but didn't, on its own, actually close.
    expect(
      auditSentence({ ...base, action: "import-create", diff: { status: { from: null, to: "DEPLOYED" } } }),
    ).toBe("J. Sarmiento imported BR-LT-0148 as DEPLOYED");
  });
  it("import-create names a non-ACTIVE employment the same way it names a non-SPARE status (Task 12)", () => {
    expect(
      auditSentence({
        ...base, action: "import-create", entityLabel: "Nina Robles",
        diff: { employment: { from: null, to: "OFFBOARDING" } },
      }),
    ).toBe("J. Sarmiento imported Nina Robles as OFFBOARDING");
  });

  it("import-create names an employee created ACTIVE silently (no suffix)", () => {
    expect(
      auditSentence({
        ...base, action: "import-create", entityLabel: "Nina Robles",
        diff: { employment: { from: null, to: "ACTIVE" } },
      }),
    ).toBe("J. Sarmiento imported Nina Robles");
  });

  it("import-update names the fields and says it was by import", () => {
    expect(
      auditSentence({
        ...base,
        action: "import-update",
        diff: { model: { from: "Old", to: "New" }, cost: { from: 100, to: 200 } },
      }),
    ).toBe("J. Sarmiento updated model, cost on BR-LT-0148 by import");
  });
  it("names the purchase transitions in the language of the handoff", () => {
    const pr = { ...base, actorLabel: "P. Reyes", entityLabel: "PR-0198", diff: null as unknown };
    expect(auditSentence({ ...pr, action: "submit" })).toBe("P. Reyes submitted PR-0198 for IT review");
    expect(auditSentence({ ...pr, action: "it-review" })).toBe("P. Reyes marked PR-0198 IT-reviewed");
    expect(auditSentence({ ...pr, action: "it-reject" })).toBe("P. Reyes sent PR-0198 back to purchasing");
    expect(auditSentence({ ...pr, action: "request-info" })).toBe("P. Reyes sent PR-0198 back for more information");
    expect(auditSentence({ ...pr, action: "cancel" })).toBe("P. Reyes cancelled PR-0198");
    expect(auditSentence({ ...pr, action: "complete" })).toBe("P. Reyes completed PR-0198");
    expect(auditSentence({ ...pr, action: "comment" })).toBe("P. Reyes commented on PR-0198");
    expect(auditSentence({ ...pr, action: "unit-update" })).toBe("P. Reyes updated a unit on PR-0198");
  });
});

describe("offboarding.completed", () => {
  it("reads as a sentence and counts what was settled, not as a raw action name", () => {
    expect(auditSentence({
      actorLabel: "J. Sarmiento",
      action: "offboarding.completed",
      diff: { decisions: { from: null, to: ["APR-2043 · RETURNED · EXECUTED", "APR-2044 · MISSING · PENDING"] } },
      entityLabel: "Dennis Ong",
    })).toBe("J. Sarmiento completed offboarding for Dennis Ong · 2 items settled");
  });

  it("degrades without a decision list", () => {
    expect(auditSentence({
      actorLabel: "J. Sarmiento", action: "offboarding.completed", diff: null, entityLabel: "Dennis Ong",
    })).toBe("J. Sarmiento completed offboarding for Dennis Ong");
  });
});

describe("stock module audit sentences (M-3) — the twelve actions no longer fall to the raw-verb default", () => {
  const item = { actorLabel: "A. Reyes", entityLabel: "OS-0002 · Ballpen black" };
  const category = { actorLabel: "A. Reyes", entityLabel: "Pantry" };
  const stocktake = { actorLabel: "A. Reyes", entityLabel: "ST-0007" };

  it("stock.item.created reads as a plain create, the code · name label carries the rest", () => {
    expect(auditSentence({ ...item, action: "stock.item.created", diff: { code: { from: null, to: "OS-0002" }, name: { from: null, to: "Ballpen black" } } }))
      .toBe("A. Reyes created OS-0002 · Ballpen black");
  });
  it("stock.item.updated names the changed fields", () => {
    expect(auditSentence({ ...item, action: "stock.item.updated", diff: { reorderLevel: { from: 10, to: 20 } } }))
      .toBe("A. Reyes updated reorderLevel on OS-0002 · Ballpen black");
  });
  it("stock.item.archived / restored", () => {
    expect(auditSentence({ ...item, action: "stock.item.archived", diff: { archived: { from: false, to: true } } }))
      .toBe("A. Reyes archived OS-0002 · Ballpen black");
    expect(auditSentence({ ...item, action: "stock.item.restored", diff: { archived: { from: true, to: false } } }))
      .toBe("A. Reyes restored OS-0002 · Ballpen black");
  });
  it("stock.category.created/updated/archived/restored name the category explicitly", () => {
    expect(auditSentence({ ...category, action: "stock.category.created", diff: { name: { from: null, to: "Pantry" }, prefix: { from: null, to: "PN" } } }))
      .toBe("A. Reyes created the category Pantry");
    expect(auditSentence({ ...category, action: "stock.category.updated", diff: { name: { from: "Pantry", to: "Kitchen" } } }))
      .toBe("A. Reyes updated name on the category Pantry");
    expect(auditSentence({ ...category, action: "stock.category.archived", diff: { archived: { from: false, to: true } } }))
      .toBe("A. Reyes archived the category Pantry");
    expect(auditSentence({ ...category, action: "stock.category.restored", diff: { archived: { from: true, to: false } } }))
      .toBe("A. Reyes restored the category Pantry");
  });
  it("stock.received names the quantity", () => {
    expect(auditSentence({ ...item, action: "stock.received", diff: { quantity: { from: null, to: 60 }, lot: { from: null, to: "PO-4021" } } }))
      .toBe("A. Reyes received 60 of OS-0002 · Ballpen black");
  });
  it("stock.issued recovers the issued quantity from the before/after balance and names the department", () => {
    expect(auditSentence({ ...item, action: "stock.issued", diff: { quantity: { from: 40, to: 35 }, department: { from: null, to: "HR" } } }))
      .toBe("A. Reyes issued 5 of OS-0002 · Ballpen black to HR");
  });
  it("stock.adjusted names the signed delta (real minus for a decrease) and the reason", () => {
    expect(auditSentence({ ...item, action: "stock.adjusted", diff: { balance: { from: 40, to: 38 }, reason: { from: null, to: "Damaged in storage" } } }))
      .toBe("A. Reyes adjusted OS-0002 · Ballpen black by −2 · Damaged in storage");
    expect(auditSentence({ ...item, action: "stock.adjusted", diff: { balance: { from: 40, to: 44 }, reason: { from: null, to: "Recount" } } }))
      .toBe("A. Reyes adjusted OS-0002 · Ballpen black by +4 · Recount");
  });
  it("stocktake.opened names the scope and the line count", () => {
    expect(auditSentence({ ...stocktake, action: "stocktake.opened", diff: { scope: { from: null, to: "Pantry" }, lines: { from: null, to: 4 } } }))
      .toBe("A. Reyes opened ST-0007 for Pantry · 4 items");
    expect(auditSentence({ ...stocktake, action: "stocktake.opened", diff: { scope: { from: null, to: "All categories" }, lines: { from: null, to: 1 } } }))
      .toBe("A. Reyes opened ST-0007 for All categories · 1 item");
  });
  it("stocktake.posted names how many were adjusted vs. left uncounted", () => {
    expect(auditSentence({ ...stocktake, action: "stocktake.posted", diff: { adjusted: { from: null, to: 2 }, skipped: { from: null, to: 1 } } }))
      .toBe("A. Reyes posted ST-0007 · 2 adjusted, 1 not counted");
  });
  it("stocktake.cancelled reads as a sentence, not the raw verb", () => {
    expect(auditSentence({ ...stocktake, action: "stocktake.cancelled", diff: null })).toBe("A. Reyes cancelled the stocktake ST-0007");
  });
});

describe("actionDot — import actions get a deliberate, explicit colour", () => {
  it("import-create settles the same way a manual create does", () => {
    expect(actionDot("import-create")).toBe("DEPLOYED");
  });
  it("import-update is explicitly neutral — the same dot a hand-typed update gets (I-5)", () => {
    // A negative assertion (`.not.toBe("SPARE")`) would pass on ANY other
    // value and would have blocked this very correction: round one's
    // instruction was to make this NOT SPARE, on the false premise that
    // falling through read as "nothing happened". It does not — SPARE is
    // what plain "update" already gets, and giving an import-driven edit a
    // different (settled/green) dot than the identical hand-typed edit is
    // the actual defect. Asserted exactly, both ways:
    expect(actionDot("import-update")).toBe("SPARE");
    expect(actionDot("import-update")).toBe(actionDot("update"));
  });
});

describe("actionDot — Phase 12's asset actions are explicit, not left to the neutral default", () => {
  // Same reasoning as import-create's branch: an asset coming into existence
  // settles, however it got here. Asserted against create rather than the
  // literal so the two cannot drift apart silently.
  it("register settles the same way a manual create does", () => {
    expect(actionDot("register")).toBe(actionDot("create"));
  });
  it("finance.confirm settles", () => {
    expect(actionDot("finance.confirm")).toBe("COMPLETED");
  });
  it("finance.return reads as attention — it came back, exactly like it-reject", () => {
    expect(actionDot("finance.return")).toBe("PENDING");
    expect(actionDot("finance.return")).toBe(actionDot("it-reject"));
  });
  it("finance.resubmit reads as in flight, exactly like submit", () => {
    expect(actionDot("finance.resubmit")).toBe("SUBMITTED");
    expect(actionDot("finance.resubmit")).toBe(actionDot("submit"));
  });
});
