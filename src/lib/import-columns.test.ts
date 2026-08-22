import { describe, expect, it } from "vitest";
import { ASSET_EXPORT_COLUMNS } from "./export-columns";
import { ASSET_IMPORT_HEADERS } from "./import-assets";
import { KNOWN_UNIMPORTED_COLUMNS, splitUnknownColumns } from "./import-columns";

describe("KNOWN_UNIMPORTED_COLUMNS", () => {
  // Locks the current, known-correct value: a change here means either the
  // export gained/renamed a column or an import header did — a reader should
  // notice, not have it slide by silently the way a hand-typed list would.
  it("is exactly the export's columns with no import field, as of today", () => {
    expect(KNOWN_UNIMPORTED_COLUMNS).toEqual(["RMA ref"]);
  });

  // Task 11 round two, V-7: the whole point of deriving this is that it
  // CANNOT diverge from the two tables it's built from. Every export label
  // ends up in exactly one of "importable" or "known unimported" — never
  // neither, never both.
  it("cannot diverge from the export/import header tables it is derived from", () => {
    const importableLabels = new Set(
      ASSET_IMPORT_HEADERS.flatMap((h) => h.labels.map((l) => l.toLowerCase())),
    );
    for (const col of ASSET_EXPORT_COLUMNS) {
      const isImportable = importableLabels.has(col.label.toLowerCase());
      const isKnownUnimported = KNOWN_UNIMPORTED_COLUMNS.includes(col.label);
      expect(isImportable || isKnownUnimported).toBe(true);
      expect(isImportable && isKnownUnimported).toBe(false);
    }
  });
});

describe("splitUnknownColumns", () => {
  it("files a genuine typo as unknown", () => {
    expect(splitUnknownColumns(["Warrenty"])).toEqual({ known: [], unknown: ["Warrenty"] });
  });

  it("files this app's own export-only column as known, not a typo", () => {
    expect(splitUnknownColumns(["RMA ref"])).toEqual({ known: ["RMA ref"], unknown: [] });
  });

  // V-7's second half: `matchHeaders`'s `unknown` array preserves the sheet's
  // original casing, so a re-saved export with different capitalisation must
  // still resolve to "known" rather than falling through to "check for a
  // typo" — a case-sensitive hand-typed list was exactly this bug.
  it("matches a differently-cased re-save of its own export column", () => {
    expect(splitUnknownColumns(["RMA Ref"])).toEqual({ known: ["RMA Ref"], unknown: [] });
  });

  it("splits a mix correctly and preserves each column's original casing", () => {
    expect(splitUnknownColumns(["RMA ref", "Warrenty", "rma ref"])).toEqual({
      known: ["RMA ref", "rma ref"],
      unknown: ["Warrenty"],
    });
  });
});
