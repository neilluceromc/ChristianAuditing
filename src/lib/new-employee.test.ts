import { describe, expect, it } from "vitest";
import { createdNoticeExtras, detailsMissing, firstFailure, newEmployeeExtras } from "./new-employee";

describe("newEmployeeExtras", () => {
  const base = { entraStatus: "NOT_YET", autopilotStatus: "DONE", argusStatus: "NOT_NEEDED", vpn: "None", note: "", assign: [] };
  it("accepts the defaults", () => { expect(newEmployeeExtras.safeParse(base).success).toBe(true); });
  it("refuses a repeated spare", () => {
    const r = newEmployeeExtras.safeParse({ ...base, assign: [{ assetId: "a" }, { assetId: "a" }] });
    expect(r.error?.issues[0].message).toBe("Each spare can be picked once");
  });
  it("refuses more than 20 assignments and a 2001-character note", () => {
    expect(newEmployeeExtras.safeParse({ ...base, assign: Array.from({ length: 21 }, (_, i) => ({ assetId: `a${i}` })) }).success).toBe(false);
    expect(newEmployeeExtras.safeParse({ ...base, note: "x".repeat(2001) }).success).toBe(false);
  });
  it("refuses a blank VPN name", () => {
    expect(newEmployeeExtras.safeParse({ ...base, vpn: "  " }).error?.issues[0].message).toBe("Name the VPN");
  });
  it("keeps a note of only spaces as none, and a 2000-character note", () => {
    expect(newEmployeeExtras.parse({ ...base, note: "   " }).note).toBe("");
    expect(newEmployeeExtras.safeParse({ ...base, note: "x".repeat(2000) }).success).toBe(true);
    expect(newEmployeeExtras.safeParse({ ...base, note: "x".repeat(2001) }).error?.issues[0].message).toBe("At most 2000 characters");
  });
});

describe("detailsMissing", () => {
  it("lists what step 1 still needs", () => {
    expect(detailsMissing({ name: "A", title: "", departmentId: "", employeeNo: "EMP-1", joinedAt: "2026-10-16" }))
      .toEqual(["name", "title", "departmentId"]);
  });
  it("is empty when everything is filled, and counts spaces as empty", () => {
    expect(detailsMissing({ name: "Ana", title: "Agent", departmentId: "d1", employeeNo: "EMP-1", joinedAt: "2026-10-16" })).toEqual([]);
    expect(detailsMissing({ name: "Ana", title: "Agent", departmentId: "d1", employeeNo: "  ", joinedAt: "" })).toEqual(["employeeNo", "joinedAt"]);
  });
});

describe("createdNoticeExtras — the ?assigned=&failed= the wizard sends to the profile", () => {
  it("reads a count and the failures", () => {
    expect(createdNoticeExtras("2", JSON.stringify([{ tag: "BR-MN-0911", reason: "taken" }])))
      .toEqual({ assigned: 2, failed: [{ tag: "BR-MN-0911", reason: "taken" }] });
  });
  it("ignores bad JSON, a bad count and malformed rows", () => {
    expect(createdNoticeExtras("x", "{not json")).toEqual({ assigned: 0, failed: [] });
    expect(createdNoticeExtras(null, null)).toEqual({ assigned: 0, failed: [] });
    expect(createdNoticeExtras("-3", JSON.stringify([{ tag: 1 }, "x", { tag: "A", reason: "r" }])))
      .toEqual({ assigned: 0, failed: [{ tag: "A", reason: "r" }] });
  });
});

describe("firstFailure — the reason a refused assignment shows", () => {
  it("prefers the first field message of a validation refusal, else the message", () => {
    expect(firstFailure({ ok: false, kind: "validation", message: "Fix the highlighted fields.", fieldErrors: { status: "Nope" } })).toBe("Nope");
    expect(firstFailure({ ok: false, kind: "conflict", message: "BR-1 is DEPLOYED" })).toBe("BR-1 is DEPLOYED");
  });
});
