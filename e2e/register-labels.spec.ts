import { test, expect, type Locator, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import { SEED_PASSWORD } from "../prisma/fixtures";

/**
 * Phase 34 — the Register and Labels tabs of "New equipment" (spec §3–§5),
 * seventeen cases, each independent (every case registers its own assets, with
 * serials stamped by case number and Date.now()):
 *   1    IT's nine category cards in order, no Uncategorised / Phone /
 *        Peripheral, "in stock" on Laptop, axe on the bare page.
 *   2    a known model typed in lower case resolves, and the Type is still asked
 *        (empty and required: the model never sets it — Phase 36).
 *   3    the one-unit serial is required, and a scanner's Enter never submits
 *        (Review Focus 2).
 *   4    a new model asks for its type and is registered with it; a known model
 *        whose newest asset has no type is asked like a new one (ruling R9).
 *   5    a batch of 3 by paste-fill (CRLF, trailing newline), a duplicate row
 *        refused then fixed; one purchase record and one purchase.recorded row.
 *   6    Give to someone (IT direct) deploys to the picked employee.
 *   7    Purchasing "In use" files a lifecycle_assign approval (serial optional);
 *        the approval is closed by state in `finally` (P-18).
 *   8    Purchase and warranty: vendor, dates, refs, money and the live total,
 *        the 2 yr warranty, two document slots — all stored on both units.
 *   9    Register lands on Labels with the batch ticked; start at sticker 4.
 *   10   Print stamps labelPrintedAt once; a reprint by tags never moves it
 *        (Review Focus 5, ruling R16).
 *   11   Reprint other tags: Tags + Make sheet puts the barcode on the sheet.
 *   12   Register and add another keeps category and model, clears the serial,
 *        and toasts (ruling R7).
 *   13   the live label preview shows the typed model and the typed tag.
 *   14   Purchasing's four cards in name order; its serial is optional.
 *   15   Other suggests no tag: the Tag box starts empty (Phase 36).
 *   16   a category with no tag prefix and no types registers on a typed tag
 *        (Phase 36: prefixes are gone) and the asset has no type.
 *   17   printing a list selection (`?ids=`) stamps its waiting assets too
 *        (ruling R26, M5).
 *
 * Approvals are only ever closed by state, never deleted; audit rows are never
 * deleted. Assets created here stay (the seed in beforeAll resets).
 */

const db = new PrismaClient();

const IT = "it@thebackroomop.com";
// Purchase orders (spec §4 way 3): the direct Register is IT's and an admin's; Purchasing registers from a PO. The
// Purchasing-class cases below register directly as an admin, on the Purchasing class (?cls=PURCHASING).
const ADMIN = "admin@thebackroomop.com";
const KNOWN_LAPTOP = "ThinkPad T14 Gen 4";

test.beforeAll(async () => {
  execSync("npm run db:seed", { timeout: 120_000 });
});
test.afterAll(async () => {
  await db.$disconnect();
});

// Copied from e2e/queues-records-ux.spec.ts — house rule: never import helpers across spec files.
async function login(page: Page, email: string) {
  await page.goto("/logout");
  await page.getByRole("link", { name: /^Log in/ }).click();
  await page.locator('[data-login-ready="true"]').waitFor();
  await page.getByLabel("Work email", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Password", { exact: true }).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  // Phase 47 (spec §5.4): the first page after a sign-in rewrites the settings cookies from the person's saved prefs
  // (UiPrefsSync → restoreUiPrefs, stamping br.uid) and refreshes; wait for it, so the next step never races that refresh.
  const { id } = await db.user.findUniqueOrThrow({ where: { email: email.toLowerCase() }, select: { id: true } });
  await expect
    .poll(async () => (await page.context().cookies()).find((c) => c.name === "br.uid")?.value, { timeout: 30_000 })
    .toBe(id);
}

// Copied from e2e/queues-records-ux.spec.ts.
async function expectNoSeriousAxe(page: Page) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(700);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
}

// Copied from e2e/queues-records-ux.spec.ts.
async function waitForHydration(target: Locator) {
  const el = target.first();
  await el.waitFor({ state: "attached", timeout: 20_000 });
  await expect(async () => {
    expect(await el.evaluate((node) => Object.keys(node).some((k) => k.startsWith("__reactFiber$")))).toBe(true);
  }).toPass({ timeout: 20_000 });
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function openRegister(page: Page, cls?: "PURCHASING") {
  await page.goto("/inventory/register" + (cls ? "?cls=PURCHASING" : ""));
  await expect(page.getByRole("heading", { name: "New equipment", level: 1 })).toBeVisible({ timeout: 20_000 });
  await waitForHydration(page.getByRole("button", { name: /^Laptop\b|^Vehicle\b/ }).first());
}

/** A card is named "{name} {N} in stock" or "{name} None yet" — anchored at both ends, since "Laptop" prefixes "Laptop Bag". */
const categoryCard = (page: Page, name: string) =>
  page.getByRole("button", { name: new RegExp(`^${escapeRe(name)} (\\d+ in stock|None yet)$`) });

async function pickCategory(page: Page, name: string) {
  await categoryCard(page, name).click();
}

/** Ruling R11: getByLabel("Model") also hits the "Model and quantity" region, and a non-exact name hits the type select. */
const modelBox = (page: Page) => page.getByRole("combobox", { name: "Model", exact: true });
const serialBox = (page: Page) => page.getByRole("textbox", { name: "Serial number", exact: true });
const typeSelect = (page: Page) => page.getByRole("combobox", { name: "Type", exact: true });
const tagBox = (page: Page) => page.getByRole("textbox", { name: "Tag", exact: true });

// Phase 36: staff type their own tag. Unique per run, 20 characters at most.
let tagSeq = 0;
const newTag = () => `E${Date.now().toString(36).slice(-6).toUpperCase()}-${++tagSeq}`;

/** Phase 36: the Type is always asked when the category has several; picks the first real one. */
async function pickAnyType(page: Page) {
  if ((await typeSelect(page).count()) > 0) await typeSelect(page).selectOption({ index: 1 });
}

/** Types the model and picks it from the list by its exact name. */
async function pickModel(page: Page, typed: string, option: string) {
  await modelBox(page).fill(typed);
  await page.getByRole("option", { name: option, exact: true }).click();
  await expect(modelBox(page)).toHaveValue(option);
}

async function setQuantity(page: Page, n: number) {
  const box = page.getByRole("textbox", { name: "How many", exact: true });
  await box.fill(String(n));
  await box.blur();
  await expect(page.getByRole("textbox", { name: `Serial ${n}`, exact: true })).toBeVisible();
}

/** Register's landing: `/inventory/labels?just=<purchaseRecordId>`; returns the record id. */
async function landedRecord(page: Page): Promise<string> {
  await page.waitForURL(/\/inventory\/labels\?just=/, { timeout: 30_000 });
  const just = new URL(page.url()).searchParams.get("just");
  expect(just).toBeTruthy();
  return just!;
}

/** A fresh batch of `n` known-model laptops through the real form; returns the record and its tags in order. */
async function registerLaptops(page: Page, n: number, stamp: string) {
  await openRegister(page);
  await pickCategory(page, "Laptop");
  await pickModel(page, KNOWN_LAPTOP, KNOWN_LAPTOP);
  await pickAnyType(page);
  await setQuantity(page, n);
  for (let i = 1; i <= n; i++) {
    await page.getByRole("textbox", { name: `Tag ${i}`, exact: true }).fill(newTag());
    await page.getByRole("textbox", { name: `Serial ${i}`, exact: true }).fill(`${stamp}-${i}`);
  }
  await page.getByRole("button", { name: `Register ${n} laptops`, exact: true }).click();
  const recordId = await landedRecord(page);
  const assets = await db.asset.findMany({ where: { purchaseRecordId: recordId }, orderBy: { tag: "asc" }, select: { id: true, tag: true } });
  expect(assets).toHaveLength(n);
  return { recordId, assets };
}

test.describe("register — the Register tab", () => {
  test("1. IT's eleven category cards in order, no Uncategorised, stock on Laptop, axe", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, IT);
    await openRegister(page);
    const cards = page.locator("[data-category-card]");
    await expect(cards).toHaveCount(11);
    const names = await cards.evaluateAll((els) => els.map((el) => el.querySelector(".truncate")?.textContent?.trim()));
    expect(names).toEqual([
      "Laptop", "Workstation (PC)", "Monitor", "Headset", "Mouse", "Keyboard", "Webcam", "UPS", "Windows License",
      "Laptop Bag", "Other",
    ]);
    await expect(page.getByRole("button", { name: /^Uncategorised\b/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Phone\b/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Peripheral\b/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Laptop \d+ in stock$/ })).toBeVisible();
    await expectNoSeriousAxe(page);
  });

  test("2. a known model typed in lower case is offered; the Type stays empty and required", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, IT);
    await openRegister(page);
    await pickCategory(page, "Laptop");
    await modelBox(page).fill("thinkpad t14 gen 4");
    const option = page.getByRole("option", { name: KNOWN_LAPTOP, exact: true });
    await expect(option).toBeVisible();
    await option.click();
    await expect(modelBox(page)).toHaveValue(KNOWN_LAPTOP);
    // Phase 36: the model never sets the type.
    await expect(page.getByText(/— set by this model/)).toHaveCount(0);
    await expect(typeSelect(page)).toBeVisible();
    await expect(typeSelect(page)).toHaveValue("");
    await tagBox(page).fill(newTag());
    await serialBox(page).fill(`C2-${Date.now()}`);
    await page.getByRole("button", { name: "Register 1 laptop", exact: true }).click();
    await expect(page.getByText("Pick the type", { exact: true }).first()).toBeVisible();
    await expect(page).toHaveURL(/\/inventory\/register$/);
  });

  test("3. the one-unit serial is required, and a scanner's Enter never submits", async ({ page }) => {
    test.setTimeout(120_000);
    const t0 = new Date();
    await login(page, IT);
    await openRegister(page);
    await pickCategory(page, "Laptop");
    await pickModel(page, KNOWN_LAPTOP, KNOWN_LAPTOP);
    await pickAnyType(page);
    await tagBox(page).fill(newTag());
    // Review Focus 2: a scanner types the serial, then sends Enter. That Enter must not submit.
    const serial = `C3-${Date.now()}`;
    await serialBox(page).fill(serial);
    await serialBox(page).press("Enter");
    // Give a submit that should not happen time to land, then pin that it did not.
    await page.waitForTimeout(2_000);
    await expect(async () => {
      expect(page.url()).toMatch(/\/inventory\/register$/);
      expect(await db.asset.count({ where: { serial } })).toBe(0);
    }).toPass({ timeout: 5_000 });
    await expect(page).toHaveURL(/\/inventory\/register$/);
    expect(await db.asset.count({ where: { model: KNOWN_LAPTOP, createdAt: { gte: t0 } } })).toBe(0);

    // The empty one-unit serial is refused at Register.
    await serialBox(page).fill("");
    await page.getByRole("button", { name: "Register 1 laptop", exact: true }).click();
    await expect(page.getByText("Enter the serial number before you register.")).toBeVisible();
    await expect(page).toHaveURL(/\/inventory\/register$/);
    await expect(serialBox(page)).toHaveAttribute("aria-invalid", "true");
    expect(await db.asset.count({ where: { model: KNOWN_LAPTOP, createdAt: { gte: t0 } } })).toBe(0);

    // With the serial back, the button (not Enter) registers it.
    await serialBox(page).fill(serial);
    await page.getByRole("button", { name: "Register 1 laptop", exact: true }).click();
    const recordId = await landedRecord(page);
    const asset = await db.asset.findFirstOrThrow({ where: { serial } });
    expect(asset.purchaseRecordId).toBe(recordId);
  });

  test("4. a new model asks for its type, and is registered with it (and an untyped known model asks too)", async ({ page }) => {
    test.setTimeout(120_000);
    const stamp = `C4-${Date.now()}`;
    const mouse = await db.assetCategory.findFirstOrThrow({ where: { name: "Mouse" }, include: { types: true } });
    const wireless = mouse.types.find((t) => t.name === "Wireless")!;
    // Ruling R9: a known model whose newest asset carries no type.
    await db.asset.create({
      data: {
        tag: `BR-MS-${9000 + (Date.now() % 900)}`, model: "E2E Untyped Model", categoryId: mouse.id, typeId: null, cls: "IT",
        status: "SPARE", itVerifiedAt: new Date(), labelPrintedAt: new Date(),
      },
    });

    await login(page, IT);
    await openRegister(page);
    await pickCategory(page, "Mouse");

    await pickModel(page, "E2E Untyped Model", "E2E Untyped Model");
    await expect(typeSelect(page)).toBeVisible();
    await expect(typeSelect(page)).toHaveValue("");
    await expect(page.getByText(/— set by this model/)).toHaveCount(0);

    await modelBox(page).fill("Logitech M720 Triathlon");
    await page.getByRole("option", { name: /^\+ Add .Logitech M720 Triathlon. as a new model$/ }).click();
    await expect(typeSelect(page)).toBeVisible();
    await typeSelect(page).selectOption({ label: "Wireless" });
    await tagBox(page).fill(newTag());
    await serialBox(page).fill(`${stamp}-M720-1`);
    await expect(page.getByRole("radiogroup", { name: "Where does it go" }).getByRole("radio", { name: "Spare stock" })).toBeChecked();
    await page.getByRole("button", { name: "Register 1 mouse", exact: true }).click();

    const recordId = await landedRecord(page);
    const asset = await db.asset.findFirstOrThrow({ where: { serial: `${stamp}-M720-1` } });
    expect(asset.model).toBe("Logitech M720 Triathlon");
    expect(asset.categoryId).toBe(mouse.id);
    expect(asset.typeId).toBe(wireless.id);
    expect(asset.purchaseRecordId).toBe(recordId);
    expect(asset.labelPrintedAt).toBeNull();
  });

  test("5. a batch of 3 by paste-fill: a duplicate is flagged and refused, then fixed", async ({ page }) => {
    test.setTimeout(120_000);
    const s = `C5-${Date.now()}`;
    await login(page, IT);
    await openRegister(page);
    await pickCategory(page, "Monitor");
    await pickModel(page, "Dell P2422H", "Dell P2422H");
    await pickAnyType(page);
    await setQuantity(page, 3);
    for (let i = 1; i <= 3; i++) await page.getByRole("textbox", { name: `Tag ${i}`, exact: true }).fill(newTag());

    // A real paste event with Windows line endings and a trailing newline (Review Focus 3).
    await page.getByRole("textbox", { name: "Serial 1", exact: true }).evaluate((el, text) => {
      const data = new DataTransfer();
      data.setData("text/plain", text);
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    }, `${s}-CN1\r\n${s}-CN2\r\n${s}-CN2\r\n`);
    await expect(page.getByRole("textbox", { name: "Serial 1", exact: true })).toHaveValue(`${s}-CN1`);
    await expect(page.getByRole("textbox", { name: "Serial 2", exact: true })).toHaveValue(`${s}-CN2`);
    await expect(page.getByRole("textbox", { name: "Serial 3", exact: true })).toHaveValue(`${s}-CN2`);
    const row3 = page.getByRole("row").filter({ has: page.getByRole("textbox", { name: "Serial 3", exact: true }) });
    await expect(row3).toContainText("duplicate");

    const url = page.url();
    await page.getByRole("button", { name: "Register 3 monitors", exact: true }).click();
    await page.waitForTimeout(1_500);
    await expect(page).toHaveURL(url);
    expect(await db.asset.count({ where: { serial: { startsWith: s } } })).toBe(0);

    await page.getByRole("textbox", { name: "Serial 3", exact: true }).fill(`${s}-CN3`);
    await expect(row3).not.toContainText("duplicate");
    await page.getByRole("button", { name: "Register 3 monitors", exact: true }).click();
    const recordId = await landedRecord(page);

    const assets = await db.asset.findMany({ where: { serial: { startsWith: s } }, orderBy: { serial: "asc" } });
    expect(assets.map((a) => a.serial)).toEqual([`${s}-CN1`, `${s}-CN2`, `${s}-CN3`]);
    expect(new Set(assets.map((a) => a.purchaseRecordId))).toEqual(new Set([recordId]));
    const audits = await db.auditEntry.findMany({ where: { entityType: "purchase-record", entityId: recordId, action: "purchase.recorded" } });
    expect(audits).toHaveLength(1);
    expect((audits[0].diff as { quantity: { to: number } }).quantity.to).toBe(3);
  });

  test("6. Give to someone (IT direct) deploys the new laptop to the picked employee", async ({ page }) => {
    test.setTimeout(120_000);
    const serial = `C6-${Date.now()}`;
    const emp = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0042" } });
    await login(page, IT);
    await openRegister(page);
    await pickCategory(page, "Laptop");
    await pickModel(page, KNOWN_LAPTOP, KNOWN_LAPTOP);
    await pickAnyType(page);
    await tagBox(page).fill(newTag());
    await serialBox(page).fill(serial);
    await page.getByRole("radiogroup", { name: "Where does it go" }).getByText("Give to someone", { exact: true }).click();
    const who = page.getByRole("combobox", { name: "Who", exact: true });
    await who.click();
    await who.fill(emp.name.split(" ")[0]);
    await page.getByRole("option").filter({ hasText: emp.name }).first().click();
    await page.getByRole("button", { name: "Register 1 laptop", exact: true }).click();

    const recordId = await landedRecord(page);
    const asset = await db.asset.findFirstOrThrow({ where: { serial } });
    expect(asset.purchaseRecordId).toBe(recordId);
    expect(asset.status).toBe("DEPLOYED");
    expect(asset.assigneeId).toBe(emp.id);
  });

  test("7. a Purchasing-class In use files an assign approval, with no serial", async ({ page }) => {
    test.setTimeout(120_000);
    const t0 = new Date();
    const emp = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0042" } });
    const model = "Toyota Vios 1.3 E";
    try {
      await login(page, ADMIN);
      await openRegister(page, "PURCHASING");
      await pickCategory(page, "Vehicle");
      await modelBox(page).fill(model);
      await page.getByRole("option", { name: /^\+ Add .Toyota Vios 1\.3 E. as a new model$/ }).click();
      await typeSelect(page).selectOption({ label: "Sedan" });
      await tagBox(page).fill(newTag());
      await expect(page.getByRole("heading", { name: "Serial number (optional)" })).toBeVisible();
      await page.getByRole("radiogroup", { name: "Where does it go" }).getByText("In use", { exact: true }).click();
      await expect(page.getByText("This files a request for approval.")).toBeVisible();
      const who = page.getByRole("combobox", { name: "Who", exact: true });
      await who.click();
      await who.fill(emp.name.split(" ")[0]);
      await page.getByRole("option").filter({ hasText: emp.name }).first().click();
      await page.getByRole("button", { name: "Register 1 vehicle", exact: true }).click();

      const recordId = await landedRecord(page);
      expect(new URL(page.url()).searchParams.get("cls")).toBe("PURCHASING");
      const asset = await db.asset.findFirstOrThrow({ where: { purchaseRecordId: recordId } });
      expect(asset.model).toBe(model);
      expect(asset.serial).toBeNull();
      expect(asset.cls).toBe("PURCHASING");
      expect(asset.status).toBe("STORED");
      expect(asset.assigneeId).toBeNull();
      const open = await db.approval.findMany({
        where: { assetId: asset.id, type: "lifecycle_assign", state: { in: ["PENDING", "CLAIMED", "APPROVED"] } },
      });
      expect(open).toHaveLength(1);
    } finally {
      // P-18: close by state, never delete (audit rows reference approvals).
      await db.approval.updateMany({
        where: {
          type: "lifecycle_assign", createdAt: { gte: t0 }, asset: { model },
          state: { notIn: ["REJECTED", "EXECUTED"] },
        },
        data: { state: "REJECTED", resolvedAt: new Date(), resolutionReason: "e2e phase 34 cleanup" },
      });
    }
  });

  test("8. Purchase and warranty: refs, money and the live total, warranty, two documents on both units", async ({ page }) => {
    test.setTimeout(120_000);
    const s = `C8-${Date.now()}`;
    const vendor = await db.vendor.findFirstOrThrow({ where: { name: "TechServe PH" } });
    await login(page, IT);
    await openRegister(page);
    await pickCategory(page, "Laptop");
    await pickModel(page, KNOWN_LAPTOP, KNOWN_LAPTOP);
    await pickAnyType(page);
    await setQuantity(page, 2);
    await page.getByRole("textbox", { name: "Tag 1", exact: true }).fill(newTag());
    await page.getByRole("textbox", { name: "Tag 2", exact: true }).fill(newTag());
    await page.getByRole("textbox", { name: "Serial 1", exact: true }).fill(`${s}-1`);
    await page.getByRole("textbox", { name: "Serial 2", exact: true }).fill(`${s}-2`);

    const header = page.getByRole("button", { name: "Purchase and warranty" });
    await header.click();
    await expect(header).toHaveAttribute("aria-expanded", "true");

    const vendorBox = page.getByRole("combobox", { name: "Vendor", exact: true });
    await vendorBox.click();
    await vendorBox.fill("TechServe");
    await page.getByRole("option").filter({ hasText: "TechServe PH" }).first().click();
    await page.getByLabel("Purchase date", { exact: true }).fill("2026-10-12");
    await page.getByRole("textbox", { name: "Invoice no.", exact: true }).fill("SI-E2E-1");
    await page.getByRole("textbox", { name: "Official receipt (OR) no.", exact: true }).fill("OR-E2E-1");
    const unit = page.getByRole("textbox", { name: "Cost per unit (₱)", exact: true });
    await unit.fill("68,500");
    await unit.blur();
    const fees = page.getByRole("textbox", { name: "Delivery and fees (₱)", exact: true });
    await fees.fill("500");
    await fees.blur();
    await expect(page.getByTestId("purchase-total")).toHaveText("₱137,500.00");

    await page.getByRole("button", { name: "2 yr", exact: true }).click();
    await expect(page.getByRole("button", { name: "2 yr", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByLabel("Warranty until", { exact: true })).toHaveValue("2028-10-12");
    await page.getByRole("combobox", { name: "Covered by", exact: true }).selectOption({ label: "Manufacturer" });
    await page.getByRole("textbox", { name: "Who to call for repairs", exact: true }).fill("Lenovo PH");

    await page.getByLabel("Sales invoice", { exact: true }).setInputFiles({
      name: "invoice.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%e2e phase 34\n"),
    });
    await page.getByLabel("Warranty slip", { exact: true }).setInputFiles({
      name: "warranty.png", mimeType: "image/png",
      buffer: Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex"),
    });
    await expect(page.getByText("invoice.pdf")).toBeVisible();
    await expect(page.getByText("warranty.png")).toBeVisible();

    await page.getByRole("button", { name: "Register 2 laptops", exact: true }).click();
    const recordId = await landedRecord(page);
    expect(new URL(page.url()).searchParams.get("docsFailed")).toBeNull();

    const assets = await db.asset.findMany({
      where: { purchaseRecordId: recordId }, orderBy: { tag: "asc" }, include: { documents: true },
    });
    expect(assets.map((a) => a.serial)).toEqual([`${s}-1`, `${s}-2`]);
    for (const a of assets) {
      expect(Number(a.cost)).toBe(68500);
      expect(a.invoiceRef).toBe("SI-E2E-1");
      expect(a.receiptRef).toBe("OR-E2E-1");
      expect(a.vendorId).toBe(vendor.id);
      expect(a.purchasedAt?.toISOString().slice(0, 10)).toBe("2026-10-12");
      expect(a.warrantyUntil?.toISOString().slice(0, 10)).toBe("2028-10-12");
      expect(a.warrantyCoveredBy).toBe("manufacturer");
      expect(a.warrantyContact).toBe("Lenovo PH");
      expect(a.documents.map((d) => d.kind).sort()).toEqual(["invoice", "warranty-slip"]);
    }
    const record = await db.purchaseRecord.findUniqueOrThrow({ where: { id: recordId } });
    expect(Number(record.fees)).toBe(500);
    expect(record.quantity).toBe(2);
  });

  test("12. Register and add another keeps the category, model and type, clears the tag and serial, and toasts", async ({ page }) => {
    test.setTimeout(120_000);
    const serial = `C12-${Date.now()}`;
    const tag = newTag();
    await login(page, IT);
    await openRegister(page);
    await pickCategory(page, "Laptop");
    await pickModel(page, KNOWN_LAPTOP, KNOWN_LAPTOP);
    await typeSelect(page).selectOption({ label: "High-performance" });
    await tagBox(page).fill(tag);
    await serialBox(page).fill(serial);
    await page.getByRole("button", { name: "Register and add another", exact: true }).click();

    // "Success: " is toast.tsx's own sr-only tone label for "settled" (TONE_LABEL), as in it-gaps.spec.ts.
    await expect(page.getByText("Success: Registered 1 asset", { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/inventory\/register$/);
    await expect(categoryCard(page, "Laptop")).toHaveAttribute("aria-pressed", "true");
    await expect(modelBox(page)).toHaveValue(KNOWN_LAPTOP);
    await expect(typeSelect(page)).toHaveValue(/.+/);
    await expect(tagBox(page)).toHaveValue("");
    await expect(serialBox(page)).toHaveValue("");
    await expect(tagBox(page)).toBeFocused();
    const asset = await db.asset.findFirstOrThrow({ where: { serial }, include: { type: true } });
    expect(asset.model).toBe(KNOWN_LAPTOP);
    expect(asset.tag).toBe(tag);
    expect(asset.type?.name).toBe("High-performance");
  });

  test("13. the live label preview shows the typed model and the typed tag", async ({ page }) => {
    test.setTimeout(120_000);
    const model = `E2E Preview ${Date.now()}`;
    const tag = newTag();
    await login(page, IT);
    await openRegister(page);
    await pickCategory(page, "Laptop");
    await modelBox(page).fill(model);
    await modelBox(page).blur();
    await tagBox(page).fill(tag.toLowerCase());
    const figure = page.getByRole("figure", { name: "Your label, actual size" });
    await expect(figure).toBeVisible();
    await expect(figure).toContainText(model);
    await expect(figure).toContainText(tag);
    await expect(figure.getByLabel(`Barcode ${tag}`, { exact: true })).toHaveCount(1);
  });

  test("14. the Purchasing class shows its four cards in name order, and its serial is optional", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, ADMIN);
    await openRegister(page, "PURCHASING");
    const cards = page.locator("[data-category-card]");
    await expect(cards).toHaveCount(4);
    const names = await cards.evaluateAll((els) => els.map((el) => el.querySelector(".truncate")?.textContent?.trim()));
    expect(names).toEqual(["Building", "Furniture", "Pantry Equipment", "Vehicle"]);
    await expect(page.getByRole("heading", { name: "Serial number (optional)", exact: true })).toBeVisible();
  });
});

test.describe("register — the Labels tab", () => {
  test("9. Register lands on Labels with the batch ticked; clicking sticker 4 starts there", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, IT);
    const { assets } = await registerLaptops(page, 2, `C9-${Date.now()}`);

    await expect(page.getByRole("heading", { name: "New equipment", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Labels\b/ })).toHaveAttribute("aria-current", "page");
    const batch = page.getByRole("checkbox", { name: new RegExp(escapeRe(assets[0].tag)) });
    await expect(batch).toBeChecked();
    await expect(page.getByText("2 labels on 1 sheet, starting at sticker 1", { exact: true })).toBeVisible();

    await page.getByRole("link", { name: "Start at sticker 4", exact: true }).click();
    await expect(page).toHaveURL(/[?&]start=4\b/);
    await expect(page.locator(".label-page").first().locator("[data-blank-label]")).toHaveCount(3);
    await expect(page.getByText("2 labels on 1 sheet, starting at sticker 4", { exact: true })).toBeVisible();
    for (const a of assets) await expect(page.getByLabel(`Barcode ${a.tag}`, { exact: true })).toHaveCount(1);
    await expectNoSeriousAxe(page);
  });

  test("10. Print stamps the batch printed once; a reprint by tag never moves the stamp", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, IT);
    const { assets } = await registerLaptops(page, 2, `C10-${Date.now()}`);
    const ids = assets.map((a) => a.id);
    expect(await db.asset.count({ where: { id: { in: ids }, labelPrintedAt: null } })).toBe(2);

    const print = page.getByRole("button", { name: "Print 2 labels", exact: true });
    await waitForHydration(print);
    // Phase 40 §2.6 (replacing ruling R16): once window.print() returns, Print asks; only Yes marks the queue.
    await page.evaluate(() => { window.print = () => {}; });
    await print.click();
    await page.getByRole("dialog", { name: "Did the labels print correctly?" })
      .getByRole("button", { name: "Yes, mark printed", exact: true }).click();
    await expect(async () => {
      expect(await db.asset.count({ where: { id: { in: ids }, labelPrintedAt: { not: null } } })).toBe(2);
    }).toPass({ timeout: 20_000 });

    await page.goto("/inventory/labels");
    await expect(page.getByRole("heading", { name: "Waiting to print" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("checkbox", { name: new RegExp(escapeRe(assets[0].tag)) })).toHaveCount(0);

    const before = await db.asset.findUniqueOrThrow({ where: { id: ids[0] }, select: { labelPrintedAt: true } });
    await page.goto(`/inventory/labels?tags=${assets[0].tag}`);
    const reprint = page.getByRole("button", { name: "Print 1 label", exact: true });
    await waitForHydration(reprint);
    await page.evaluate(() => { window.print = () => {}; });
    await reprint.click();
    await page.waitForTimeout(2_000);
    const after = await db.asset.findUniqueOrThrow({ where: { id: ids[0] }, select: { labelPrintedAt: true } });
    expect(after.labelPrintedAt?.toISOString()).toBe(before.labelPrintedAt?.toISOString());
  });

  test("11. Reprint other tags: a typed tag goes on the sheet", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, IT);
    await page.goto("/inventory/labels");
    await expect(page.getByRole("heading", { name: "Reprint other tags" })).toBeVisible({ timeout: 20_000 });
    await waitForHydration(page.getByRole("button", { name: /^Print \d+ labels?$/ }));
    await page.getByLabel("Tags", { exact: true }).fill("BR-LT-0148");
    await page.getByRole("button", { name: "Make sheet", exact: true }).click();
    await expect(page).toHaveURL(/tags=BR-LT-0148/);
    await expect(page.getByLabel("Barcode BR-LT-0148", { exact: true })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Print 1 label", exact: true })).toBeVisible();
  });
});

test.describe("register — final-review fix wave", () => {
  test("15. Other suggests no tag: the Tag box starts empty", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, IT);
    await openRegister(page);
    await pickCategory(page, "Other");
    await modelBox(page).fill(`E2E Webcam ${Date.now()}`);
    await modelBox(page).blur();
    await expect(tagBox(page)).toHaveValue("");
    await expect(page.getByText(/^tag BR-/)).toHaveCount(0);
  });

  test("16. a category with no prefix and no types registers on a typed tag, with no type", async ({ page }) => {
    test.setTimeout(120_000);
    const name = `E2E Prefixless ${Date.now() % 100000}`;
    // A category added in Admin: no tagPrefix, no types, no assets.
    const cat = await db.assetCategory.create({ data: { name, cls: "IT" }, select: { id: true } });
    const tag = newTag();
    const serial = `C16-${Date.now()}`;
    try {
      await login(page, IT);
      await openRegister(page);
      await pickCategory(page, name);
      await modelBox(page).fill("E2E Gadget");
      await modelBox(page).blur();
      // Phase 36: with no types the Type is not asked and the asset gets none.
      await expect(typeSelect(page)).toHaveCount(0);
      await tagBox(page).fill(tag);
      await serialBox(page).fill(serial);
      await expect(page.getByText(/^Still needed:/)).toHaveCount(0);
      await page.getByRole("button", { name: /^Register 1 /, exact: false }).first().click();
      await landedRecord(page);
      const asset = await db.asset.findUniqueOrThrow({ where: { tag } });
      expect(asset.categoryId).toBe(cat.id);
      expect(asset.typeId).toBeNull();
    } finally {
      await db.assetCategory.deleteMany({ where: { id: cat.id, assets: { none: {} } } });
    }
  });

  test("17. printing a list selection (?ids=) stamps its waiting assets too (ruling R26)", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, IT);
    // registerLaptops drives the batch rows, so two units; the selection names only the first.
    const { assets } = await registerLaptops(page, 2, `C17-${Date.now()}`);
    const id = assets[0].id;
    expect((await db.asset.findUniqueOrThrow({ where: { id }, select: { labelPrintedAt: true } })).labelPrintedAt).toBeNull();

    // A list selection, not the queue: nothing is picked, the asset arrives through ?ids=.
    await page.goto(`/inventory/labels?ids=${id}`);
    const print = page.getByRole("button", { name: "Print 1 label", exact: true });
    await waitForHydration(print);
    await page.evaluate(() => { window.print = () => {}; });
    await print.click();
    // Phase 40 §2.6: the stamp waits for Yes.
    await page.getByRole("dialog", { name: "Did the labels print correctly?" })
      .getByRole("button", { name: "Yes, mark printed", exact: true }).click();
    await expect(async () => {
      expect((await db.asset.findUniqueOrThrow({ where: { id }, select: { labelPrintedAt: true } })).labelPrintedAt).not.toBeNull();
    }).toPass({ timeout: 20_000 });
  });
});
