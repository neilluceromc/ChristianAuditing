import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Markup tests never press a button: the router, the toast and the server actions are stand-ins.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => vi.fn() }));
vi.mock("@/server/modules/purchases/po-actions", () => ({ savePurchaseOrder: vi.fn() }));
vi.mock("@/server/modules/purchases/category-actions", () => ({ createCategoryFromPo: vi.fn() }));

import { PoForm, type PoFormInitial } from "./po-form";

/*
 * PO form redesign (A3, spec §2): the shell's markup — the "On this page" rail, the cards it links to, the paid-by
 * radio cards, and no native <select> anywhere on the form (spec §1 anti-goal).
 */

const vendors = [
  { id: "v-pcworx", name: "PCWORX", registeredName: "Infoworx Inc.", registrationNo: "004-845-988-00004", address: "Angeles City" },
  { id: "v-ts", name: "TechServe PH", registeredName: null, registrationNo: null, address: null },
];
const categories = [
  { id: "cat-cable", name: "Network cable", cls: "IT" as const, confirmed: false },
  { id: "cat-laptop", name: "Laptop", cls: "IT" as const, confirmed: true },
  { id: "cat-chair", name: "Office chair", cls: "PURCHASING" as const, confirmed: true },
];
const departments = [
  { id: "d-qa", name: "Quality Assurance", kind: "INTERNAL" as const, archivedAt: null },
  { id: "d-aster", name: "Aster Home Lending", kind: "CLIENT" as const, archivedAt: null },
];
const loadouts = [{ id: "pol1", name: "Agent kit", slots: [{ name: "Headset", type: null, required: true }] }];

const render = (initial?: PoFormInitial) =>
  renderToStaticMarkup(<PoForm loadouts={loadouts} departments={departments} vendors={vendors} categories={categories} initial={initial} />);

const edit = (extra: Partial<PoFormInitial> = {}): PoFormInitial => ({
  id: "po1", refNo: "PO-0214", state: "WITH_IT", vendorId: "v-pcworx", departmentId: null, poNumber: "2025-0418",
  invoiceRef: "44511", receiptRef: null, purchasedAt: "2025-11-22", paidBy: "CREDIT_CARD",
  totals: { totalSales: "9,100.00", lessVat: "975.00", netOfVat: "8,125.00", discount: "", amountDue: "8,125.00", addVat: "975.00", totalAmountDue: "9,100.00" },
  lines: [{ id: "ln1", description: "Belden Cat6 UTP cable, blue", specs: "305 m", categoryId: "cat-cable", qty: "1", unit: "box", unitPrice: "9,100.00", locked: 0 }],
  invoiceOnFile: true, itRegistered: false, sentBack: null,
  ...extra,
});

describe("PoForm (A3 shell)", () => {
  it("the rail lists the five sections, each linking to its card", () => {
    const html = render();
    const rail = html.match(/<nav aria-label="On this page"[^>]*>(.*?)<\/nav>/s)?.[1] ?? "";
    const links = [...rail.matchAll(/<a [^>]*href="(#po-[a-z]+)"[^>]*>(.*?)<\/a>/gs)].map((m) => [m[1], m[2].replace(/<[^>]+>/g, "")]);
    expect(links.map(([href]) => href)).toEqual(["#po-vendor", "#po-invoice", "#po-items", "#po-docs", "#po-totals"]);
    expect(links.map(([, text]) => text)).toEqual([
      expect.stringContaining("Vendor"), expect.stringContaining("Invoice &amp; payment"), expect.stringContaining("Items"),
      expect.stringContaining("Documents"), expect.stringContaining("Totals"),
    ]);
    expect(rail).toContain("0 of 5 sections done");
    for (const id of ["po-vendor", "po-invoice", "po-items", "po-docs", "po-totals"]) expect(html).toContain(`id="${id}"`);
  });

  it("paid by is two radio cards: Credit card and Debit card", () => {
    const html = render();
    const radios = [...html.matchAll(/<input[^>]*type="radio"[^>]*>/g)].map((m) => m[0]);
    expect(radios).toHaveLength(2);
    expect(radios.every((r) => r.includes('name="paidBy"'))).toBe(true);
    expect(radios.map((r) => r.match(/value="([A-Z_]+)"/)?.[1])).toEqual(["CREDIT_CARD", "DEBIT_CARD"]);
    expect(html).toContain("Credit card");
    expect(html).toContain("Debit card");
    expect(html).toMatch(/<legend[^>]*>Paid by/);
  });

  it("has no native <select>", () => {
    expect(render()).not.toContain("<select");
    expect(render(edit())).not.toContain("<select");
  });

  it("a new order: copy, empty checklist, Save and register", () => {
    const html = render();
    expect(html).toContain("Copy it from the sales invoice, top to bottom.");
    expect(html).toContain("Type the total amount due from the invoice.");
    expect(html).toContain("Save and register");
    expect(html).toContain("0 units to IT");
    expect(html).toContain("Add another item");
    expect(html).toContain("Add a policy loadout");
  });

  it("an edit of the owner's invoice: every section done, the vendor block, Save and send to IT", () => {
    const html = render(edit());
    expect(html).toContain("5 of 5 sections done");
    expect(html).toContain("Infoworx Inc.");
    expect(html).toContain("004-845-988-00004");
    expect(html).toContain('href="/purchases/suppliers/v-pcworx/edit"');
    expect(html).toContain("The figures add up, and the items match total sales.");
    expect(html).toContain("1 unit of IT gear goes to IT to check and register.");
    expect(html).toContain("Save and send to IT");
    // a new IT category (unconfirmed) is tagged on its card
    expect(html).toContain("New · IT confirms");
    expect(html).toContain("→ IT checks it");
  });

  it("a figure that doesn't add up is amber with what it expected; a locked line keeps its category and minimum", () => {
    const base = edit();
    const html = render(edit({
      totals: { ...base.totals, totalSales: "9,000.00" },
      lines: [{ ...base.lines[0], qty: "3", locked: 2 }],
    }));
    expect(html).toContain("Items add up to ₱27,300.00.");
    expect(html).toContain("Some figures don&#x27;t add up");
    expect(html).toContain("At least 2: registered or closed short");
    expect(html).toContain("so its category can&#x27;t change");
    expect(html).toMatch(/<button[^>]*aria-label="Remove item 1"[^>]*disabled=""/);
  });

  it("a vendor with no TIN shows the amber note", () => {
    expect(render(edit({ vendorId: "v-ts" }))).toContain("Not on file — add it from the invoice");
  });

  it("a sent-back PO: the banner, ringed fields and the reply", () => {
    const html = render(edit({
      state: "SENT_BACK",
      sentBack: { by: "IT", byName: "Ivan Tan", note: "The PO number is wrong.", fields: ["poNumber", "totals"] },
    }));
    expect(html).toContain("Sent back by IT — Ivan Tan");
    expect(html).toContain("Flagged: PO number · Invoice totals");
    expect(html).toContain("What did you fix?");
    expect(html.match(/Flagged — check this one/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
