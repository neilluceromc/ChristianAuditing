import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AssetRow } from "@/server/modules/inventory/queries";
import { RegistrationCell } from "./registration-cell";

// The dialog calls a server action (auth, database); it never renders until opened.
vi.mock("./resubmit-dialog", () => ({ ResubmitDialog: () => null }));

const row = (over: Partial<AssetRow>): AssetRow => ({
  id: "a1", tag: "BR-LT-0001", serial: null, model: "ThinkPad T14", category: "Laptop", status: "SPARE",
  assignee: null, hold: null, purchased: "—", warranty: "—", stage: null, stageLabel: null, down: null,
  assigneeId: null, assigneeNo: null, cls: "IT", statusValue: "SPARE", returned: false, pendingRef: null,
  loanDueAt: null, awaitingItCheck: false, financeConfirmed: false, financeReturned: true, reg: "needs-correction",
  regNotCapitalised: false, regItems: ["Serial number", "Cost"], regNote: "Invoice says 2 units", regBy: "Fe",
  regAt: "20 Oct 2026", attention: null, ...over,
});

const cell = (r: AssetRow) => renderToStaticMarkup(<RegistrationCell row={r} canEdit canMutate />);

describe("RegistrationCell in Dense", () => {
  it("lays the cell out in one row in Dense", () => {
    expect(cell(row({}))).toMatch(/^<div class="[^"]*flex-col[^"]*dense:flex-row/);
  });

  it("hides a flagged row's block and actions in Dense, and shows them as one truncated line with a title", () => {
    const html = cell(row({}));
    expect(html).toMatch(/<div class="[^"]*whitespace-normal[^"]*dense:hidden[^"]*">/);
    const summary = "Finance flagged: Serial number, Cost “Invoice says 2 units” — Fe, 20 Oct 2026";
    expect(html).toContain(`class="hidden min-w-0 truncate text-[12px] text-fg-muted dense:inline" title="${summary}">${summary}</span>`);
  });

  it("keeps not capitalised on the pill's line in Dense, truncating", () => {
    const html = cell(row({ reg: "registered", regNotCapitalised: true, regItems: [], regNote: null, regBy: null, regAt: null }));
    expect(html).toMatch(/<span class="[^"]*truncate[^"]*">not capitalised<\/span>/);
    expect(html).not.toContain("Finance flagged");
  });
});
