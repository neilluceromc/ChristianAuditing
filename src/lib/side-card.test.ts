import { describe, expect, it } from "vitest";
import {
  formStatus,
  pickSideTab,
  tabAfterKey,
  tagLine,
  readStoredTab,
  SIDE_TAB_KEY,
  SIDE_TABS,
  setupDot,
  sideBadges,
  writeStoredTab,
} from "./side-card";

describe("SIDE_TABS", () => {
  it("lists the four tabs in order and keeps the memory key", () => {
    expect(SIDE_TABS).toEqual(["notes", "setup", "form", "transfers"]);
    expect(SIDE_TAB_KEY).toBe("br.profile-side-tab");
  });
});

describe("pickSideTab", () => {
  it("the link parameter wins over the stored tab", () => {
    expect(pickSideTab("form", "transfers")).toBe("form");
  });
  it("falls back to the stored tab, then to notes", () => {
    expect(pickSideTab(null, "setup")).toBe("setup");
    expect(pickSideTab(null, null)).toBe("notes");
  });
  it("ignores an unknown parameter and uses the stored tab", () => {
    expect(pickSideTab("bogus", "transfers")).toBe("transfers");
  });
  it("?notes=1 means the Notes tab, over the link parameter and the stored tab", () => {
    expect(pickSideTab(null, "transfers", "1")).toBe("notes");
    expect(pickSideTab("form", "setup", "1")).toBe("notes");
  });
  it("any other notes value changes nothing", () => {
    expect(pickSideTab(null, "transfers", "0")).toBe("transfers");
    expect(pickSideTab("form", null, "")).toBe("form");
    expect(pickSideTab(null, "setup", null)).toBe("setup");
  });
  it("gives notes when both are unknown", () => {
    expect(pickSideTab("bogus", "also-bogus")).toBe("notes");
    expect(pickSideTab("", "")).toBe("notes");
  });
});

describe("readStoredTab / writeStoredTab", () => {
  it("reads the stored value under the memory key", () => {
    const seen: string[] = [];
    const storage = { getItem: (k: string) => (seen.push(k), "form") };
    expect(readStoredTab(storage)).toBe("form");
    expect(seen).toEqual([SIDE_TAB_KEY]);
  });
  it("returns null with no storage or when getItem throws", () => {
    expect(readStoredTab(null)).toBeNull();
    expect(
      readStoredTab({
        getItem: () => {
          throw new Error("blocked");
        },
      }),
    ).toBeNull();
  });
  it("writes under the memory key and stays silent when setItem throws or storage is missing", () => {
    const written: Array<[string, string]> = [];
    writeStoredTab({ setItem: (k, v) => void written.push([k, v]) }, "setup");
    expect(written).toEqual([[SIDE_TAB_KEY, "setup"]]);
    expect(() =>
      writeStoredTab(
        {
          setItem: () => {
            throw new Error("quota");
          },
        },
        "form",
      ),
    ).not.toThrow();
    expect(() => writeStoredTab(null, "form")).not.toThrow();
  });
});

describe("sideBadges", () => {
  const base = { notes: 0, notYet: 0, signed: true, transfers: 0 };
  it("notes and transfers show their counts as text", () => {
    const b = sideBadges({ ...base, notes: 12, transfers: 3 });
    expect(b.notes).toEqual({ text: "12", tone: "neutral" });
    expect(b.transfers).toEqual({ text: "3", tone: "neutral" });
  });
  it("zero counts still show 0", () => {
    const b = sideBadges(base);
    expect(b.notes).toEqual({ text: "0", tone: "neutral" });
    expect(b.transfers).toEqual({ text: "0", tone: "neutral" });
  });
  it("IT setup warns with n not yet, and has no badge at zero", () => {
    expect(sideBadges({ ...base, notYet: 2 }).setup).toEqual({ text: "2 not yet", tone: "warning" });
    expect(sideBadges({ ...base, notYet: 0 }).setup).toBeNull();
  });
  it("Form is Not signed (warning) or Signed (neutral)", () => {
    expect(sideBadges({ ...base, signed: false }).form).toEqual({ text: "Not signed", tone: "warning" });
    expect(sideBadges({ ...base, signed: true }).form).toEqual({ text: "Signed", tone: "neutral" });
  });
});

describe("setupDot", () => {
  it("maps the stored values to a dot", () => {
    expect(setupDot("DONE")).toBe("done");
    expect(setupDot("NOT_YET")).toBe("notyet");
    expect(setupDot("NOT_NEEDED")).toBe("off");
    expect(setupDot("None")).toBe("off");
    expect(setupDot(null)).toBe("unrecorded");
    expect(setupDot("Zscaler")).toBe("done");
  });
});

describe("tabAfterKey", () => {
  it("arrows move to the neighbour and wrap at the ends", () => {
    expect(tabAfterKey("notes", "ArrowRight")).toBe("setup");
    expect(tabAfterKey("transfers", "ArrowRight")).toBe("notes");
    expect(tabAfterKey("setup", "ArrowLeft")).toBe("notes");
    expect(tabAfterKey("notes", "ArrowLeft")).toBe("transfers");
  });
  it("Home and End jump to the ends", () => {
    expect(tabAfterKey("form", "Home")).toBe("notes");
    expect(tabAfterKey("setup", "End")).toBe("transfers");
  });
  it("any other key is not a tab move", () => {
    expect(tabAfterKey("notes", "Enter")).toBeNull();
    expect(tabAfterKey("notes", "ArrowDown")).toBeNull();
  });
});

describe("tagLine", () => {
  it("lists up to five tags", () => {
    expect(tagLine(["BR-HS-0502", "BR-MN-0911"])).toBe("BR-HS-0502, BR-MN-0911");
    expect(tagLine(["A", "B", "C", "D", "E"])).toBe("A, B, C, D, E");
  });
  it("past five, the rest read +{n} more", () => {
    expect(tagLine(["A", "B", "C", "D", "E", "F", "G"])).toBe("A, B, C, D, E +2 more");
  });
  it("nothing to list is empty", () => {
    expect(tagLine([])).toBe("");
  });
});

describe("formStatus", () => {
  it("with nothing signed: the amber line, no issued-since", () => {
    expect(formStatus(null, 3)).toEqual({ dot: "notyet", text: "No signed form on file", since: null });
  });
  it("signed: the date (d MMM yyyy, Manila) and the item count", () => {
    // 2026-10-03T17:00Z is 4 Oct 01:00 in Manila.
    expect(formStatus({ signedAt: new Date("2026-10-03T17:00:00Z"), items: 4 }, 0))
      .toEqual({ dot: "done", text: "Signed 4 Oct 2026 · covers 4 items", since: null });
  });
  it("one item reads singular", () => {
    expect(formStatus({ signedAt: new Date("2026-10-04T04:00:00Z"), items: 1 }, 0).text)
      .toBe("Signed 4 Oct 2026 · covers 1 item");
  });
  it("items issued after the signature read as {k} issued since", () => {
    expect(formStatus({ signedAt: new Date("2026-10-04T04:00:00Z"), items: 2 }, 3).since).toBe("3 issued since");
  });
});
