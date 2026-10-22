import { test, expect, type Browser, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { login } from "./fixtures/login";
import {
  fillItem, fillMinimalPo, INVOICE_PNG, invoiceDateInput, invoiceFile, itemCard, pickCombo, poNumberInput, RECEIPT_PDF,
  saveButton, savePo, siInput, totalInput, vendorBox, waitForPoForm,
} from "./fixtures/po-form";

/**
 * The A3 purchase order form and the Vendor wording (spec docs/superpowers/specs/2026-10-22-po-form-redesign-design.md),
 * in a real browser:
 *   1  Purchasing copies the owner's PCWORX invoice end to end — creating "Network cable" as IT gear on the spot — and
 *      it lands With IT, the totals ladder shown, IT's bell rung
 *   2  a duplicate PO number is refused with the exact message (and the field takes focus)
 *   3  totals off by ₱1: the amber line, the save still goes through, the PO page says "Totals didn't add up"
 *   4  IT registers the line and confirms "Network cable"; the admin categories page drops its "New" tag
 *   5  a stale form creating "network cable" again reuses it; creating it as an Office item is refused
 *   6  the rail ticks sections and counts them; its Totals link scrolls to the totals card
 *   7  axe on the form, light and dark; at 375 px nothing scrolls sideways
 *   8  the nav says Vendors; a vendor's page says VAT REG. TIN
 * Then the browser behaviour unit tests can't reach (carried from Tasks 4–7): the totals status box, the document
 * slots (thumbnail, drop, the drop highlight over a child, Preview, Replace, Remove — on the form and on the PO page,
 * two uploads at once each with its own spinner), where focus lands after a failed save, the layout at 1280–1366 px,
 * and the category combobox footer's Tab and Escape.
 *
 * Fixtures made here after the reseed: the vendor PCWORX (Infoworx Inc., VAT REG. TIN 004-845-988-00004), as on the
 * owner's invoice. Ids are never hard-coded: the next file reseeds.
 */

const db = new PrismaClient();

const PURCHASING = "purchasing@thebackroomop.com";
const IT = "it@thebackroomop.com";
const ADMIN = "admin@thebackroomop.com";

const PCWORX = {
  name: "PCWORX",
  registeredName: "Infoworx Inc.",
  registrationNo: "004-845-988-00004",
  address: "Unit 105 G/F W. Long Bldg., MacArthur Hi Way cor. Angeles-Magalang Road, Santo Cristo, 2009 Angeles City",
  category: "IT hardware & networking",
};

/** The PO case 1 creates. */
const pcworx = { id: "", refNo: "" };

test.beforeAll(async () => {
  execSync("npm run db:seed", { timeout: 120_000 });
  await db.vendor.create({ data: PCWORX });
  await db.userPreference.deleteMany({ where: { key: "ui:prefs" } });
});

test.afterAll(async () => {
  await db.userPreference.deleteMany({ where: { key: "ui:prefs" } });
  await db.$disconnect();
});

async function waitForHydration(target: Locator) {
  const el = target.first();
  await el.waitFor({ state: "attached", timeout: 20_000 });
  await expect(async () => {
    expect(await el.evaluate((node) => Object.keys(node).some((k) => k.startsWith("__reactFiber$")))).toBe(true);
  }).toPass({ timeout: 20_000 });
}

async function setCookie(page: Page, name: string, value: string) {
  await page.context().addCookies([{ name, value, url: new URL(page.url()).origin }]);
}

const PROMOTED_RULES = new Set<string>(["empty-table-header", "page-has-heading-one", "heading-order", "landmark-unique"]);
/** As e2e/po-intake.spec.ts runs it: moderate and above count, and so does any promoted rule. */
async function axeProblems(page: Page, label: string): Promise<string[]> {
  await page.waitForTimeout(700);
  const results = await new AxeBuilder({ page }).analyze();
  return results.violations
    .filter((v) =>
      v.impact === "moderate" || v.impact === "serious" || v.impact === "critical" || PROMOTED_RULES.has(v.id))
    .map((v) => `${label}: ${v.id} (${v.impact}) ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

const toast = (page: Page, text: string | RegExp) => page.locator("[data-toast-id]").filter({ hasText: text });
const header = (page: Page) => page.locator("main header").first();
const bell = (page: Page) => page.getByRole("button", { name: /^Notifications, \d+ unread$/ });
const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
/** The totals card's status box (role status, under TOTAL AMOUNT DUE). */
const totalsStatus = (page: Page) => page.locator("#po-totals").getByRole("status");
/** A document slot (on the form or the PO page), by its kind. */
const slot = (page: Page, kind: "invoice" | "official-receipt" | "delivery-receipt" | "warranty-slip") =>
  page.locator(`[data-po-field="doc:${kind}"]`);

/** The status box's tone, read off its inline style (neutral / settled = green / attention = amber). */
async function statusTone(page: Page): Promise<string> {
  const style = (await totalsStatus(page).getAttribute("style")) ?? "";
  return /--st-(\w+)-bg/.exec(style)?.[1] ?? "";
}

async function newForm(page: Page) {
  await page.goto("/purchases/new");
  await waitForPoForm(page);
}

const PNG_B64 = readFileSync(INVOICE_PNG).toString("base64");

// ── the PCWORX invoice ──────────────────────────────────────────────────────────────────────────────────────────────

test.describe("the owner's PCWORX invoice, copied on the A3 form", () => {
  test.describe.configure({ mode: "serial" });

  /** A Purchasing form opened before case 1 creates "Network cable": its category list never heard of it (case 5). */
  let stale: Page | null = null;

  test.beforeAll(async ({ browser }: { browser: Browser }, testInfo) => {
    test.setTimeout(120_000);
    const ctx = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
    stale = await ctx.newPage();
    await login(stale, PURCHASING);
    await newForm(stale);
  });

  test.afterAll(async () => {
    await stale?.context().close();
  });

  test("1 · Purchasing copies it end to end; it lands With IT with the ladder, and IT's bell rings", async ({ page }) => {
    test.setTimeout(180_000);
    await login(page, PURCHASING);
    await newForm(page);
    await expect(saveButton(page)).toHaveText("Save and register"); // nothing for IT yet

    // Vendor: the seller block shows the registered name, the VAT REG. TIN and the address
    await pickCombo(page, "Vendor", "PCWORX");
    const vendorCard = page.locator("#po-vendor");
    await expect(vendorBox(page)).toHaveValue(`PCWORX · Infoworx Inc. · TIN ${PCWORX.registrationNo}`);
    await expect(vendorCard).toContainText("Owned & operated by");
    await expect(vendorCard).toContainText("Infoworx Inc.");
    await expect(vendorCard).toContainText("VAT REG. TIN");
    await expect(vendorCard).toContainText(PCWORX.registrationNo);
    await expect(vendorCard).toContainText("MacArthur Hi Way");

    // Invoice & payment
    await poNumberInput(page).fill("2025-0418");
    await siInput(page).fill("44511");
    await invoiceDateInput(page).fill("2025-11-22");
    await page.getByRole("radio", { name: /^Credit card/ }).check();

    // The item: 1 box of Belden Cat6, 305 m — its category made on the spot as IT gear
    await page.getByRole("textbox", { name: "Item 1 description", exact: true }).fill("Belden Cat6 UTP cable, blue");
    await page.getByRole("textbox", { name: "Item 1 specs", exact: true }).fill("305 m");
    const category = page.getByRole("combobox", { name: "Category for item 1", exact: true });
    await category.click();
    await category.fill("Network cable");
    const create = page.getByText("Create “Network cable” as…");
    await expect(create).toBeVisible();
    await page.getByRole("button", { name: "IT gear", exact: true }).click();
    await expect(category).toHaveAttribute("aria-expanded", "false");
    await expect(category).toHaveValue("Network cable");
    await expect(category).toBeFocused(); // the footer closed the list and gave the field its focus back
    const card = itemCard(page, 1);
    await expect(card).toContainText("→ IT checks it");
    await expect(card).toContainText("New · IT confirms");
    // in the list it carries the "New" tag, under IT gear
    await category.click();
    await expect(page.getByRole("option", { name: "Network cable New", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(category).toHaveAttribute("aria-expanded", "false");
    const cat = await db.assetCategory.findFirstOrThrow({ where: { name: "Network cable" } });
    expect(cat.cls).toBe("IT");
    expect(cat.confirmedAt).toBeNull();

    await expect(page.getByRole("textbox", { name: "Item 1 quantity", exact: true })).toHaveValue("1");
    await pickCombo(page, "Unit for item 1", "box", /^box$/);
    await page.getByRole("textbox", { name: "Item 1 unit price in pesos", exact: true }).fill("9,100.00");
    await expect(card).toContainText("₱9,100.00"); // the amount, qty × unit price
    await expect(page.locator("#po-items")).toContainText("1 unit to IT");
    await expect(saveButton(page)).toHaveText("Save and send to IT");

    // The totals, typed off the invoice (discount blank): the status box goes green
    const totals: Record<string, string> = {
      totalSales: "9,100.00", lessVat: "975.00", netOfVat: "8,125.00", amountDue: "8,125.00", addVat: "975.00",
      totalAmountDue: "9,100.00",
    };
    for (const [k, v] of Object.entries(totals)) await totalInput(page, k).fill(v);
    await expect(totalsStatus(page)).toHaveText("The figures add up, and the items match total sales.");
    expect(await statusTone(page)).toBe("settled");

    // The sales invoice: a thumbnail of the photo, and the slot says Attached
    await invoiceFile(page).setInputFiles(INVOICE_PNG);
    const invoice = slot(page, "invoice");
    await expect(invoice).toContainText("Attached");
    await expect(invoice).toContainText("sales-invoice.png");
    await expect.poll(() => invoice.locator("img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(120);

    // every "Before you save" item is ticked
    const checklist = page.getByRole("list", { name: "Before you save" });
    await expect(checklist.getByRole("listitem")).toHaveCount(7);
    await expect(checklist.getByRole("listitem").filter({ hasText: "not yet" })).toHaveCount(0);

    const saved = await savePo(page);
    Object.assign(pcworx, saved);
    await expect(toast(page, `${saved.refNo} saved`)).toBeVisible();
    await expect(header(page)).toContainText("With IT");
    const purchase = page.getByRole("main");
    await expect(purchase).toContainText("2025-0418");
    await expect(purchase).toContainText("Credit card");
    await expect(purchase).toContainText("PCWORX");
    const dl = page.locator("dl[aria-label='Invoice totals']");
    await expect(dl.locator("[data-total='totalSales'] dd")).toHaveText("₱9,100.00");
    await expect(dl.locator("[data-total='lessVat'] dd")).toHaveText("₱975.00");
    await expect(dl.locator("[data-total='netOfVat'] dd")).toHaveText("₱8,125.00");
    await expect(dl.locator("[data-total='discount'] dd")).toHaveText("—");
    await expect(dl.locator("[data-total='amountDue'] dd")).toHaveText("₱8,125.00");
    await expect(dl.locator("[data-total='addVat'] dd")).toHaveText("₱975.00");
    await expect(dl.locator("[data-total='totalAmountDue'] dd")).toHaveText("₱9,100.00");
    await expect(purchase).not.toContainText("Totals didn't add up");
    await expect(page.locator("#unit-1")).toContainText("box");
    await expect(slot(page, "invoice")).toContainText("sales-invoice.png");

    const row = await db.purchaseOrder.findUniqueOrThrow({ where: { id: saved.id }, include: { lines: true, documents: true } });
    expect(row).toMatchObject({ state: "WITH_IT", poNumber: "2025-0418", invoiceRef: "44511", paidBy: "CREDIT_CARD", formV2: true, totalsConsistent: true });
    expect(row.purchasedAt?.toISOString().slice(0, 10)).toBe("2025-11-22");
    expect(row.lines).toHaveLength(1);
    expect(row.lines[0]).toMatchObject({ description: "Belden Cat6 UTP cable, blue", specs: "305 m", qty: 1, unit: "box", categoryId: cat.id });
    expect(Number(row.lines[0].unitPrice)).toBe(9100);
    expect(Number(row.totalAmountDue)).toBe(9100);
    expect(row.discount).toBeNull();
    expect(row.documents.map((d) => d.kind)).toEqual(["invoice"]);

    // IT's bell: a fresh seed has no notifications, so this PO is IT's first
    await login(page, IT);
    await page.goto("/purchases");
    await expect(bell(page)).toHaveAccessibleName("Notifications, 1 unread", { timeout: 20_000 });
  });

  test("2 · a duplicate PO number is refused with the exact message, and the field takes focus", async ({ page }) => {
    test.setTimeout(120_000);
    const before = await db.purchaseOrder.count();
    await login(page, PURCHASING);
    await newForm(page);
    await fillMinimalPo(page, {
      vendor: "TechServe PH", poNumber: " 2025-0418 ", si: "SI-90001", date: "2026-10-20",
      items: [{ description: "Wireless mice", category: "Mouse", qty: 2, unitPrice: "650" }],
      totalAmountDue: "1,300.00",
    });
    await saveButton(page).click();
    const message = `PO 2025-0418 is already used on ${pcworx.refNo}`;
    await expect(page.locator("[data-po-field='poNumber']")).toContainText(message);
    await expect(poNumberInput(page)).toBeFocused();
    await expect(page).toHaveURL(/\/purchases\/new$/);
    expect(await db.purchaseOrder.count()).toBe(before);
  });

  test("3 · totals off by ₱1 show the amber line and still save; the PO page says they didn't add up", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, PURCHASING);
    await newForm(page);
    await fillMinimalPo(page, {
      vendor: "Metro Office Supply", poNumber: "2025-0419", si: "SI-90002", date: "2026-10-21", paidBy: "Debit card",
      items: [{ description: "Ergonomic task chair", category: "Furniture", qty: 1, unitPrice: "1,000.00" }],
      totals: { totalSales: "1,001.00" },
      totalAmountDue: "1,001.00",
    });
    const warn = page.locator("#po-total-totalSales-warn");
    await expect(warn).toHaveText("Items add up to ₱1,000.00.");
    await expect(totalInput(page, "totalSales")).toHaveAttribute("aria-describedby", "po-total-totalSales-warn");
    expect(await statusTone(page)).toBe("attention");
    await expect(totalsStatus(page)).toContainText("Some figures don't add up");
    await expect(saveButton(page)).toHaveText("Save and register");

    const saved = await savePo(page);
    const note = page.getByRole("main").getByText("Totals didn't add up on the PO");
    await expect(note).toBeVisible();
    await expect(page.getByRole("main")).toContainText("Total sales (VAT inclusive): Items add up to ₱1,000.00.");
    const row = await db.purchaseOrder.findUniqueOrThrow({ where: { id: saved.id } });
    expect(row.totalsConsistent).toBe(false);
    expect(row.paidBy).toBe("DEBIT_CARD");
  });

  test("4 · IT registers the line and confirms Network cable; the admin categories page drops its New tag", async ({ page }) => {
    test.setTimeout(180_000);
    // before: the admin categories page tags it as new, from a PO
    await login(page, ADMIN);
    await page.goto("/admin/asset-categories");
    const catRow = page.getByRole("row", { name: /Network cable/ });
    await expect(catRow).toContainText("New · from a PO");

    await login(page, IT);
    await page.goto(`/purchases/${pcworx.id}/register`);
    const card = page.getByRole("region", { name: /^Line 01 · Belden Cat6/ });
    await waitForHydration(card.getByLabel("How many arrived now"));
    const ask = card.getByRole("group", { name: "New category 'Network cable' — Confirm or choose another" });
    await expect(ask).toBeVisible();
    await ask.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(ask.getByRole("button", { name: "Confirmed", exact: true })).toHaveAttribute("aria-pressed", "true");
    await card.getByLabel("How many arrived now").fill("1");
    const model = card.getByRole("combobox", { name: "Model", exact: true });
    await expect(model).toBeVisible();
    await model.fill("Cat6 UTP 305 m");
    await card.getByLabel("Tag 1", { exact: true }).fill("BR-NC-0418");
    await card.getByLabel("Serial 1", { exact: true }).fill("SN-BELDEN-0418");
    await page.getByRole("button", { name: "Register 1 asset" }).click();
    await expect(toast(page, `Registered 1 from ${pcworx.refNo}`)).toBeVisible({ timeout: 30_000 });

    const cat = await db.assetCategory.findFirstOrThrow({ where: { name: "Network cable" } });
    expect(cat.confirmedAt).not.toBeNull();

    await login(page, ADMIN);
    await page.goto("/admin/asset-categories");
    await expect(page.getByRole("row", { name: /Network cable/ })).toBeVisible();
    await expect(page.getByRole("row", { name: /Network cable/ })).not.toContainText("New · from a PO");
  });

  test("5 · a stale form: creating network cable again reuses it; as an Office item it is refused", async () => {
    test.setTimeout(120_000);
    const page = stale!;
    await page.bringToFront();
    const category = page.getByRole("combobox", { name: "Category for item 1", exact: true });
    await category.click();
    await category.fill("network cable");
    // this form's list was read before case 1 made it, so it offers to create one
    await expect(page.getByText("Create “network cable” as…")).toBeVisible();
    await page.getByRole("button", { name: "Office item", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "'Network cable' already exists as IT gear — pick it from the list." })).toBeVisible();
    await expect(category).toHaveAttribute("aria-expanded", "true");

    await page.getByRole("button", { name: "IT gear", exact: true }).click();
    await expect(category).toHaveAttribute("aria-expanded", "false");
    await expect(category).toHaveValue("Network cable");
    await expect(itemCard(page, 1)).toContainText("→ IT checks it");
    await expect(itemCard(page, 1)).not.toContainText("New · IT confirms"); // IT confirmed it in case 4
    expect(await db.assetCategory.count({ where: { name: { equals: "network cable", mode: "insensitive" } } })).toBe(1);
  });

  test("6 · the rail ticks each section and counts them; its Totals link scrolls to the totals card", async ({ page }) => {
    test.setTimeout(120_000);
    // at 640 px the totals card wraps under the cards, so it starts below the fold
    await page.setViewportSize({ width: 640, height: 760 });
    await login(page, PURCHASING);
    await newForm(page);
    const rail = page.getByRole("navigation", { name: "On this page" });
    const progress = rail.getByText(/^\d of 5 sections done$/);
    const done = (label: string) => rail.getByRole("link", { name: `${label} (done)` });
    await expect(progress).toHaveText("0 of 5 sections done");
    await expect(rail.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");

    await pickCombo(page, "Vendor", "PCWORX");
    await expect(done("Vendor")).toBeVisible();
    await expect(progress).toHaveText("1 of 5 sections done");

    await poNumberInput(page).fill("2025-0420");
    await siInput(page).fill("44512");
    await invoiceDateInput(page).fill("2025-11-23");
    await expect(done("Invoice & payment")).toHaveCount(0); // paid by is still missing
    await page.getByRole("radio", { name: /^Debit card/ }).check();
    await expect(done("Invoice & payment")).toBeVisible();
    await expect(progress).toHaveText("2 of 5 sections done");

    await fillItem(page, 1, { description: "Belden Cat6 UTP cable, grey", category: "Network cable", qty: 2, unitPrice: "9,100.00" });
    await expect(done("Items")).toBeVisible();
    await invoiceFile(page).setInputFiles(INVOICE_PNG);
    await expect(done("Documents")).toBeVisible();
    await expect(progress).toHaveText("4 of 5 sections done");
    await totalInput(page, "totalAmountDue").fill("18,200.00");
    await expect(done("Totals")).toBeVisible();
    await expect(progress).toHaveText("5 of 5 sections done");
    await expect(rail.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "5");

    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.locator("#po-totals")).not.toBeInViewport();
    await rail.getByRole("link", { name: /^Totals/ }).click();
    await expect(page).toHaveURL(/#po-totals$/);
    await expect(page.locator("#po-totals")).toBeInViewport();
  });

  test("7 · axe on the form, light and dark; at 375 px the form doesn't scroll sideways", async ({ page }) => {
    test.setTimeout(240_000);
    const problems: string[] = [];
    await login(page, PURCHASING);
    for (const theme of ["light", "dark"] as const) {
      await setCookie(page, "br.theme", theme);
      await newForm(page);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      problems.push(...(await axeProblems(page, `new PO form, empty (${theme})`)));
      // filled: the seller block, a new-category route line, a held thumbnail, an amber totals line
      await pickCombo(page, "Vendor", "PCWORX");
      await fillItem(page, 1, { description: "Belden Cat6 UTP cable, blue", category: "Network cable", qty: 1, unitPrice: "9,100.00" });
      await totalInput(page, "totalSales").fill("9,000.00");
      await invoiceFile(page).setInputFiles(INVOICE_PNG);
      await expect(slot(page, "invoice")).toContainText("Attached");
      problems.push(...(await axeProblems(page, `new PO form, filled (${theme})`)));
      // the category list open, with its Create footer
      const category = page.getByRole("combobox", { name: "Category for item 1", exact: true });
      await category.click();
      await category.fill("Fibre patch cord");
      await expect(page.getByText("Create “Fibre patch cord” as…")).toBeVisible();
      problems.push(...(await axeProblems(page, `category list with its footer (${theme})`)));
      await page.keyboard.press("Escape");
    }
    expect(problems, "axe (moderate and above)").toEqual([]);

    await setCookie(page, "br.theme", "light");
    await page.setViewportSize({ width: 375, height: 812 });
    await newForm(page);
    expect(await noSidewaysScroll(page), "empty form: no sideways scroll").toBe(true);
    await pickCombo(page, "Vendor", "PCWORX");
    await fillItem(page, 1, { description: "Belden Cat6 UTP cable, blue", specs: "305 m", category: "Network cable", qty: 1, unit: "box", unitPrice: "9,100.00" });
    await totalInput(page, "totalSales").fill("9,000.00");
    await invoiceFile(page).setInputFiles(INVOICE_PNG);
    await expect(slot(page, "invoice")).toContainText("Attached");
    expect(await noSidewaysScroll(page), "filled form: no sideways scroll").toBe(true);
    // stacked: the rail, then the cards, then the totals with Save — all inside the screen
    for (const id of ["#po-vendor", "#po-invoice", "#po-items", "#po-docs", "#po-totals"]) {
      const b = (await page.locator(id).boundingBox())!;
      expect(b.x, `${id} starts on screen`).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width, `${id} ends on screen`).toBeLessThanOrEqual(375);
    }
    const save = (await saveButton(page).boundingBox())!;
    expect(save.x + save.width).toBeLessThanOrEqual(375);
  });

  test("8 · the nav says Vendors; a vendor's page says VAT REG. TIN", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await login(page, PURCHASING);
    await page.goto("/purchases");
    const sidebar = page.getByRole("navigation", { name: "Workspace" });
    await expect(sidebar.getByRole("link", { name: /^Vendors/ })).toHaveAttribute("href", "/purchases/suppliers");
    await expect(sidebar.getByRole("link", { name: /^Suppliers/ })).toHaveCount(0);
    const vendor = await db.vendor.findUniqueOrThrow({ where: { name: "PCWORX" } });
    await page.goto(`/purchases/suppliers/${vendor.id}`);
    const main = page.getByRole("main");
    await expect(main).toContainText("VAT REG. TIN");
    await expect(main).toContainText(PCWORX.registrationNo);
    await expect(main).not.toContainText("Registration no.");
    await expect(main).not.toContainText(/supplier/i);
  });
});

// ── what only a browser can check ───────────────────────────────────────────────────────────────────────────────────

test.describe("the A3 form in a browser", () => {
  test("the totals status: neutral while correct but incomplete, amber only when a line is wrong, green when it all adds up", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, PURCHASING);
    await newForm(page);
    await fillItem(page, 1, { description: "Wireless mice", category: "Mouse", qty: 2, unitPrice: "560" });
    await expect(totalsStatus(page)).toHaveText("Type the total amount due from the invoice.");
    expect(await statusTone(page)).toBe("neutral");

    await totalInput(page, "totalSales").fill("1,120.00");
    await totalInput(page, "lessVat").fill("120.00");
    await totalInput(page, "netOfVat").fill("1,000.00");
    expect(await statusTone(page)).toBe("neutral"); // right so far, not complete
    await expect(page.locator("#po-totals [id$='-warn']")).toHaveCount(0);

    await totalInput(page, "netOfVat").fill("1,010.00");
    await expect(page.locator("#po-total-netOfVat-warn")).toHaveText("Total sales − VAT = ₱1,000.00.");
    await expect.poll(() => statusTone(page)).toBe("attention");

    await totalInput(page, "netOfVat").fill("1,000.00");
    await expect(page.locator("#po-total-netOfVat-warn")).toHaveCount(0);
    await expect.poll(() => statusTone(page)).toBe("neutral");

    await totalInput(page, "amountDue").fill("1,000.00");
    await totalInput(page, "addVat").fill("120.00");
    await totalInput(page, "totalAmountDue").fill("1,120.00");
    await expect.poll(() => statusTone(page)).toBe("settled");
    await expect(totalsStatus(page)).toHaveText("The figures add up, and the items match total sales.");

    // an unreadable figure is amber too
    await totalInput(page, "discount").fill("1.2.3");
    await expect(page.locator("#po-total-discount-warn")).toHaveText("Type an amount, like 9,100.00");
    await expect.poll(() => statusTone(page)).toBe("attention");
  });

  test("document slots on the form: thumbnail, drop (the highlight holds over a child), Preview, Replace, Remove", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, PURCHASING);
    await newForm(page);
    const docs = page.locator("#po-docs");
    await expect(docs).toContainText("0 of 4 attached");

    // drop a file on the empty official receipt slot; crossing onto the zone's own icon keeps the highlight on
    const zone = slot(page, "official-receipt").locator("label");
    const highlighted = () => zone.evaluate((el) => el.classList.contains("bg-accent-tint"));
    expect(await highlighted()).toBe(false);
    await zone.evaluate((el) => {
      el.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }));
      el.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }));
    });
    await expect.poll(highlighted).toBe(true);
    await zone.evaluate((el) => {
      const child = el.querySelector("span")!;
      child.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, relatedTarget: el, dataTransfer: new DataTransfer() }));
      el.dispatchEvent(new DragEvent("dragleave", { bubbles: true, cancelable: true, relatedTarget: child, dataTransfer: new DataTransfer() }));
      child.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }));
    });
    await page.waitForTimeout(150);
    expect(await highlighted(), "the highlight holds while the drag is over the zone's icon").toBe(true);
    // leaving the zone for good ends it
    await zone.evaluate((el) => {
      el.dispatchEvent(new DragEvent("dragleave", { bubbles: true, cancelable: true, relatedTarget: document.body, dataTransfer: new DataTransfer() }));
    });
    await expect.poll(highlighted).toBe(false);
    // and a drop takes the file
    await zone.evaluate((el, b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], "official-receipt.png", { type: "image/png" }));
      el.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
      el.querySelector("span")!.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
    }, PNG_B64);
    const receipt = slot(page, "official-receipt");
    await expect(receipt).toContainText("Attached");
    await expect(receipt).toContainText("official-receipt.png");
    await expect.poll(() => receipt.locator("img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(120);

    // the sales invoice: a PDF shows a sketched page, not an image
    await invoiceFile(page).setInputFiles(RECEIPT_PDF);
    const invoice = slot(page, "invoice");
    await expect(invoice).toContainText("delivery-receipt.pdf");
    await expect(invoice.locator("img")).toHaveCount(0);
    await expect(invoice).toContainText("PDF");
    await expect(docs).toContainText("2 of 4 attached");

    // Preview opens the held file in a new tab (the PNG: headless Chromium downloads a PDF instead of showing it)
    const popup = page.waitForEvent("popup");
    await receipt.getByRole("button", { name: "Preview" }).click();
    const tab = await popup;
    // (a noopener tab showing an image never fires "load" to Playwright: read the page itself)
    await expect.poll(() => tab.evaluate(() => location.href).catch(() => "")).toMatch(/^blob:http/);
    await expect.poll(() => tab.evaluate(() => document.querySelector("img")?.naturalWidth ?? 0)).toBe(120);
    await tab.close();

    // Replace swaps what is held; Remove takes it back
    const chooser = page.waitForEvent("filechooser");
    await invoice.getByRole("button", { name: "Replace" }).click();
    await (await chooser).setFiles(INVOICE_PNG);
    await expect(invoice).toContainText("sales-invoice.png");
    await expect.poll(() => invoice.locator("img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(120);
    await receipt.getByRole("button", { name: "Remove official receipt" }).click();
    await expect(receipt).toContainText("Drop a file or browse");
    await expect(receipt).not.toContainText("Attached");
    await expect(docs).toContainText("1 of 4 attached");
    // a refused file says why, on its slot
    await page.getByLabel("Warranty slip", { exact: true }).setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
    await expect(slot(page, "warranty-slip")).toContainText("That type isn't allowed. Accepted: PDF, PNG, JPG.");
  });

  test("document slots on the PO page: Replace, Remove, and two uploads at once each keep their own spinner", async ({ page }) => {
    test.setTimeout(180_000);
    await login(page, PURCHASING);
    await newForm(page);
    await fillMinimalPo(page, {
      vendor: "TechServe PH", poNumber: "2025-0501", si: "SI-90501", date: "2026-10-21",
      items: [{ description: "USB headsets", category: "Headset", qty: 2, unitPrice: "1,250.00" }],
      totalAmountDue: "2,500.00",
    });
    const { id } = await savePo(page);
    const invoice = slot(page, "invoice");
    await expect(invoice).toContainText("sales-invoice.png");
    await waitForHydration(invoice.getByRole("button", { name: "Replace" }));
    await expect.poll(() => invoice.locator("img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(120);

    // Preview is the stored file, inline
    const href = await invoice.getByRole("link", { name: "Preview" }).getAttribute("href");
    expect(href).toMatch(/\?inline=1$/);
    const res = await page.request.get(href!);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("image/png");
    expect(res.headers()["content-disposition"]).toMatch(/^inline/);

    // Replace adds a new sales invoice; the slot shows the newest, the earlier one moves to Other documents
    const chooser = page.waitForEvent("filechooser");
    await invoice.getByRole("button", { name: "Replace" }).click();
    await (await chooser).setFiles(RECEIPT_PDF);
    await expect(toast(page, "Sales invoice saved")).toBeVisible({ timeout: 30_000 });
    await expect(invoice).toContainText("delivery-receipt.pdf");
    await expect(page.getByRole("main")).toContainText("Sales invoice · earlier");

    // Remove marks the newest superseded (nothing deleted): the earlier copy is back in the slot
    await invoice.getByRole("button", { name: "Remove sales invoice" }).click();
    const dialog = page.getByRole("dialog", { name: "Remove the sales invoice?" });
    await dialog.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(toast(page, "Sales invoice removed")).toBeVisible({ timeout: 30_000 });
    await expect(invoice).toContainText("sales-invoice.png");
    const docs = await db.requestDocument.findMany({ where: { orderId: id, kind: "invoice" }, orderBy: { createdAt: "asc" } });
    expect(docs).toHaveLength(2);
    expect(docs[0].supersededAt).toBeNull();
    expect(docs[1].supersededAt).not.toBeNull();

    // two slots at once: each store is held back a while (the second longer), so the first finishes while the second
    // is still going — and only the second keeps its spinner
    const delays: Record<string, number> = { "official-receipt": 2_500, "delivery-receipt": 6_000 };
    await page.route(`**/purchases/${id}`, async (route) => {
      const req = route.request();
      if (req.method() !== "POST" || !req.headers()["next-action"]) return route.continue();
      const body = req.postDataBuffer()?.toString("latin1") ?? "";
      const kind = Object.keys(delays).find((k) => body.includes(`\r\n\r\n${k}\r\n`));
      if (kind) await new Promise((r) => setTimeout(r, delays[kind]));
      await route.continue();
    });
    const official = slot(page, "official-receipt");
    const delivery = slot(page, "delivery-receipt");
    await page.getByLabel("Official receipt", { exact: true }).setInputFiles(INVOICE_PNG);
    await page.getByLabel("Delivery receipt", { exact: true }).setInputFiles(RECEIPT_PDF);
    await expect(official).toContainText("Uploading…");
    await expect(delivery).toContainText("Uploading…");
    await expect(official).not.toContainText("Uploading…", { timeout: 20_000 });
    await expect(delivery, "the second slot's spinner outlives the first's").toContainText("Uploading…");
    await expect(delivery).not.toContainText("Uploading…", { timeout: 30_000 });
    await expect(official).toContainText("sales-invoice.png", { timeout: 20_000 });
    await expect(delivery).toContainText("delivery-receipt.pdf", { timeout: 20_000 });
    await page.unrouteAll({ behavior: "ignoreErrors" });
    expect(await db.requestDocument.count({ where: { orderId: id, kind: { in: ["official-receipt", "delivery-receipt"] } } })).toBe(2);
  });

  test("after a failed save, focus goes to what's wrong: the qty input, the refused file's Replace (a SIMULATED server refusal), the rate-limit notice", async ({ page }) => {
    test.setTimeout(180_000);
    await login(page, PURCHASING);
    await newForm(page);
    await fillMinimalPo(page, {
      vendor: "TechServe PH", poNumber: "2025-0601", si: "SI-90601", date: "2026-10-21",
      items: [{ description: "Webcams", category: "Webcam", qty: 2, unitPrice: "2,000.00" }],
      totalAmountDue: "4,000.00",
    });
    const qty = page.getByRole("textbox", { name: "Item 1 quantity", exact: true });
    await qty.fill("0");
    await page.evaluate(() => window.scrollTo(0, 0));
    await saveButton(page).click();
    await expect(itemCard(page, 1)).toContainText("At least one");
    await expect(qty, "the qty input, not its − button").toBeFocused();
    await expect(qty).toBeInViewport();
    await qty.fill("2");

    // SIMULATED server refusal: the server refuses the held sales invoice and Replace takes focus (not Preview). The
    // browser's own check applies the same rules, so no real file can reach this path: the page retypes the file as it
    // goes into the save's FormData — the server sees an image/gif named .png. The real FormData.set is put back in a
    // finally, so a failure here can't leave the patch in place for the rest of the test.
    await page.evaluate(() => {
      const w = window as unknown as { __realSet?: FormData["set"] };
      w.__realSet = FormData.prototype.set;
      FormData.prototype.set = function (this: FormData, name: string, value: string | Blob, fileName?: string) {
        if (name === "doc:invoice" && value instanceof File) value = new File([value], value.name, { type: "image/gif" });
        // the native set takes a third argument (the file name) only with a Blob: pass it on only when given
        const real = w.__realSet as (...args: unknown[]) => void;
        return fileName === undefined ? real.call(this, name, value) : real.call(this, name, value, fileName);
      } as FormData["set"];
    });
    try {
      await saveButton(page).click();
      await expect(slot(page, "invoice")).toContainText("That type isn't allowed. Accepted: PDF, PNG, JPG.");
      await expect(slot(page, "invoice").getByRole("button", { name: "Replace" })).toBeFocused();
      await expect(slot(page, "invoice").getByRole("button", { name: "Replace" })).toBeInViewport();
    } finally {
      await page.evaluate(() => {
        FormData.prototype.set = (window as unknown as { __realSet: FormData["set"] }).__realSet;
      });
    }

    // rate-limited: the notice comes into view and takes focus
    const user = await db.user.findUniqueOrThrow({ where: { email: PURCHASING } });
    await db.rateEvent.createMany({
      data: Array.from({ length: RATE_LIMITS.mutation.limit }, () => ({ userId: user.id, kind: "mutation", at: new Date() })),
    });
    try {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await saveButton(page).click();
      const notice = page.locator("main [tabindex='-1']").filter({ has: page.getByRole("alert") }).first();
      await expect(notice).toContainText("You've made 60 changes this minute — the cap");
      await expect(notice).toBeFocused();
      await expect(notice).toBeInViewport();
    } finally {
      await db.rateEvent.deleteMany({ where: { userId: user.id } });
    }
    await expect(page).toHaveURL(/\/purchases\/new$/);
  });

  test("at 1280 and 1366 px the totals column sits beside the cards, and the rail stays in view", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, PURCHASING);
    for (const width of [1280, 1366]) {
      await page.setViewportSize({ width, height: 800 });
      await newForm(page);
      const items = (await page.locator("#po-items").boundingBox())!;
      const totals = (await page.locator("#po-totals").boundingBox())!;
      const rail = (await page.getByRole("navigation", { name: "On this page" }).boundingBox())!;
      expect(totals.x, `${width}px: the totals card is right of the items`).toBeGreaterThanOrEqual(items.x + items.width);
      expect(totals.y, `${width}px: the totals card starts at the top, not under the items`).toBeLessThan(items.y);
      expect(rail.x + rail.width).toBeLessThanOrEqual(items.x);
      expect(items.width, `${width}px: the item cards keep a usable width`).toBeGreaterThanOrEqual(420);
      expect(await noSidewaysScroll(page), `${width}px: no sideways scroll`).toBe(true);
      // scrolled down to the items, the rail and the totals' first figures are still on screen (both sticky); the
      // totals card is taller than an 800px screen, so its Save button comes into view at the bottom of the form
      await page.evaluate(() => window.scrollTo(0, document.querySelector("#po-items")!.getBoundingClientRect().top + window.scrollY - 40));
      await expect(page.getByRole("navigation", { name: "On this page" })).toBeInViewport();
      await expect(page.locator("#po-total-totalSales")).toBeInViewport();
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await expect(saveButton(page)).toBeInViewport();
    }
  });

  test("at 1366×768 the Save button is on screen on load, and stays there scrolled down to the items", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1366, height: 768 });
    await login(page, PURCHASING);
    await newForm(page);
    // the totals card is taller than the screen: it scrolls inside itself, with Save pinned to its bottom edge
    await expect(saveButton(page), "on load, before any page scroll").toBeInViewport({ ratio: 1 });
    await expect(page.locator("#po-total-totalSales")).toBeInViewport();
    await page.evaluate(() => window.scrollTo(0, document.querySelector("#po-items")!.getBoundingClientRect().top + window.scrollY - 40));
    await expect(saveButton(page), "scrolled down to the items").toBeInViewport({ ratio: 1 });
    await expect(page.getByRole("complementary", { name: "Invoice totals and save" }).getByRole("link", { name: "Cancel", exact: true }))
      .toBeInViewport();
  });

  test("the category footer: Tab from the field reaches Create, Escape from the footer closes the list and returns focus", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, PURCHASING);
    await newForm(page);
    const category = page.getByRole("combobox", { name: "Category for item 1", exact: true });
    await category.click();
    await category.fill("Patch panel");
    await expect(page.getByText("Create “Patch panel” as…")).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "IT gear", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Office item", exact: true })).toBeFocused();
    await expect(category).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByRole("button", { name: "IT gear", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(category).toHaveAttribute("aria-expanded", "false");
    await expect(category).toBeFocused();
    expect(await db.assetCategory.count({ where: { name: { equals: "Patch panel", mode: "insensitive" } } })).toBe(0);

    // Tab past the footer leaves the field's list closed
    await category.fill("Patch panel");
    await expect(page.getByText("Create “Patch panel” as…")).toBeVisible();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(category).toHaveAttribute("aria-expanded", "false");

    // the footer's button by keyboard: Enter creates it as an Office item and refocuses the field
    await category.click();
    await category.fill("Patch panel");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Office item", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(category).toHaveAttribute("aria-expanded", "false");
    await expect(category).toHaveValue("Patch panel");
    await expect(category).toBeFocused();
    await expect(itemCard(page, 1)).toContainText("→ Ready to register");
    const made = await db.assetCategory.findFirstOrThrow({ where: { name: "Patch panel" } });
    expect(made.cls).toBe("PURCHASING");
    expect(made.confirmedAt).not.toBeNull(); // office items are confirmed at once
  });
});
