import { test, expect, type Locator, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import { readSheet } from "read-excel-file/node";
import { SEED_PASSWORD } from "../prisma/fixtures";

/**
 * Phase 18, Task 9 — purchasing extensions (spec §8.2, 8 cases). Covers the
 * surface Task 6 added to a purchase request (a required requesting
 * department with its own list filter, a settable supplier, attachments) and
 * Task 7's asset provenance (the derived badge/facet/export column, and the
 * register page's vendor-from-request prefill) — everything Tasks 1-8 shipped
 * that Task 8's own suppliers.spec.ts does not already cover.
 *
 * Cases run serial and share state the same way suppliers.spec.ts and
 * registration.spec.ts do: case 1 creates one new draft (its id/refNo are
 * read once and reused by case 2), and cases 3-4 both act on the seed's
 * PR-0198, each leaving it in the state the next one expects. Every id is
 * looked up fresh via Prisma, never hardcoded, since the seed produces new
 * cuids on every reseed.
 *
 * Seeded fixtures this file depends on (prisma/seed.ts), all
 * @thebackroomop.com / SEED_PASSWORD:
 *   admin, it, purchasing (A. Reyes), finance (L. Domingo), viewer.
 *   Departments: IT, Finance, Sales, HR, Operations.
 *   PR-0201 DRAFT/IT, PR-0198 SUBMITTED/HR, PR-0195 IT_REVIEWED/Sales,
 *   PR-0188 COMPLETED/IT with supplier TechServe PH, PR-0183 CANCELLED with
 *   NO department.
 *   Suppliers: TechServe PH, Octagon Repairs, Metro Office Supply, Quezon
 *   Furniture Works (all active), Old Line Trading (already archived).
 *   e2e/fixtures/assets-clean.xlsx (shared with import-export.spec.ts) yields
 *   3 new IT-class assets: BR-LT-9001, BR-MN-9002, BR-HS-9003.
 */

const db = new PrismaClient();

test.beforeAll(() => {
  execSync("npm run db:seed", { timeout: 120_000 });
});
test.afterAll(async () => {
  await db.$disconnect();
});

// Copied from e2e/suppliers.spec.ts:44-50 — house rule: never import helpers
// across spec files, since each file reseeds independently.
async function login(page: Page, email: string) {
  await page.goto("/logout");
  await page.getByLabel(/Email/).fill(email);
  await page.getByLabel(/Password/).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

// Copied from e2e/suppliers.spec.ts:56-61 — the mouse-move-then-settle step
// guards against a phantom SERIOUS contrast violation measured on a
// freshly-mounted Button variant="primary" (this file's pages render several:
// "Save supplier", "Archive", "Upload"...).
async function expectNoSeriousAxe(page: Page) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(700);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
}

// Copied from e2e/suppliers.spec.ts:74-82 (itself copied from
// e2e/it-core.spec.ts) — house rule: never import across spec files. Guards
// the hydration race: filling a field right after `page.goto` can set the DOM
// value before React attaches, which then rebinds the input from the
// server-rendered initial value a beat later and silently drops what was
// typed/selected. Probed on the element about to be interacted with.
async function waitForHydration(target: Locator) {
  const el = target.first();
  await el.waitFor({ state: "attached", timeout: 20_000 });
  await expect(async () => {
    expect(await el.evaluate((node) => Object.keys(node).some((k) => k.startsWith("__reactFiber$")))).toBe(
      true,
    );
  }).toPass({ timeout: 20_000 });
}

const ADMIN = "admin@thebackroomop.com";
const PURCHASING = "purchasing@thebackroomop.com";
const FINANCE = "finance@thebackroomop.com";
const VIEWER = "viewer@thebackroomop.com";

const reqByRef = (refNo: string) => db.purchaseRequest.findUniqueOrThrow({ where: { refNo } });
const vendorByName = (name: string) => db.vendor.findUniqueOrThrow({ where: { name } });
const deptByName = (name: string) => db.department.findUniqueOrThrow({ where: { name } });

// Set by case 1, read by case 2 — module scope because each is its own test.
let newReqId: string;
let newReqRef: string;

test.describe.serial("purchasing extensions", () => {
  test("1. a draft cannot autosave without a department; choosing one saves it, and the badge/list reflect it", async ({ page }) => {
    test.setTimeout(90_000); // first hit of /purchases/new and /purchases/[id] in this file
    const before = await db.purchaseRequest.count();
    await login(page, PURCHASING);
    await page.goto("/purchases/new");

    const line1 = page.getByLabel("Line 1 description");
    await waitForHydration(line1);
    await expect(
      page.getByText("Pick the department first — the draft saves once it is chosen."),
    ).toBeVisible();

    await line1.fill("Ergonomic task chairs");
    // Well past the 2.5s autosave debounce — draft-form.tsx's guard refuses
    // to call createDraft at all while departmentId === "".
    await page.waitForTimeout(4_000);
    expect(await db.purchaseRequest.count()).toBe(before);

    await page.getByLabel("Requesting department").selectOption({ label: "HR" });
    await expect(page.getByText(/DRAFT · SAVED \d{2}:\d{2}/)).toBeVisible({ timeout: 10_000 });

    // Scoped by visible text (PR-####), same reasoning as
    // e2e/purchases.spec.ts:156 — the sidebar's "Register purchase" link also
    // targets /purchases/new but its name never matches this pattern.
    const refLink = page.getByRole("link", { name: /^PR-\d{4}$/ });
    newReqRef = (await refLink.textContent())!.trim();
    const href = await refLink.getAttribute("href");
    newReqId = href!.replace("/purchases/", "");
    expect(newReqId).toBeTruthy();

    await page.goto(`/purchases/${newReqId}`);
    await expect(page.getByRole("heading", { name: newReqRef })).toBeVisible({ timeout: 10_000 });
    // exact: the meta line below the badge also reads "· for HR" (lowercase
    // "for") and a case-insensitive substring match would resolve both.
    await expect(page.getByText("FOR HR", { exact: true })).toBeVisible();

    await page.goto("/purchases");
    await expect(page.getByRole("row", { name: new RegExp(newReqRef) })).toContainText("HR");
  });

  test("2. the department filter narrows the list; ?department=none isolates the untagged seed row", async ({ page }) => {
    await login(page, PURCHASING);
    const hr = await deptByName("HR");

    await page.goto(`/purchases?department=${hr.id}`);
    await expect(page.getByRole("row", { name: new RegExp(newReqRef) })).toBeVisible();
    await expect(page.getByRole("row", { name: /PR-0195/ })).toHaveCount(0);

    await page.goto("/purchases?department=none");
    await expect(page.getByRole("row", { name: /PR-0183/ })).toBeVisible();
    await expect(page.getByRole("row", { name: /PR-0198/ })).toHaveCount(0);
  });

  test("3. Purchasing sets PR-0198's supplier; the request, the list row, the audit log and the supplier profile all agree", async ({ page }) => {
    test.setTimeout(60_000); // first hit of /purchases/suppliers/[id] in this file
    await login(page, PURCHASING);
    const pr0198 = await reqByRef("PR-0198");

    await page.goto(`/purchases/${pr0198.id}`);
    const supplierSelect = page.getByLabel("Supplier");
    await waitForHydration(supplierSelect);
    await supplierSelect.selectOption({ label: "Quezon Furniture Works" });
    await page.getByRole("button", { name: "Save supplier" }).click();
    await expect(page.getByRole("link", { name: "Quezon Furniture Works" })).toBeVisible({ timeout: 10_000 });

    await page.goto("/purchases");
    await expect(page.getByRole("row", { name: /PR-0198/ })).toContainText("Quezon Furniture Works");

    expect(await db.auditEntry.findFirst({ where: { action: "supplier-set" } })).not.toBeNull();

    const quezon = await vendorByName("Quezon Furniture Works");
    await page.goto(`/purchases/suppliers/${quezon.id}`);
    await expect(page.getByRole("row", { name: /PR-0198/ })).toBeVisible({ timeout: 10_000 });
  });

  test("4. an archived supplier is never offered, but a request that already names one keeps showing it", async ({ page }) => {
    await login(page, PURCHASING);
    const pr0198 = await reqByRef("PR-0198");

    await page.goto(`/purchases/${pr0198.id}`);
    // Old Line Trading is archived in the seed itself and is not the
    // currently-set supplier here — it must not appear at all.
    await expect(
      page.getByLabel("Supplier").locator("option", { hasText: "Old Line Trading" }),
    ).toHaveCount(0);

    // Re-affirm Quezon (case 3 already set it) so this case does not depend
    // on case 3 having run first.
    const supplierSelect = page.getByLabel("Supplier");
    await waitForHydration(supplierSelect);
    await supplierSelect.selectOption({ label: "Quezon Furniture Works" });
    await page.getByRole("button", { name: "Save supplier" }).click();
    await expect(page.getByRole("link", { name: "Quezon Furniture Works" })).toBeVisible({ timeout: 10_000 });

    const quezon = await vendorByName("Quezon Furniture Works");
    await page.goto(`/purchases/suppliers/${quezon.id}`);
    const archiveBtn = page.getByRole("button", { name: "Archive supplier" });
    await waitForHydration(archiveBtn);
    await archiveBtn.click();
    await page.getByRole("dialog").getByRole("button", { name: "Archive" }).click();
    // exact: the "Success: Supplier archived" toast also contains "archived"
    // and getByText's default match is case-insensitive-substring.
    await expect(page.getByText("ARCHIVED", { exact: true })).toBeVisible({ timeout: 10_000 });

    await page.goto(`/purchases/${pr0198.id}`);
    const reopenedSelect = page.getByLabel("Supplier");
    await expect(reopenedSelect).toBeVisible({ timeout: 10_000 });
    const selectedText = await reopenedSelect.evaluate(
      (el: HTMLSelectElement) => el.options[el.selectedIndex]?.text,
    );
    expect(selectedText).toBe("Quezon Furniture Works (archived)");

    await page.goto(`/purchases/suppliers/${quezon.id}`);
    const restoreBtn = page.getByRole("button", { name: "Restore supplier" });
    await waitForHydration(restoreBtn);
    await restoreBtn.click();
    await expect(page.getByText("ARCHIVED", { exact: true })).toHaveCount(0, { timeout: 10_000 });
  });

  test("5. attachments show by role, survive on a cancelled request, and download with real headers", async ({ page }) => {
    await login(page, PURCHASING);
    const pr0198 = await reqByRef("PR-0198");
    await page.goto(`/purchases/${pr0198.id}`);

    const kindSelect = page.getByLabel("Document kind");
    await waitForHydration(kindSelect);
    await kindSelect.selectOption("quotation");
    await page.getByLabel("Document file").setInputFiles({
      name: "quotation.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%quotation"),
    });
    await expect(page.getByRole("row", { name: /Quotation/ })).toBeVisible({ timeout: 10_000 });

    await login(page, FINANCE);
    await page.goto(`/purchases/${pr0198.id}`);
    await page.getByLabel("Document kind").selectOption("invoice");
    await page.getByLabel("Document file").setInputFiles({
      name: "invoice.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%invoice"),
    });
    await expect(page.getByRole("row", { name: /Invoice/ })).toBeVisible({ timeout: 10_000 });

    await login(page, VIEWER);
    await page.goto(`/purchases/${pr0198.id}`);
    await expect(page.getByRole("row", { name: /Quotation/ })).toBeVisible();
    await expect(page.getByRole("row", { name: /Invoice/ })).toBeVisible();
    await expect(page.getByLabel("Document file")).toHaveCount(0);
    const downloadLinks = page.getByRole("link", { name: "Download" });
    await expect(downloadLinks.first()).toBeVisible();
    const href = await downloadLinks.first().getAttribute("href");
    const res = await page.request.get(href!);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("application/pdf");
    expect(res.headers()["content-disposition"]).toMatch(/\.pdf/);

    // Spec §5.3: a cancelled request keeps its files — attaching still works.
    await login(page, PURCHASING);
    const pr0183 = await reqByRef("PR-0183");
    await page.goto(`/purchases/${pr0183.id}`);
    await page.getByLabel("Document kind").selectOption("other");
    await page.getByLabel("Document file").setInputFiles({
      name: "other.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%other"),
    });
    await expect(page.getByRole("row", { name: /Other/ })).toBeVisible({ timeout: 10_000 });
  });

  test("6. import gives an asset Historical provenance; register gives Direct or From-a-request; the export names the column", async ({ page }) => {
    test.setTimeout(180_000); // cold JIT on /inventory/import and /inventory/register, plus the wizard's own Apply budget
    await login(page, ADMIN);

    // Wizard steps copied from e2e/import-export.spec.ts's "a clean file
    // reports 3 creates" / "applying it creates 3 assets" cases.
    await page.goto("/inventory/import");
    const spreadsheet = page.getByLabel(/Spreadsheet/);
    await waitForHydration(spreadsheet);
    await spreadsheet.setInputFiles("e2e/fixtures/assets-clean.xlsx");
    await page.getByRole("button", { name: /^Validate/ }).click();
    await expect(page.getByText("3 new · 0 updates · 0 blocked")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Import 3 rows" }).click();
    await expect(page.getByText("3 new · 0 updated · 0 already matched · 0 blocked · 0 failed")).toBeVisible({
      timeout: 30_000,
    });

    // The scanner contract redirects an exact tag match straight to the record.
    await page.goto("/inventory?q=BR-LT-9001");
    await expect(page).toHaveURL(/\/inventory\/[a-z0-9]+$/i, { timeout: 20_000 });
    await expect(page.getByText("Historical import")).toBeVisible();

    await page.goto("/inventory?provenance=HISTORICAL");
    await expect(page.getByText("BR-LT-9001")).toBeVisible({ timeout: 10_000 });

    // Register one laptop with no request — Direct provenance.
    await page.goto("/inventory/register");
    const category1 = page.getByLabel("Category");
    await waitForHydration(category1);
    await category1.selectOption({ label: "Laptop" });
    await page.getByLabel("Model").fill("e2e provenance -- direct");
    await expect(page.getByLabel("Tag 1")).not.toHaveValue("");
    const directTag = await page.getByLabel("Tag 1").inputValue();
    await page.getByRole("button", { name: "Register asset" }).click();
    await expect(page.getByText(/1 asset registered/)).toBeVisible({ timeout: 30_000 });

    await page.goto(`/inventory?q=${directTag}`);
    await expect(page).toHaveURL(/\/inventory\/[a-z0-9]+$/i, { timeout: 20_000 });
    await expect(page.getByText("Registered directly")).toBeVisible();

    // Register one laptop against PR-0188 (COMPLETED) — From-a-request provenance.
    await page.goto("/inventory/register");
    await page.getByLabel("Category").selectOption({ label: "Laptop" });
    await page.getByLabel("Model").fill("e2e provenance -- from PR-0188");
    await page.getByLabel("Purchase request").selectOption({ label: "PR-0188" });
    await expect(page.getByLabel("Tag 1")).not.toHaveValue("");
    const fromPrTag = await page.getByLabel("Tag 1").inputValue();
    await page.getByRole("button", { name: "Register asset" }).click();
    await expect(page.getByText(/1 asset registered/)).toBeVisible({ timeout: 30_000 });

    await page.goto(`/inventory?q=${fromPrTag}`);
    await expect(page).toHaveURL(/\/inventory\/[a-z0-9]+$/i, { timeout: 20_000 });
    await expect(page.getByRole("link", { name: "From PR-0188" })).toBeVisible();

    // The export sheet's header carries the derived column.
    const res = await page.request.get("/inventory/export");
    expect(res.status()).toBe(200);
    const grid = (await readSheet(Buffer.from(await res.body()))) as unknown[][];
    expect(grid[0]).toContain("Provenance");
  });

  test("7. the register page prefills the vendor from a chosen request, but never overwrites one already picked", async ({ page }) => {
    test.setTimeout(60_000);
    await login(page, PURCHASING);
    const techServe = await vendorByName("TechServe PH");
    const octagon = await vendorByName("Octagon Repairs");

    await page.goto("/inventory/register");
    const requestSelect = page.getByLabel("Purchase request");
    await waitForHydration(requestSelect);
    await requestSelect.selectOption({ label: "PR-0188" });
    await expect(page.getByLabel("Vendor")).toHaveValue(techServe.id);

    await page.goto("/inventory/register");
    const vendorSelect = page.getByLabel("Vendor");
    await waitForHydration(vendorSelect);
    await vendorSelect.selectOption({ label: "Octagon Repairs" });
    await page.getByLabel("Purchase request").selectOption({ label: "PR-0188" });
    await expect(page.getByLabel("Vendor")).toHaveValue(octagon.id);
  });

  test("8. no serious or critical axe violations on PR-0198's detail (Supplier + Attachments) or the historical-provenance inventory view", async ({ page }) => {
    test.setTimeout(60_000); // two full-page axe scans, each with its own settle wait
    await login(page, PURCHASING);
    const pr0198 = await reqByRef("PR-0198");
    await page.goto(`/purchases/${pr0198.id}`);
    // exact: the sidebar's own "Suppliers" nav section heading also renders
    // at this breakpoint and a substring match would resolve both.
    await expect(page.getByRole("heading", { name: "Supplier", exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("heading", { name: "Attachments" })).toBeVisible();
    await expectNoSeriousAxe(page);

    await page.goto("/inventory?provenance=HISTORICAL");
    await expectNoSeriousAxe(page);
  });
});
