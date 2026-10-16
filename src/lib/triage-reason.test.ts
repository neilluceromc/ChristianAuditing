import { describe, expect, it } from "vitest";
import { TRIAGE_OUTCOMES, triageInputSchema, triageNeedsReason, triageReasonValid } from "./lifecycle";
import { REASON_CHIPS, chipsForTriage, reasonAfterSwitch } from "./reason-chips";

describe("triage reason (Phase 40 §8)", () => {
  it("only Dispose and Donate need a reason", () => {
    expect(TRIAGE_OUTCOMES.filter(triageNeedsReason)).toEqual(["DISPOSE", "DONATED"]);
  });

  it("Dispose and Donate refuse an empty, blank or 1-character reason", () => {
    for (const outcome of ["DISPOSE", "DONATED"] as const) {
      expect(triageReasonValid(outcome, "")).toBe(false);
      expect(triageReasonValid(outcome, undefined)).toBe(false);
      expect(triageReasonValid(outcome, "   ")).toBe(false);
      expect(triageReasonValid(outcome, "x")).toBe(false);
      // an invisible-only paste reads as empty (cleanReason)
      expect(triageReasonValid(outcome, "\u200B\u200Bx")).toBe(false);
    }
  });

  it("Dispose and Donate accept 2 characters or a chip", () => {
    expect(triageReasonValid("DISPOSE", "ok")).toBe(true);
    expect(triageReasonValid("DONATED", " ok ")).toBe(true);
    for (const chip of chipsForTriage("DISPOSE")) expect(triageReasonValid("DISPOSE", chip)).toBe(true);
    for (const chip of chipsForTriage("DONATED")) expect(triageReasonValid("DONATED", chip)).toBe(true);
  });

  it("Keep as spare and Send to repair need none", () => {
    expect(triageReasonValid("SPARE", "")).toBe(true);
    expect(triageReasonValid("DEFECTIVE", undefined)).toBe(true);
  });

  it("each decision offers the chips that fit it (the spec's three between them)", () => {
    expect(chipsForTriage("DISPOSE")).toEqual(["Beyond repair", "Obsolete"]);
    expect(chipsForTriage("DONATED")).toEqual(["Donated to staff/charity", "Obsolete"]);
    expect(chipsForTriage("SPARE")).toEqual([]);
    expect(chipsForTriage("DEFECTIVE")).toEqual([]);
    expect(chipsForTriage("")).toEqual([]);
    expect(REASON_CHIPS["asset.dispose"]).toBe(chipsForTriage("DISPOSE"));
  });
});

describe("reasonAfterSwitch (Phase 40 §8)", () => {
  const dispose = chipsForTriage("DISPOSE");
  const donate = chipsForTriage("DONATED");
  it("clears a chip the new decision does not offer", () => {
    expect(reasonAfterSwitch("Beyond repair", dispose, donate)).toBe("");
    expect(reasonAfterSwitch("Donated to staff/charity", donate, dispose)).toBe("");
    expect(reasonAfterSwitch("Obsolete", dispose, [])).toBe("");
  });
  it("keeps a chip both decisions offer", () => {
    expect(reasonAfterSwitch("Obsolete", dispose, donate)).toBe("Obsolete");
  });
  it("keeps anything typed", () => {
    expect(reasonAfterSwitch("Screen cracked, board dead", dispose, donate)).toBe("Screen cracked, board dead");
    expect(reasonAfterSwitch("Beyond repair, says vendor", dispose, [])).toBe("Beyond repair, says vendor");
  });
});

describe("triageInputSchema (the server action's zod)", () => {
  const base = { assetId: "a1" };

  it("refuses a missing decision — there is no default", () => {
    const r = triageInputSchema.safeParse({ ...base, note: "" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toEqual(["outcome"]);
    expect(triageInputSchema.safeParse({ ...base, outcome: "" }).success).toBe(false);
  });

  it("refuses Dispose without a reason, on the note field", () => {
    const r = triageInputSchema.safeParse({ ...base, outcome: "DISPOSE" });
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.path)).toEqual([["note"]]);
    expect(r.error?.issues[0].message).toBe("Give a reason (at least 2 characters)");
    expect(triageInputSchema.safeParse({ ...base, outcome: "DONATED", note: " a " }).success).toBe(false);
  });

  it("accepts Donate with a chip and cleans the note", () => {
    const r = triageInputSchema.safeParse({ ...base, outcome: "DONATED", note: "  Donated to staff/charity\u200B " });
    expect(r.success).toBe(true);
    expect(r.data?.note).toBe("Donated to staff/charity");
  });

  it("accepts Keep as spare with no note", () => {
    expect(triageInputSchema.safeParse({ ...base, outcome: "SPARE" }).success).toBe(true);
  });

  it("caps the note at 500 characters", () => {
    expect(triageInputSchema.safeParse({ ...base, outcome: "DISPOSE", note: "x".repeat(501) }).success).toBe(false);
  });
});
