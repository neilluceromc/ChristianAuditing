import { describe, expect, it } from "vitest";
import { nextEmployeeNo } from "./employee-no";

describe("nextEmployeeNo — the next free EMP-#### (spec §5.2)", () => {
  it("is highest + 1, zero-padded to four digits", () => {
    expect(nextEmployeeNo(["EMP-0042", "EMP-0099", "EMP-0071"])).toBe("EMP-0100");
    expect(nextEmployeeNo(["EMP-9999"])).toBe("EMP-10000");
  });
  it("ignores numbers that do not follow the pattern, case-insensitively matching the prefix", () => {
    expect(nextEmployeeNo(["EMP-0007", "CONTRACTOR-1", "emp-0010"])).toBe("EMP-0011");
  });
  it("gaps stay gaps; nothing matching → null", () => {
    expect(nextEmployeeNo(["EMP-0001", "EMP-0003"])).toBe("EMP-0004");
    expect(nextEmployeeNo(["T-1", ""])).toBeNull();
    expect(nextEmployeeNo([])).toBeNull();
  });
});
