import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Phase 47 (Task 5, Task 3 review): Finance → Assets' Export downloads exactly the rows the list shows — every page —
 * so it reads the list's own URL state (cls, category incl. "other", status, fin, q, life, sort) through the same
 * parser, and the same rows through the same query, in the list's order.
 */

const h = vi.hoisted(() => ({
  requireRole: vi.fn(),
  financeExportRows: vi.fn(),
  toXlsxBuffer: vi.fn(),
}));

vi.mock("@/server/auth/guards", () => ({ requireRole: h.requireRole }));
vi.mock("@/server/modules/finance/queries", () => ({ financeExportRows: h.financeExportRows }));
vi.mock("@/server/xlsx/write", () => ({ toXlsxBuffer: h.toXlsxBuffer }));

import { GET } from "./route";
import { EXPORT_CAP, FINANCE_ASSETS_EXPORT_COLUMNS } from "@/lib/export-columns";

const call = (qs = "") => GET(new Request(`http://localhost/finance/assets/export${qs}`));

beforeEach(() => {
  h.requireRole.mockReset().mockResolvedValue({ id: "u1", role: "finance_staff" });
  h.financeExportRows.mockReset().mockResolvedValue([{ id: "a1" }, { id: "a2" }]);
  h.toXlsxBuffer.mockReset().mockResolvedValue(Buffer.from("xlsx"));
});

describe("GET /finance/assets/export", () => {
  it("is Finance's (admin, finance_staff)", async () => {
    await call();
    expect(h.requireRole).toHaveBeenCalledWith("admin", "finance_staff");
  });

  it("reads every list filter and the sort, and writes the rows in the list's order", async () => {
    const res = await call("?cls=PURCHASING&category=other&status=STORED&fin=approved&q=desk&life=full&sort=life&page=3&per=50");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="finance-assets-\d{4}-\d{2}-\d{2}\.xlsx"/);
    expect(h.financeExportRows).toHaveBeenCalledTimes(1);
    expect(h.financeExportRows.mock.calls[0][0]).toMatchObject({
      cls: "PURCHASING", category: "other", status: "STORED", fin: "approved", q: "desk", life: "full", sort: "life",
    });
    expect(h.toXlsxBuffer).toHaveBeenCalledWith(FINANCE_ASSETS_EXPORT_COLUMNS, [{ id: "a1" }, { id: "a2" }]);
  });

  it("a bare URL is the IT list, default sort, nothing filtered", async () => {
    await call();
    expect(h.financeExportRows.mock.calls[0][0]).toMatchObject({
      cls: "IT", category: null, status: null, fin: null, q: "", life: null, sort: "book",
    });
  });

  it("refuses over the cap", async () => {
    h.financeExportRows.mockResolvedValue(Array.from({ length: EXPORT_CAP + 1 }, (_, i) => ({ id: `a${i}` })));
    const res = await call();
    expect(res.status).toBe(413);
    expect(h.toXlsxBuffer).not.toHaveBeenCalled();
  });
});
