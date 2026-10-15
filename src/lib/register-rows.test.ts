import { describe, expect, it } from "vitest";
import {
  MAX_BATCH, badTags, clampQuantity, liveQuantity, pasteColumn, registeredRows, repeatedSerials, repeatedTags,
  resizeRows, serialsEntered, serverRowMarks, singleRowErrors, type RegisterRow,
} from "./register-rows";

const row = (tag: string, serial = ""): RegisterRow => ({ tag, serial });

describe("Quantity — a text field that clamps on blur (spec §5.2)", () => {
  it("applies a count while typing only when it is already one", () => {
    expect(liveQuantity("5")).toBe(5);
    expect(liveQuantity(" 12 ")).toBe(12);
    expect(liveQuantity("")).toBeNull();
    expect(liveQuantity("0")).toBeNull();
    expect(liveQuantity("250")).toBeNull();
    expect(liveQuantity("3.5")).toBeNull();
    expect(liveQuantity("abc")).toBeNull();
  });
  it("clamps to 1–200 on blur; text that is not a number keeps the current count", () => {
    expect(clampQuantity("0", 4)).toBe(1);
    expect(clampQuantity("250", 4)).toBe(MAX_BATCH);
    expect(clampQuantity("7", 4)).toBe(7);
    expect(clampQuantity("", 4)).toBe(4);
    expect(clampQuantity("abc", 4)).toBe(4);
  });
});

describe("rows follow the quantity", () => {
  it("growing keeps every row as typed; the new rows are empty", () => {
    expect(resizeRows([row("BR-LT-9000", "SN-1")], 3)).toEqual([row("BR-LT-9000", "SN-1"), row(""), row("")]);
  });
  it("shrinking drops the tail", () => {
    expect(resizeRows([row("A", "1"), row("B", "2")], 1)).toEqual([row("A", "1")]);
  });
  it("counts the serials entered", () => {
    expect(serialsEntered([row("a", "S"), row("b", " "), row("c", "T")])).toBe(2);
  });
});

describe("pasting a column of tags or serials (spec §5.4, Phase 36)", () => {
  it("fills that row and the rows below, growing the batch", () => {
    const out = pasteColumn([row("A"), row("B")], 1, ["X", "Y", "Z"], "serial");
    expect(out.pasted).toBe(3);
    expect(out.rows).toEqual([row("A"), row("B", "X"), row("", "Y"), row("", "Z")]);
  });
  it("stops at 200 rows and says how many were added", () => {
    const values = Array.from({ length: 250 }, (_, i) => `S${i}`);
    const out = pasteColumn([row("A")], 0, values, "serial");
    expect(out.rows).toHaveLength(MAX_BATCH);
    expect(out.pasted).toBe(200);
    expect(out.rows[199].serial).toBe("S199");
  });
  it("never shrinks a longer batch", () => {
    const out = pasteColumn([row("a"), row("b"), row("c")], 0, ["X", "Y"], "serial");
    expect(out.rows).toEqual([row("a", "X"), row("b", "Y"), row("c")]);
  });
  it("pasteColumn fills tags or serials from the row down, growing to at most 200; blanks stay blank", () => {
    const out = pasteColumn([{ tag: "", serial: "" }], 0, ["a-1", "", "a-3"], "tag");
    expect(out.rows.map((r) => r.tag)).toEqual(["a-1", "", "a-3"]);
    expect(out.pasted).toBe(3);
    const s = pasteColumn([{ tag: "x", serial: "" }], 0, ["S1"], "serial");
    expect(s.rows).toEqual([{ tag: "x", serial: "S1" }]);
    expect(pasteColumn([], 0, Array.from({ length: 250 }, (_, i) => `t${i}`), "tag").rows).toHaveLength(200);
  });
});

describe("in-batch repeats, worded as registerAssets words them", () => {
  it("names the later row of a repeated tag, case- and space-blind", () => {
    const r = repeatedTags([row("BR-LT-0201"), row(" br-lt-0201 "), row("BR-LT-0203")]);
    expect(r.message).toBe("Row 2 · BR-LT-0201 appears twice in this batch");
    expect([...r.rows]).toEqual([1]);
  });
  it("names the later row of a repeated serial; blanks never repeat", () => {
    const r = repeatedSerials([row("a", "SAME"), row("b", ""), row("c", ""), row("d", " SAME")]);
    expect(r.message).toBe("Row 4 · serial SAME appears twice in this batch");
    expect([...r.rows]).toEqual([3]);
  });
  it("nothing repeated, nothing said", () => {
    expect(repeatedTags([row("A"), row("B")]).message).toBeNull();
    expect(repeatedSerials([row("A", "1"), row("B", "2")]).message).toBeNull();
  });
});

describe("a tag that is not a tag", () => {
  it("names the first bad row and counts the rest", () => {
    const r = badTags([row("BR-LT-0201"), row(""), row("A B"), row("bad")]);
    expect(r.message).toBe("Row 2 · Enter a tag for every unit and 1 more");
    expect([...r.rows]).toEqual([1, 2]);
  });
  it("badTags: empty tags ask for a tag; bad shapes name the rule", () => {
    expect(badTags([row(""), row("ok-1")]).message).toBe("Row 1 · Enter a tag for every unit");
    expect(badTags([row("A B")]).message).toBe("Row 1 · A B: Tags are 1–20 letters, digits, - _ or ., no spaces");
    expect(badTags([row("acc-1")]).rows.size).toBe(0);
    expect(badTags([row(""), row("")]).message).toBe("Row 1 · Enter a tag for every unit and 1 more");
  });
});

describe("the duplicate check's records, matched onto rows", () => {
  it("links each row to the record its tag or serial is already on", () => {
    const hits = {
      tags: [{ tag: "BR-LT-0148", id: "a1" }],
      serials: [{ serial: "SN-9", id: "a2", tag: "BR-LT-0150" }],
    };
    const out = registeredRows([row("br-lt-0148"), row("BR-LT-0300", " SN-9 "), row("BR-LT-0301", "SN-0")], hits);
    expect(out.tags).toEqual([{ row: 0, tag: "BR-LT-0148", id: "a1" }]);
    expect(out.serials).toEqual([{ row: 1, serial: "SN-9", id: "a2", tag: "BR-LT-0150" }]);
  });
});

describe("R3: createAsset's field errors land on row 1", () => {
  it("prefixes the tag message with the row; a serial message already names its serial", () => {
    expect(singleRowErrors({ tag: "BR-LT-0148 is already registered", serial: "Serial SN-9 is already on BR-LT-0150", model: "Name the model" }))
      .toEqual({ tags: "Row 1 · BR-LT-0148 is already registered", serials: "Serial SN-9 is already on BR-LT-0150", model: "Name the model" });
    expect(singleRowErrors({ serial: "That serial is already registered" })).toEqual({ serials: "Row 1 · That serial is already registered" });
  });
});

describe("the rows a server message names", () => {
  it("reads the row from 'Row n ·', a serial from 'Serial s is already on', and zod's indexed keys", () => {
    const rows = [row("A", "S1"), row("B", "S2"), row("C", "S3")];
    const marks = serverRowMarks({ tags: "Row 2 · B appears twice in this batch", serials: "Serial S3 is already on BR-LT-0001", "tags.0": "Tags are 1–20 letters, digits, - _ or ., no spaces" }, rows);
    expect([...marks.tags].sort()).toEqual([0, 1]);
    expect([...marks.serials]).toEqual([2]);
    expect([...serverRowMarks({ serials: "Row 1 · serial S1 appears twice in this batch", "serials.2": "Too long" }, rows).serials].sort()).toEqual([0, 2]);
  });
});
