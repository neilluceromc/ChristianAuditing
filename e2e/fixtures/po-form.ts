/**
 * The A3 purchase order form's steps, shared (PO form redesign, Task 9). Like login.ts, this module holds no data and
 * reseeds nothing, so sharing it keeps every spec independent.
 *
 * The form has no native selects: the vendor, each item's category and unit, and the department are comboboxes (type
 * to filter, click the option). A field marked required carries an aria-hidden "*" in its label, so
 * `getByLabel(x, { exact: true })` never matches it — these steps find fields by role and exact name, or by the
 * totals' ids. Every new PO needs a PO number, paid by, a total amount due and a sales invoice (spec §5b.2).
 */
import path from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";

/** A small PNG that stands in for a phone photo of a sales invoice (120×160, under 1 KB). */
export const INVOICE_PNG = path.join(__dirname, "sales-invoice.png");
/** A one-page PDF (the delivery receipt fixture the documents specs already use). */
export const RECEIPT_PDF = path.join(__dirname, "delivery-receipt.pdf");

export type PaidBy = "Credit card" | "Debit card";

/** The Save button: "Save and send to IT" with IT gear on it, "Save and register" without. */
export const saveButton = (page: Page) => page.getByRole("main").getByRole("button", { name: /^Save and (send to IT|register)$/ });

/** Waits until the form has hydrated (the Save button carries React's fiber), so a click can't race it. */
export async function waitForPoForm(page: Page) {
  const save = saveButton(page);
  await save.waitFor({ state: "attached", timeout: 30_000 });
  await expect(async () => {
    expect(await save.evaluate((node) => Object.keys(node).some((k) => k.startsWith("__reactFiber$")))).toBe(true);
  }).toPass({ timeout: 30_000 });
}

/**
 * Picks an option in one of the form's comboboxes: types `search` (to filter) and clicks the option whose accessible
 * name matches `option` (a string matches the start of the name: options carry a sub-line, a TIN, a "New" tag).
 */
export async function pickCombo(scope: Page | Locator, name: string | RegExp, search: string, option: string | RegExp = search) {
  const box = scope.getByRole("combobox", { name, exact: typeof name === "string" ? true : undefined });
  await box.click();
  await box.fill(search);
  const opt = scope.getByRole("option", { name: typeof option === "string" ? new RegExp(`^${escape(option)}`) : option });
  await opt.first().click();
  await expect(box).toHaveAttribute("aria-expanded", "false");
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const vendorBox = (page: Page) => page.getByRole("combobox", { name: "Vendor", exact: true });
export const poNumberInput = (page: Page) => page.getByRole("textbox", { name: "Purchase order number", exact: true });
export const siInput = (page: Page) => page.getByRole("textbox", { name: "SI number", exact: true });
export const invoiceDateInput = (page: Page) => page.locator("#po-invoice input[type='date']");
export const totalInput = (page: Page, key: string) => page.locator(`#po-total-${key}`);
/** The sales invoice slot's file input (named by the slot's title). */
export const invoiceFile = (page: Page) => page.getByLabel("Sales invoice", { exact: true });

/** Item card `n` (1-based): an article named "Item n" or "Item n: <description>". */
export const itemCard = (page: Page, n: number) => page.getByRole("article", { name: new RegExp(`^Item ${n}(:|$)`) });

export interface PoItem {
  description: string;
  specs?: string;
  /** A category the list already has (picked by its exact name). */
  category: string;
  qty?: number;
  unit?: string;
  unitPrice: string;
}

/** Fills item card `n` (it must exist): description, specs, category, qty, unit, unit price. */
export async function fillItem(page: Page, n: number, item: PoItem) {
  await page.getByRole("textbox", { name: `Item ${n} description`, exact: true }).fill(item.description);
  if (item.specs) await page.getByRole("textbox", { name: `Item ${n} specs`, exact: true }).fill(item.specs);
  await pickCombo(page, `Category for item ${n}`, item.category, new RegExp(`^${escape(item.category)}( New)?$`));
  if (item.qty !== undefined) await page.getByRole("textbox", { name: `Item ${n} quantity`, exact: true }).fill(String(item.qty));
  if (item.unit) await pickCombo(page, `Unit for item ${n}`, item.unit, new RegExp(`^${escape(item.unit)}$`));
  await page.getByRole("textbox", { name: `Item ${n} unit price in pesos`, exact: true }).fill(item.unitPrice);
}

export interface MinimalPo {
  vendor: string;
  poNumber: string;
  si: string;
  /** yyyy-mm-dd */
  date: string;
  paidBy?: PaidBy;
  items: PoItem[];
  /** TOTAL AMOUNT DUE as typed; the other six totals stay blank unless `totals` names them. */
  totalAmountDue: string;
  totals?: Partial<Record<"totalSales" | "lessVat" | "netOfVat" | "discount" | "amountDue" | "addVat", string>>;
  /** The sales invoice file; defaults to the fixture PNG. */
  invoice?: string;
}

/**
 * Fills the new PO form with everything the server requires (spec §5b.2): vendor, PO number, SI number, invoice date,
 * paid by, the items, the total amount due and a sales invoice. Doesn't save. The page must be on the form already.
 */
export async function fillMinimalPo(page: Page, po: MinimalPo) {
  await waitForPoForm(page);
  await pickCombo(page, "Vendor", po.vendor);
  await poNumberInput(page).fill(po.poNumber);
  await siInput(page).fill(po.si);
  await invoiceDateInput(page).fill(po.date);
  await page.getByRole("radio", { name: new RegExp(`^${po.paidBy ?? "Credit card"}`) }).check();
  for (const [i, item] of po.items.entries()) {
    if (i > 0) await page.getByRole("button", { name: "Add another item", exact: true }).click();
    await fillItem(page, i + 1, item);
  }
  for (const [k, v] of Object.entries(po.totals ?? {})) await totalInput(page, k).fill(v);
  await totalInput(page, "totalAmountDue").fill(po.totalAmountDue);
  await invoiceFile(page).setInputFiles(po.invoice ?? INVOICE_PNG);
  await expect(page.locator("[data-po-field='doc:invoice']")).toContainText("Attached");
}

/**
 * Saves the form and waits for the PO's page; returns its id and PO-#### number.
 */
export async function savePo(page: Page): Promise<{ id: string; refNo: string }> {
  await saveButton(page).click();
  await page.waitForURL(/\/purchases\/(?!new)[^/]+$/, { timeout: 30_000 });
  const id = new URL(page.url()).pathname.split("/").pop()!;
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toHaveText(/^PO-\d{4}$/);
  return { id, refNo: (await heading.textContent())!.trim() };
}
