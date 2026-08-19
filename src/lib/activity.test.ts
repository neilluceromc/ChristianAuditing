import { describe, expect, it } from "vitest";
import { auditSentence } from "./activity";

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
  it("unknown actions degrade to actor — action — entity", () => {
    expect(auditSentence({ ...base, action: "document.signed" })).toBe("J. Sarmiento document.signed BR-LT-0148");
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

describe("equipment policies — entry criterion #6 (both slot lists in the diff)", () => {
  const finance = { actorLabel: "Neil Lucero", entityLabel: "Finance standard" };

  it("delete reads the policy name out of the diff, not a lookup (the row is gone by then)", () => {
    expect(auditSentence({
      ...finance,
      action: "delete",
      diff: {
        name: { from: "Finance standard", to: null },
        slots: { from: ["laptop · Laptop · required"], to: null },
      },
    })).toBe("Neil Lucero deleted Finance standard");
  });

  it("delete degrades to the entity label if the diff carries no name", () => {
    expect(auditSentence({ ...finance, action: "delete", diff: null }))
      .toBe("Neil Lucero deleted Finance standard");
  });

  it("policy.slot.added names the slot that appeared", () => {
    expect(auditSentence({
      ...finance,
      action: "policy.slot.added",
      diff: {
        slots: {
          from: ["laptop · Laptop · required"],
          to: ["laptop · Laptop · required", "webcam · Webcam · required"],
        },
      },
    })).toBe('Neil Lucero added the "webcam" slot to Finance standard');
  });

  it("policy.slot.removed names the slot that disappeared", () => {
    expect(auditSentence({
      ...finance,
      action: "policy.slot.removed",
      diff: {
        slots: {
          from: ["laptop · Laptop · required", "webcam · Webcam · required"],
          to: ["laptop · Laptop · required"],
        },
      },
    })).toBe('Neil Lucero removed the "webcam" slot from Finance standard');
  });

  it("policy.slot.changed names the slot whose required flag flipped", () => {
    expect(auditSentence({
      ...finance,
      action: "policy.slot.changed",
      diff: {
        slots: {
          from: ["second monitor · Monitor · optional"],
          to: ["second monitor · Monitor · required"],
        },
      },
    })).toBe('Neil Lucero changed the "second monitor" slot on Finance standard');
  });

  it("slot actions degrade without a usable diff", () => {
    expect(auditSentence({ ...finance, action: "policy.slot.added", diff: null }))
      .toBe("Neil Lucero added a slot to Finance standard");
    expect(auditSentence({ ...finance, action: "policy.slot.removed", diff: null }))
      .toBe("Neil Lucero removed a slot from Finance standard");
    expect(auditSentence({ ...finance, action: "policy.slot.changed", diff: null }))
      .toBe("Neil Lucero changed a slot on Finance standard");
  });
});
