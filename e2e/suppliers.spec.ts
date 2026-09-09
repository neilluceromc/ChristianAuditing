import { test, expect, type Locator, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import { SEED_PASSWORD } from "../prisma/fixtures";

/**
 * Phase 18, Task 8 — Purchasing: suppliers (spec §8.2, 11 cases). Covers the
 * whole surface Tasks 1-7 shipped: create/search, the contract-date
 * validation rule and a category edit, an audited bank-account reveal, role
 * masking (IT sees a masked number and no Reveal; Viewer sees no management
 * controls at all), a document upload with its own download route, archive
 * (pickers and the default list both drop it; a request's Supplier `Select`
 * loses the option; Restore brings it back), spreadsheet import for both the
 * ordinary mixed-verdict case and the bank-column file-level refusal, the
 * command palette's own Suppliers group, the duplicate-name refusal, and an
 * axe sweep of the four new/changed routes.
 *
 * Cases run serial and share one supplier, "Bayside Networks", created in
 * case 1 and carried through every later case (its bank account from case 3
 * is removed at the end of that same case, so case 4 adds a fresh one before
 * checking how it's masked) — the same one-fixture-through-the-file shape
 * custody.spec.ts uses. Every id is looked up fresh via Prisma, never
 * hardcoded, since the seed produces new cuids on every reseed.
 *
 * Seeded suppliers (prisma/seed.ts): TechServe PH (ACTIVE, contact "Rina
 * Valdez", phone "+63 2 8123 4567"), Octagon Repairs, Metro Office Supply
 * (EXPIRED), Quezon Furniture Works (ACTIVE), Old Line Trading (archived).
 * Seeded accounts, all @thebackroomop.com / SEED_PASSWORD: admin, it,
 * purchasing, finance, viewer.
 */

const db = new PrismaClient();

test.beforeAll(() => {
  execSync("npm run db:seed", { timeout: 120_000 });
});
test.afterAll(async () => {
  await db.$disconnect();
});

// Copied from e2e/custody.spec.ts:38-44 — house rule: never import helpers
// across spec files, since each file reseeds independently.
async function login(page: Page, email: string) {
  await page.goto("/logout");
  await page.getByLabel(/Email/).fill(email);
  await page.getByLabel(/Password/).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

// Copied from e2e/custody.spec.ts:61-66 — the mouse-move-then-settle step
// guards against the same phantom SERIOUS contrast violation measured there
// on a freshly-mounted Button variant="primary" (this file's pages render
// several: "Create supplier", "Save changes", "Archive", "Validate"...).
async function expectNoSeriousAxe(page: Page) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(700);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
}

// Copied from e2e/it-core.spec.ts:28-63 — house rule: never import across
// spec files. Measured on this file's own edit form (case 2): filling
// "Contract end" right after `page.goto` set the DOM value, but React's
// hydration hadn't attached yet, so it rebound the input from the
// server-rendered `initial` a beat later and the typed value was gone —
// the save then re-submitted the ORIGINAL date, tripped no validation rule,
// and the next assertion just hung waiting for an error that could never
// appear. Probed on the element about to be interacted with (never a page-
// level "loaded" proxy, and never a bare `waitForTimeout`), since hydration
// walks parent-to-child and a hydrated `<form>` does not yet imply a
// hydrated `<input>` inside it.
async function waitForHydration(target: Locator) {
  const el = target.first();
  await el.waitFor({ state: "attached", timeout: 20_000 });
  await expect(async () => {
    expect(await el.evaluate((node) => Object.keys(node).some((k) => k.startsWith("__reactFiber$")))).toBe(
      true,
    );
  }).toPass({ timeout: 20_000 });
}

const PURCHASING = "purchasing@thebackroomop.com";
const IT = "it@thebackroomop.com";
const VIEWER = "viewer@thebackroomop.com";

const byside = () => db.vendor.findUniqueOrThrow({ where: { name: "Bayside Networks" } });

test.describe.serial("suppliers", () => {
  test("1. Purchasing creates a supplier and finds it by name and by contact", async ({ page }) => {
    // First hit of the suite for both /purchases/suppliers/new and
    // /purchases/suppliers: next dev JIT-compiles each route bundle on its
    // first request, which can outrun the default 30s test timeout on a
    // cold cache (the same lesson it-core.spec.ts records for /employees/[id]).
    test.setTimeout(60_000);
    await login(page, PURCHASING);
    await page.goto("/purchases/suppliers/new");
    // FormField's `required` prop appends a hidden `<span aria-hidden> *</span>`
    // to the label's own text node, so the label's raw text is literally
    // "Name *" — `{ exact: true }` against "Name" therefore matches nothing
    // (measured directly against a Playwright repro), and a plain substring
    // "Name" is ambiguous with "Registered name". Anchored to the start
    // instead: unique, and unaffected by the hidden asterisk.
    const nameField = page.getByLabel(/^Name\b/);
    await waitForHydration(nameField);
    await nameField.fill("Bayside Networks");
    await page.getByLabel("Registered name").fill("Bayside Networks Corp.");
    await page.getByLabel("Category").fill("IT hardware");
    await page.getByLabel("Contact person").fill("Paolo Santos");
    await page.getByLabel("Email").fill("paolo@bayside.ph");
    await page.getByLabel("Contract status").selectOption("ACTIVE");
    await page.getByLabel("Contract start").fill("2026-01-01");
    await page.getByLabel("Contract end").fill("2026-12-31");
    await page.getByRole("button", { name: "Create supplier" }).click();
    await expect(page.getByRole("heading", { name: "Bayside Networks", level: 1 })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Paolo Santos")).toBeVisible();
    await page.goto("/purchases/suppliers?q=paolo");
    await expect(page.getByRole("link", { name: "Bayside Networks" })).toBeVisible();
    // Spec §8.2 case 1: "list finds it by name and by contact" — the q=paolo
    // search above proves the contact half; this proves the name half.
    await page.goto("/purchases/suppliers?q=bayside");
    await expect(page.getByRole("link", { name: "Bayside Networks" })).toBeVisible();
    await page.goto("/purchases/suppliers?category=IT%20hardware");
    await expect(page.getByRole("link", { name: "Bayside Networks" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Quezon Furniture Works" })).toHaveCount(0);

    // Review round 1, Important #1: the URL filter above proves the list
    // narrows, but not that the facet's own count reflects the new row. Read
    // the Category facet directly — FacetDropdown (facet-dropdown.tsx:100-113)
    // renders each option as a <label> holding the option text and a
    // font-mono count span side by side. "IT hardware" is shared by the
    // seed's TechServe PH (prisma/seed.ts:83) and this new Bayside row, so
    // the option's count must read 2.
    await page.goto("/purchases/suppliers");
    const categoryFacetBtn = page.getByRole("button", { name: "Category", exact: true });
    await waitForHydration(categoryFacetBtn);
    await categoryFacetBtn.click();
    const categoryDialog = page.getByRole("dialog", { name: "Filter by Category" });
    const itHardwareOption = categoryDialog.locator("label", { hasText: "IT hardware" });
    await expect(itHardwareOption).toBeVisible({ timeout: 10_000 });
    await expect(itHardwareOption.getByText("2", { exact: true })).toBeVisible();
  });

  test("2. Purchasing trips the contract-date rule, then fixes it and changes the category", async ({ page }) => {
    test.setTimeout(60_000); // first hit of /purchases/suppliers/[id]/edit
    await login(page, PURCHASING);
    const vendor = await byside();
    await page.goto(`/purchases/suppliers/${vendor.id}/edit`);
    const contractEnd = page.getByLabel("Contract end");
    await waitForHydration(contractEnd);

    // Start stays 2026-01-01 (from case 1); an end before it is refused.
    await contractEnd.fill("2025-01-01");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("End date is before the start")).toBeVisible({ timeout: 10_000 });

    // Fix the date and change the category in the same save.
    await contractEnd.fill("2026-12-31");
    await page.getByLabel("Category", { exact: true }).fill("Networking");
    const saveBtn = page.getByRole("button", { name: "Save changes" });
    await saveBtn.click();
    // The validation error is this save's own first thing to disappear —
    // waited on directly rather than the "Saved" toast, since a save that
    // still fails would leave it on screen. NOTE: `useSupplierRunner.run`
    // (use-supplier-runner.ts:34-35) clears `fieldErrors` synchronously at
    // click time, before the server action is even called, so this check
    // alone proves nothing about the mutation actually persisting — only
    // that the click was handled. The button's own `disabled`/`aria-busy`
    // state (button.tsx:35-36) is driven by `useTransition`'s `pending` and
    // can only go false again once the transition's async callback (the
    // whole server round trip) has resolved, so waiting for it re-enabled
    // is the real synchronization point that lets the next line navigate
    // without racing the write — real STATE, not the redundant toast text.
    await expect(page.getByText("End date is before the start")).toHaveCount(0, { timeout: 10_000 });
    await expect(saveBtn).toBeEnabled({ timeout: 10_000 });

    await page.goto(`/purchases/suppliers/${vendor.id}`);
    await expect(page.getByText("Networking")).toBeVisible({ timeout: 10_000 });
  });

  test("3. Purchasing adds a bank account, reveals it (audited), then removes it", async ({ page }) => {
    await login(page, PURCHASING);
    const vendor = await byside();
    await page.goto(`/purchases/suppliers/${vendor.id}`);
    const addAccountBtn = page.getByRole("button", { name: "Add account" });
    await waitForHydration(addAccountBtn);

    await addAccountBtn.click();
    const addDialog = page.getByRole("dialog");
    await addDialog.getByLabel("Label").fill("BDO main");
    await addDialog.getByLabel("Bank name").fill("BDO");
    await addDialog.getByLabel("Account name").fill("Bayside Networks Corp.");
    await addDialog.getByLabel("Account number").fill("001234567890");
    await addDialog.getByRole("button", { name: "Add" }).click();

    const row = page.getByRole("row", { name: /BDO main/ });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row.getByText("•••• 7890")).toBeVisible();

    await row.getByRole("button", { name: "Reveal" }).click();
    await expect(page.getByText("001234567890")).toBeVisible({ timeout: 10_000 });

    const revealEntry = await db.auditEntry.findFirst({
      where: { action: "supplier.bank.revealed", entityId: vendor.id },
    });
    expect(revealEntry).not.toBeNull();

    // R5: "Remove" is on both the row and the confirm dialog's own button —
    // scope each click to its own container.
    await row.getByRole("button", { name: "Remove" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Remove" }).click();
    await expect(page.getByRole("row", { name: /BDO main/ })).toHaveCount(0, { timeout: 10_000 });
  });

  test("4. IT sees a masked number with no Reveal; Viewer sees no management controls", async ({ page }) => {
    const vendor = await byside();

    // Case 3 removed its own account — add a fresh one as Purchasing first
    // so there is a row for the masked view to show.
    await login(page, PURCHASING);
    await page.goto(`/purchases/suppliers/${vendor.id}`);
    const addAccountBtn = page.getByRole("button", { name: "Add account" });
    await waitForHydration(addAccountBtn);
    await addAccountBtn.click();
    const addDialog = page.getByRole("dialog");
    await addDialog.getByLabel("Label").fill("Metrobank ops");
    await addDialog.getByLabel("Bank name").fill("Metrobank");
    await addDialog.getByLabel("Account name").fill("Bayside Networks Corp.");
    await addDialog.getByLabel("Account number").fill("009988776655");
    await addDialog.getByRole("button", { name: "Add" }).click();
    await expect(page.getByRole("row", { name: /Metrobank ops/ })).toBeVisible({ timeout: 10_000 });

    await login(page, IT);
    await page.goto(`/purchases/suppliers/${vendor.id}`);
    await expect(page.getByText("•••• 6655")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: "Reveal" })).toHaveCount(0);

    await login(page, VIEWER);
    await page.goto(`/purchases/suppliers/${vendor.id}`);
    await expect(page.getByRole("heading", { name: "Bayside Networks", level: 1 })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: "Edit supplier" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Edit supplier" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add account" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Upload" })).toHaveCount(0);
  });

  test("5. Purchasing uploads a registration PDF and downloads it back with the right headers", async ({ page }) => {
    await login(page, PURCHASING);
    const vendor = await byside();
    await page.goto(`/purchases/suppliers/${vendor.id}`);
    const docKind = page.getByLabel("Document kind");
    await waitForHydration(docKind);

    await docKind.selectOption("registration");
    await page.getByLabel("Document file").setInputFiles({
      name: "sec-registration.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n%fixture"),
    });

    const row = page.getByRole("row", { name: /Registration record/ });
    await expect(row).toBeVisible({ timeout: 10_000 });

    const href = await row.getByRole("link", { name: "Download" }).getAttribute("href");
    expect(href).toBeTruthy();
    const res = await page.request.get(href!);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("application/pdf");
    expect(res.headers()["content-disposition"]).toContain("sec-registration.pdf");
  });

  test("6. Archive drops Bayside from pickers and the default list; Restore brings it back", async ({ page }) => {
    test.setTimeout(60_000); // first hit of /purchases and /purchases/[id] in this suite
    await login(page, PURCHASING);
    const vendor = await byside();
    await page.goto(`/purchases/suppliers/${vendor.id}`);
    const archiveBtn = page.getByRole("button", { name: "Archive supplier" });
    await waitForHydration(archiveBtn);

    await archiveBtn.click();
    await page.getByRole("dialog").getByRole("button", { name: "Archive" }).click();
    await expect(page.getByText("ARCHIVED")).toBeVisible({ timeout: 10_000 });

    await page.goto("/purchases/suppliers");
    await expect(page.getByRole("link", { name: "Bayside Networks" })).toHaveCount(0);
    await page.goto("/purchases/suppliers?archived=1");
    await expect(page.getByRole("link", { name: "Bayside Networks" })).toBeVisible({ timeout: 10_000 });

    // PR-0198 (seeded SUBMITTED request) — its Supplier picker no longer
    // offers the archived supplier as an option.
    await page.goto("/purchases");
    await page.getByRole("link", { name: "PR-0198" }).click();
    await expect(page.getByRole("heading", { name: "PR-0198" })).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByLabel("Supplier").locator("option", { hasText: "Bayside Networks" }),
    ).toHaveCount(0);

    await page.goto(`/purchases/suppliers/${vendor.id}`);
    const restoreBtn = page.getByRole("button", { name: "Restore supplier" });
    await waitForHydration(restoreBtn);
    await restoreBtn.click();
    await expect(page.getByText("ARCHIVED")).toHaveCount(0, { timeout: 10_000 });

    await page.goto("/purchases/suppliers");
    await expect(page.getByRole("link", { name: "Bayside Networks" })).toBeVisible({ timeout: 10_000 });
  });

  test("7. Purchasing imports a mixed sheet: one create, one update, three blocked", async ({ page }) => {
    // First hit of /purchases/suppliers/import (a cold JIT compile) plus the
    // wizard's own ~15s budget for Apply re-checking the whole file.
    test.setTimeout(90_000);
    await login(page, PURCHASING);
    await page.goto("/purchases/suppliers/import");
    const spreadsheet = page.getByLabel(/Spreadsheet/);
    await waitForHydration(spreadsheet);
    await spreadsheet.setInputFiles("e2e/fixtures/suppliers-mixed.xlsx");
    await page.getByRole("button", { name: /^Validate/ }).click();
    await expect(page.getByText("1 new · 1 updates · 3 blocked")).toBeVisible({ timeout: 10_000 });

    // Review round 1, Important #2: the aggregate "3 blocked" count above
    // would also pass if a row were blocked for the wrong reason.
    // BlockedCauses (import-wizard.tsx:487) groups by cause and renders each
    // group's blockSpec(...).label verbatim (blocked-causes.tsx:96) — the two
    // "Dup Co" rows collide under blockSpec("duplicate-in-file").label, and
    // "Sometimes Ltd"'s unrecognised status is blockSpec("bad-contract-status").label
    // (both read from src/lib/import-vocabulary.ts, not the raw cause keys).
    await expect(page.getByText("Duplicate within this file")).toBeVisible();
    await expect(page.getByText("Contract status not recognised")).toBeVisible();

    await page.getByRole("button", { name: "Import 2 rows" }).click();
    await expect(
      page.getByText("1 new · 1 updated · 0 already matched · 3 blocked · 0 failed"),
    ).toBeVisible({ timeout: 30_000 });

    await page.goto("/purchases/suppliers?q=harbor");
    await expect(page.getByRole("link", { name: "Harbor Logistics" })).toBeVisible({ timeout: 10_000 });

    // The update row (name matched case-insensitively) carries a patch of
    // only the columns the sheet had — Phone changes, Contact person (a
    // column this reduced sheet never mentions) is untouched.
    const techserve = await db.vendor.findUniqueOrThrow({ where: { name: "TechServe PH" } });
    expect(techserve.phone).toBe("+63 2 8999 0000");
    expect(techserve.contactPerson).toBe("Rina Valdez");
  });

  test("8. A sheet carrying a bank column is refused outright, before any row is read", async ({ page }) => {
    await login(page, PURCHASING);
    const before = await db.vendor.count();

    await page.goto("/purchases/suppliers/import");
    const spreadsheet = page.getByLabel(/Spreadsheet/);
    await waitForHydration(spreadsheet);
    await spreadsheet.setInputFiles("e2e/fixtures/suppliers-bank.xlsx");
    await page.getByRole("button", { name: /^Validate/ }).click();
    await expect(
      page.getByText(/Bank details are entered on the supplier's page, never imported/),
    ).toBeVisible({ timeout: 10_000 });

    expect(await db.vendor.count()).toBe(before);
  });

  test("9. The command palette finds Bayside Networks and opens its profile", async ({ page }) => {
    await login(page, PURCHASING);
    await page.goto("/purchases/suppliers");
    const paletteTrigger = page.getByRole("button", { name: /Search assets, people, requests/ });
    await waitForHydration(paletteTrigger);
    await paletteTrigger.click();
    // Scoped to the palette dialog: "Suppliers" is ALSO the sidebar nav
    // section heading and this very page's own <h1> — both still on screen
    // behind the palette veil.
    const palette = page.getByRole("dialog", { name: "Command palette" });
    await palette.getByRole("textbox", { name: "Search" }).fill("bayside");
    await expect(palette.getByRole("heading", { name: "Suppliers" })).toBeVisible({ timeout: 10_000 });
    await expect(palette.getByRole("option", { name: /Bayside Networks/ })).toBeVisible();

    await page.keyboard.press("Enter");
    const vendor = await byside();
    await expect(page).toHaveURL(new RegExp(`/purchases/suppliers/${vendor.id}$`));
  });

  test("10. Creating a supplier named TechServe PH is refused as a duplicate", async ({ page }) => {
    await login(page, PURCHASING);
    await page.goto("/purchases/suppliers/new");
    const nameField = page.getByLabel(/^Name\b/);
    await waitForHydration(nameField);
    await nameField.fill("TechServe PH");
    await page.getByRole("button", { name: "Create supplier" }).click();
    await expect(page.getByText("A supplier with this name already exists")).toBeVisible({ timeout: 10_000 });

    expect(await db.vendor.count({ where: { name: "TechServe PH" } })).toBe(1);
  });

  test("11. No serious or critical axe violations on the suppliers list, profile, new, and import pages", async ({ page }) => {
    test.setTimeout(60_000); // four full-page axe scans, each with its own settle wait
    await login(page, PURCHASING);

    await page.goto("/purchases/suppliers");
    await expectNoSeriousAxe(page);

    const vendor = await byside();
    await page.goto(`/purchases/suppliers/${vendor.id}`);
    await expectNoSeriousAxe(page);

    await page.goto("/purchases/suppliers/new");
    await expectNoSeriousAxe(page);

    await page.goto("/purchases/suppliers/import");
    await expectNoSeriousAxe(page);
  });
});
