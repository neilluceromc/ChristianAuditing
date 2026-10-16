import { describe, expect, it } from "vitest";
import { failuresCsv, filterNotes, filterRef, filterThread, monthGroups, sliceFields } from "./long-lists";

describe("monthGroups", () => {
  const item = (id: string, iso: string) => ({ id, at: new Date(iso) });
  it("groups by Asia/Manila month, crossing the boundary at 2026-09-30T17:00Z, keeping order", () => {
    const items = [
      item("a", "2026-10-17T02:00:00Z"),
      item("b", "2026-09-30T17:00:00Z"), // 1 Oct 01:00 Manila
      item("b2", "2026-09-30T16:00:00Z"), // 1 Oct 00:00 Manila, the first instant of October
      item("c", "2026-09-30T15:59:00Z"), // 30 Sep 23:59 Manila, still September (it is 15:59 UTC)
      item("d", "2026-08-15T00:00:00Z"),
    ];
    const groups = monthGroups(items, (t) => t.at);
    expect(groups.map((g) => g.month)).toEqual(["October 2026", "September 2026", "August 2026"]);
    expect(groups[0].items.map((i) => i.id)).toEqual(["a", "b", "b2"]);
    expect(groups[1].items.map((i) => i.id)).toEqual(["c"]);
    expect(groups[2].items.map((i) => i.id)).toEqual(["d"]);
  });
  it("starts a new group when the month returns after another (order kept)", () => {
    const items = [item("a", "2026-10-01T00:00:00Z"), item("b", "2026-09-01T00:00:00Z"), item("c", "2026-10-02T00:00:00Z")];
    expect(monthGroups(items, (t) => t.at).map((g) => g.month)).toEqual(["October 2026", "September 2026", "October 2026"]);
  });
  it("is empty for no items", () => {
    expect(monthGroups([], (t: Date) => t)).toEqual([]);
  });
});

describe("filterNotes", () => {
  const notes = [
    { id: 1, text: "Laptop Replaced under warranty", authorId: "u1" },
    { id: 2, text: "Needs a new charger", authorId: "u2" },
    { id: 3, text: "laptop bag issued", authorId: "u2" },
  ];
  it("an empty or blank query and no author passes everything", () => {
    expect(filterNotes(notes, "", null)).toHaveLength(3);
    expect(filterNotes(notes, "   ", null)).toHaveLength(3);
  });
  it("matches case-insensitively and trims the query", () => {
    expect(filterNotes(notes, "  LAPTOP ", null).map((n) => n.id)).toEqual([1, 3]);
  });
  it("filters by author, alone or with a query", () => {
    expect(filterNotes(notes, "", "u2").map((n) => n.id)).toEqual([2, 3]);
    expect(filterNotes(notes, "laptop", "u2").map((n) => n.id)).toEqual([3]);
  });
  it("finds nothing when nothing matches", () => {
    expect(filterNotes(notes, "zzz", null)).toEqual([]);
  });
});

describe("filterThread", () => {
  const notes = [
    { id: 1, kind: "COMMENT", text: "Which colour?" },
    { id: 2, kind: "SUBMIT", text: "Submitted for review" },
    { id: 3, kind: "REQUEST_INFO", text: "Please confirm the colour" },
    { id: 4, kind: "COMMENT", text: "Silver" },
  ];
  it("all with an empty query passes everything", () => {
    expect(filterThread(notes, "", "all")).toHaveLength(4);
    expect(filterThread(notes, "  ", "all")).toHaveLength(4);
  });
  it("comments is only COMMENT; status is every other kind", () => {
    expect(filterThread(notes, "", "comments").map((n) => n.id)).toEqual([1, 4]);
    expect(filterThread(notes, "", "status").map((n) => n.id)).toEqual([2, 3]);
  });
  it("search is case-insensitive and trimmed, and combines with the kind", () => {
    expect(filterThread(notes, " COLOUR ", "all").map((n) => n.id)).toEqual([1, 3]);
    expect(filterThread(notes, "colour", "status").map((n) => n.id)).toEqual([3]);
  });
});

describe("failuresCsv", () => {
  it("writes the header, then one line per failure, with CRLF line ends", () => {
    expect(failuresCsv([{ row: 2, reason: "Missing name" }, { row: 5, reason: "Bad date" }])).toBe(
      "Row,Reason\r\n2,Missing name\r\n5,Bad date",
    );
  });
  it("is only the header for no failures", () => {
    expect(failuresCsv([])).toBe("Row,Reason");
  });
  it("quotes a reason with a comma, a quote and a newline (RFC 4180)", () => {
    const csv = failuresCsv([{ row: 7, reason: 'Said "no", then\nleft' }]);
    expect(csv).toBe('Row,Reason\r\n7,"Said ""no"", then\nleft"');
  });
  it("quotes a reason with a carriage return", () => {
    expect(failuresCsv([{ row: 1, reason: "a\rb" }])).toBe('Row,Reason\r\n1,"a\rb"');
  });
  it("prefixes a reason a spreadsheet would read as a formula with an apostrophe", () => {
    expect(
      failuresCsv([
        { row: 1, reason: "=SUM(A1)" },
        { row: 2, reason: "+1" },
        { row: 3, reason: "-2" },
        { row: 4, reason: "@cmd" },
        { row: 5, reason: "Total = 3" },
      ]),
    ).toBe("Row,Reason\r\n1,'=SUM(A1)\r\n2,'+1\r\n3,'-2\r\n4,'@cmd\r\n5,Total = 3");
  });
  it("guards the formula before quoting, so the apostrophe sits inside the quotes", () => {
    expect(failuresCsv([{ row: 6, reason: '=HYPERLINK("x","y")' }])).toBe(
      `Row,Reason\r\n6,"'=HYPERLINK(""x"",""y"")"`,
    );
  });
});

describe("sliceFields", () => {
  it("shows 2 with none more", () => {
    expect(sliceFields([1, 2])).toEqual({ shown: [1, 2], more: 0 });
  });
  it("shows exactly 3 with none more", () => {
    expect(sliceFields([1, 2, 3])).toEqual({ shown: [1, 2, 3], more: 0 });
  });
  it("shows 3 of 10 with 7 more", () => {
    const ten = Array.from({ length: 10 }, (_, i) => i);
    expect(sliceFields(ten)).toEqual({ shown: [0, 1, 2], more: 7 });
  });
  it("honours a custom max", () => {
    expect(sliceFields([1, 2, 3, 4], 2)).toEqual({ shown: [1, 2], more: 2 });
  });
});

describe("filterRef", () => {
  const rows = [{ name: "Laptop" }, { name: "Docking station" }, { name: "Monitor" }];
  it("an empty query passes everything", () => {
    expect(filterRef(rows, "")).toEqual(rows);
    expect(filterRef(rows, "  ")).toEqual(rows);
  });
  it("matches a case-insensitive trimmed substring of the name", () => {
    expect(filterRef(rows, " DOCK ")).toEqual([{ name: "Docking station" }]);
    expect(filterRef(rows, "o")).toHaveLength(3);
    expect(filterRef(rows, "zzz")).toEqual([]);
  });
});
