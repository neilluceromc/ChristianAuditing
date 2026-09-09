import { describe, expect, it } from "vitest";
import {
  REQUEST_DOCUMENT_KINDS, REQUEST_DOCUMENT_LABEL, SUPPLIER_DOCUMENT_KINDS, SUPPLIER_DOCUMENT_LABEL,
} from "./documents";

describe("document kinds (spec §2.3)", () => {
  it("every supplier document kind has a label, and vice versa", () => {
    expect(Object.keys(SUPPLIER_DOCUMENT_LABEL).sort()).toEqual([...SUPPLIER_DOCUMENT_KINDS].sort());
  });
  it("every request document kind has a label, and vice versa", () => {
    expect(Object.keys(REQUEST_DOCUMENT_LABEL).sort()).toEqual([...REQUEST_DOCUMENT_KINDS].sort());
  });
});
