import { describe, expect, it } from "vitest";
import { matchScan, type ScanItem } from "./scan";

const ITEMS: ScanItem[] = [
  { assetId: "a1", tag: "BR-LT-0166", decided: false, blockedBy: null },
  { assetId: "a2", tag: "BR-PH-0312", decided: true, blockedBy: null },
  { assetId: "a3", tag: "BR-HS-0510", decided: false, blockedBy: "APR-2039" },
];

describe("matchScan", () => {
  it("matches a held, undecided, unblocked item", () => {
    expect(matchScan("BR-LT-0166", ITEMS)).toEqual({ kind: "match", assetId: "a1", tag: "BR-LT-0166" });
  });

  // A scanner may emit lower case, and the operator may leave a space.
  it("normalises case and surrounding whitespace", () => {
    expect(matchScan("  br-lt-0166 ", ITEMS)).toEqual({ kind: "match", assetId: "a1", tag: "BR-LT-0166" });
  });

  // The stored side must be normalised too, not just the buffer: every
  // fixture above already stores its tag canonically (trimmed, upper-case),
  // so a mutation that compares the buffer's key against the raw `i.tag`
  // (dropping tagKey on the stored side) would slip past every other test.
  it("normalises the stored tag, not only the scanned buffer", () => {
    const stray: ScanItem[] = [{ assetId: "a9", tag: " br-lt-9000 ", decided: false, blockedBy: null }];
    expect(matchScan("BR-LT-9000", stray)).toEqual({ kind: "match", assetId: "a9", tag: " br-lt-9000 " });
  });

  it("reports a tag this employee does not hold, and echoes what was scanned", () => {
    expect(matchScan("BR-ZZ-9999", ITEMS)).toEqual({ kind: "unknown", value: "BR-ZZ-9999" });
  });

  it("reports an item that already has a decision rather than re-opening it", () => {
    expect(matchScan("BR-PH-0312", ITEMS)).toEqual({ kind: "already-decided", tag: "BR-PH-0312" });
  });

  // The verdict the brief never mentions and a seed-based test would miss:
  // preselecting here would stage exactly what decideItem refuses.
  it("reports an item blocked by a prior approval, naming the blocker", () => {
    expect(matchScan("BR-HS-0510", ITEMS)).toEqual({ kind: "blocked", tag: "BR-HS-0510", refNo: "APR-2039" });
  });

  it("ignores an empty or whitespace-only buffer", () => {
    expect(matchScan("", ITEMS)).toEqual({ kind: "ignored" });
    expect(matchScan("   ", ITEMS)).toEqual({ kind: "ignored" });
  });

  // Decided beats blocked: a decided item is settled, and telling the operator
  // to go resolve an approval they no longer need to resolve is wrong.
  it("prefers already-decided over blocked when an item is both", () => {
    const both: ScanItem[] = [{ assetId: "x", tag: "BR-LT-0001", decided: true, blockedBy: "APR-1" }];
    expect(matchScan("BR-LT-0001", both)).toEqual({ kind: "already-decided", tag: "BR-LT-0001" });
  });
});
