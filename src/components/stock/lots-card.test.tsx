import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

// The manager actions' server actions reach for auth and the database; a markup test never presses them.
vi.mock("@/server/modules/stock/movement-actions", () => ({ writeOffLot: vi.fn(), setLotCost: vi.fn() }));
vi.mock("@/server/modules/stock/document-actions", () => ({ uploadLotDocument: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => vi.fn() }));

import { LotsCard } from "./lots-card";
import type { ItemLots, StockLotDocumentRow, StockLotRow } from "@/server/modules/stock/queries";

const doc = (over: Partial<StockLotDocumentRow> = {}): StockLotDocumentRow => ({
  id: "ld1", kind: "receipt", fileName: "or-1182.pdf", uploadedAt: "2026-10-22T01:41:00.000Z", uploadedBy: "Ana Cruz",
  at: "22 Oct 2026", downloadHref: "/stock/lots/l1/documents/ld1/download", ...over,
});
const lot = (documents: StockLotDocumentRow[]): StockLotRow => ({
  id: "l1", origin: "PURCHASE" as StockLotRow["origin"], lotDate: new Date("2026-10-20T00:00:00Z"), expiresAt: null,
  expiryLabel: null, expired: false, unitCost: 12, quantity: 10, remaining: 4, value: 48,
  reference: "OR 1182", supplier: "Acme Supply", receivedBy: "Ana Cruz", documents,
});
const render = (documents: StockLotDocumentRow[]) => {
  const lots: ItemLots = { open: [lot(documents)], closedCount: 0 };
  return renderToStaticMarkup(<LotsCard itemCode="SUP-001" unit="pcs" lots={lots} manage={false} />);
};
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("LotsCard: a lot's documents", () => {
  it("each document: its kind, its name, Uploaded <date time> · <name>, Preview (the dialog) and Download", () => {
    const html = render([doc()]);
    const t = text(html);
    expect(t).toContain("or-1182.pdf");
    expect(t).toContain("Uploaded 22 Oct 2026 09:41 · Ana Cruz");
    expect(html).toMatch(/<button[^>]*>Preview<span class="sr-only"> or-1182.pdf<\/span><\/button>/);
    expect(html).toMatch(/<a [^>]*href="\/stock\/lots\/l1\/documents\/ld1\/download"[^>]*>Download<\/a>/);
    expect(html).not.toContain("inline=1\"");
  });

  it("nobody uploaded it: the time alone", () => {
    const t = text(render([doc({ uploadedBy: null })]));
    expect(t).toContain("Uploaded 22 Oct 2026 09:41 Preview");
    expect(t).not.toContain("system");
  });

  it("no documents: no documents row", () => {
    expect(render([])).not.toContain("Uploaded");
  });

  it("a delivery receipt reads in words, on its pill and as the Preview dialog's name", () => {
    const html = render([doc({ kind: "delivery-receipt" })]);
    expect(text(html)).toContain("Delivery receipt");
    expect(html).not.toContain(">delivery-receipt<");
  });

  // On the stock item page this card is a Server Component, which sees a Client Component module's constants only as
  // references: a kind label imported from lot-document-dialog.tsx came out undefined, so the pill (and the Preview
  // dialog's name) showed the raw "delivery-receipt". The words must come from a plain module.
  it("takes the kind's words from a plain module, not from the Client Component's file", () => {
    const source = readFileSync(new URL("./lots-card.tsx", import.meta.url), "utf8");
    const fromDialog = /import\s*\{([^}]*)\}\s*from\s*"\.\/lot-document-dialog"/.exec(source)?.[1] ?? "";
    expect(fromDialog.split(",").map((s) => s.trim()).filter(Boolean)).toEqual(["LotDocumentDialog"]);
    expect(source).toMatch(/import\s*\{[^}]*\bLOT_DOCUMENT_LABEL\b[^}]*\}\s*from\s*"@\/lib\/stock-schema"/);
  });
});
