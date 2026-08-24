import { describe, expect, it } from "vitest";
import { exportFilename } from "./respond";

describe("exportFilename", () => {
  it("leaves an ordinary prefix unchanged", () => {
    expect(exportFilename("assets", new Date("2026-08-21T00:00:00Z"))).toBe("assets-2026-08-21.xlsx");
  });

  it("keeps a prefix built from an employee number, hyphen and all", () => {
    expect(exportFilename("farewell-EMP-0042", new Date("2026-08-21T00:00:00Z"))).toBe(
      "farewell-EMP-0042-2026-08-21.xlsx",
    );
  });

  // Employee.employeeNo is `String @unique` with no format constraint, so a
  // prefix built from it (the farewell-report route) cannot be trusted to be
  // filename-safe. A quote must not survive into the returned string, or it
  // breaks out of xlsxResponse's quoted content-disposition attribute.
  it("strips a quote out of the prefix rather than passing it through", () => {
    const name = exportFilename('farewell-EMP"0042', new Date("2026-08-21T00:00:00Z"));
    expect(name).not.toContain('"');
    expect(name).toBe("farewell-EMP0042-2026-08-21.xlsx");
  });

  it("strips other header-hostile characters too — spaces, slashes, semicolons", () => {
    const name = exportFilename("farewell EMP/0042;x", new Date("2026-08-21T00:00:00Z"));
    expect(name).toBe("farewellEMP0042x-2026-08-21.xlsx");
  });
});
