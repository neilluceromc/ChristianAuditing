import { describe, expect, it } from "vitest";
import { ApprovalState } from "@prisma/client";
import { APPROVAL_STATE_LABEL } from "./labels";

describe("APPROVAL_STATE_LABEL", () => {
  it("has friendly words for every approval state, and none of them is the enum value", () => {
    for (const state of Object.values(ApprovalState)) {
      expect(APPROVAL_STATE_LABEL[state], state).toBeTruthy();
      expect(APPROVAL_STATE_LABEL[state]).not.toBe(state);
    }
  });
  it("reads Pending, Claimed, Approved, Rejected, Executed, Failed", () => {
    expect(Object.values(APPROVAL_STATE_LABEL).sort()).toEqual(["Approved", "Claimed", "Executed", "Failed", "Pending", "Rejected"]);
  });
});
