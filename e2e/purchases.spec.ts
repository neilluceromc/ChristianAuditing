import { test, expect, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { login } from "./fixtures/login";

/**
 * Purchase orders (migration 38, spec docs/superpowers/specs/2026-10-21-purchase-orders-intake-design.md §3): the list,
 * its ?state= tabs and the sidebar views, a sent-back PO's page, saving a new PO (no drafts: saving sends it), Purchasing
 * editing its own PO while IT has it, cancelling, the viewer, and the audit trail. The full three-team intake (send
 * back, register, Finance's group review, the bell) is e2e/po-intake.spec.ts.
 *
 * Seeded fixtures this file depends on (prisma/seed.ts), all @thebackroomop.com / SEED_PASSWORD:
 *   admin@ · it@ (J. Sarmiento) · purchasing@ (A. Reyes) · finance@ (L. Domingo) · viewer@
 *   PO-0201 SENT_BACK, a pre-PO draft with no sender ("Not sent yet")
 *   PO-0202 SENT_BACK by IT — "Price is per box, not per unit", flagged Unit price
 *   PO-0198 / PO-0195 WITH_IT · PO-0188 READY (completed, legacy) · PO-0203 READY (4 office chairs, non-IT)
 *   PO-0183 CANCELLED
 * Rows never reference raw cuids: the DB is reseeded per file and ids change.
 */

const db = new PrismaClient();

// Spec files share one database and run in alphabetical order — each file reseeds so no file inherits another's mutations.
test.beforeAll(() => {
  execSync("npm run db:seed", { timeout: 120_000 });
});

test.afterAll(async () => {
  await db.$disconnect();
});

async function waitForHydration(target: Locator) {
  const el = target.first();
  await el.waitFor({ state: "attached", timeout: 20_000 });
  await expect(async () => {
    expect(await el.evaluate((node) => Object.keys(node).some((k) => k.startsWith("__reactFiber$")))).toBe(true);
  }).toPass({ timeout: 20_000 });
}

async function expectNoSeriousAxe(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
}

const toast = (page: Page, text: string | RegExp) => page.locator("[data-toast-id]").filter({ hasText: text });
const header = (page: Page) => page.locator("main header").first();
const poId = async (refNo: string) => (await db.purchaseOrder.findUniqueOrThrow({ where: { refNo } })).id;

test.describe("purchase orders — ?state= tab contract & sidebar", () => {
  test("tabs write ?state=; the sidebar's Purchase orders views share the same highlight", async ({ page }) => {
    // The sidebar only renders at the lg: breakpoint.
    await page.setViewportSize({ width: 1280, height: 900 });
    await login(page, "purchasing@thebackroomop.com");
    await page.goto("/purchases");
    await expect(page.getByRole("heading", { name: "Purchase orders", level: 1 })).toBeVisible();

    const main = page.locator("main");
    const sidebar = page.getByRole("navigation", { name: "Workspace" });

    // fresh seed: PO-0201 (a pre-PO draft) and PO-0202 (IT sent it back) are with Purchasing
    await expect(main.getByRole("link", { name: /^Sent back/ })).toContainText("2");
    await main.getByRole("link", { name: /^Sent back/ }).click();
    await expect(page).toHaveURL(/state=SENT_BACK/);
    await expect(main.getByRole("link", { name: /^Sent back/ })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("row", { name: /PO-0202/ })).toBeVisible();
    await expect(page.getByRole("row", { name: /PO-0198/ })).toHaveCount(0); // WITH_IT, not sent back
    await expect(sidebar.getByRole("link", { name: /^Sent back/ })).toHaveAttribute("aria-current", "page");

    // The sidebar's With IT view targets the identical ?state= contract and lands on the same tab.
    await sidebar.getByRole("link", { name: /^With IT/ }).click();
    await expect(page).toHaveURL(/state=WITH_IT/);
    await expect(sidebar.getByRole("link", { name: /^With IT/ })).toHaveAttribute("aria-current", "page");
    await expect(main.getByRole("link", { name: /^With IT/ })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("row", { name: /PO-0198/ })).toBeVisible();
    await expect(page.getByRole("row", { name: /PO-0195/ })).toBeVisible();

    // Task 7: To register is a filter, not a state: the non-IT PO-0203 is in it, the completed PO-0188 is not.
    await sidebar.getByRole("link", { name: /^To register/ }).click();
    await expect(page).toHaveURL(/register=1/);
    await expect(page.getByRole("row", { name: /PO-0203/ })).toBeVisible();
    await expect(page.getByRole("row", { name: /PO-0188/ })).toHaveCount(0);

    // "New purchase order" replaces "Register purchase"
    await expect(sidebar.getByRole("link", { name: "New purchase order" })).toHaveAttribute("href", "/purchases/new");
  });
});

test.describe("purchase orders — search and empty states", () => {
  test("an old PR- number still finds its PO; a filter matching nothing offers Clear filters", async ({ page }) => {
    await login(page, "purchasing@thebackroomop.com");
    await page.goto("/purchases?q=PR-0188");
    await expect(page.getByRole("row", { name: /PO-0188/ })).toBeVisible();

    await page.goto("/purchases?q=zzz-no-such-order-zzz");
    await expect(page.getByText("No purchase order matches this filter")).toBeVisible();
    await page.getByRole("link", { name: "Clear filters" }).click();
    await expect(page).toHaveURL(/\/purchases$/);
    await expect(page.getByRole("row", { name: /PO-0198/ })).toBeVisible();
  });
});

test.describe("purchase orders — a PO sent back by IT (PO-0202)", () => {
  test("the banner names IT and its note, lists the flagged field, and offers Fix and reply; the thread is oldest-first", async ({ page }) => {
    await login(page, "purchasing@thebackroomop.com");
    await page.goto("/purchases");
    await page.getByRole("link", { name: "PO-0202" }).click();
    await expect(page.getByRole("heading", { name: "PO-0202" })).toBeVisible();
    await expect(header(page)).toContainText("Sent back to Purchasing");

    // a status, not an alert: it is part of the page every time it opens
    const banner = page.getByRole("status").filter({ hasText: "Sent back by IT" });
    await expect(banner).toContainText("Sent back by IT — J. Sarmiento");
    await expect(banner).toContainText("Price is per box, not per unit");
    await expect(banner).toContainText("Flagged: Unit price");
    await expect(banner.getByRole("link", { name: "Fix and reply" })).toHaveAttribute("href", /\/edit$/);

    const notes = page.locator("#thread").getByRole("listitem");
    await expect(notes).toHaveCount(2);
    await expect(notes.nth(0)).toContainText("A. Reyes");
    await expect(notes.nth(1)).toContainText("J. Sarmiento");
    await expect(notes.nth(1)).toContainText("Price is per box, not per unit");
  });

  test("a pre-PO draft (PO-0201) says it was never sent", async ({ page }) => {
    await login(page, "purchasing@thebackroomop.com");
    await page.goto(`/purchases/${await poId("PO-0201")}`);
    await expect(page.getByRole("status").filter({ hasText: "Not sent yet" })).toBeVisible();
  });
});

test.describe("purchase orders — axe", () => {
  test("list, new, the sent-back detail page, activity — no serious/critical violations", async ({ page }) => {
    await login(page, "purchasing@thebackroomop.com");
    await page.goto("/purchases");
    await expectNoSeriousAxe(page);

    await page.goto("/purchases/new");
    await expectNoSeriousAxe(page);

    await page.goto(`/purchases/${await poId("PO-0202")}`);
    await expect(page.getByRole("heading", { name: "PO-0202" })).toBeVisible();
    await expectNoSeriousAxe(page);

    await page.goto("/purchases/activity");
    await expectNoSeriousAxe(page);
  });
});

test.describe("purchase orders — saving", () => {
  test.describe.configure({ mode: "serial" });
  let id = "";
  let refNo = "";

  test("a missing price is refused in the form; nothing is sent", async ({ page }) => {
    await login(page, "purchasing@thebackroomop.com");
    await page.goto("/purchases/new");
    const save = page.getByRole("button", { name: "Save", exact: true });
    await waitForHydration(save);
    const before = await db.purchaseOrder.count();

    await page.getByLabel("Line 1 description").fill("Docking stations");
    await page.getByLabel("Line 1 category").selectOption({ label: "Other" });
    // price deliberately left blank
    await save.click();
    await expect(page.getByText("Every line needs its unit price.")).toBeVisible();
    await expect(page).toHaveURL(/\/purchases\/new$/);
    expect(await db.purchaseOrder.count()).toBe(before);
  });

  test("an IT line saves straight to IT; centavos survive the Decimal(12,2) round trip", async ({ page }) => {
    await login(page, "purchasing@thebackroomop.com");
    await page.goto("/purchases/new");
    const save = page.getByRole("button", { name: "Save", exact: true });
    await waitForHydration(save);

    await page.getByRole("main").getByLabel("Vendor").selectOption({ label: "TechServe PH" });
    await page.getByRole("main").getByLabel("SI number").fill("SI-50001");
    await page.getByRole("main").getByLabel("Purchase date").fill("2026-10-19");
    await page.getByRole("main").getByLabel("Department").selectOption({ label: "IT" });
    await page.getByLabel("Line 1 description").fill("Wireless mice");
    await page.getByLabel("Line 1 category").selectOption({ label: "Mouse" });
    await page.getByLabel("Line 1 quantity").fill("3");
    await page.getByLabel("Line 1 unit price").fill("1850.50");
    await save.click();

    await page.waitForURL(/\/purchases\/(?!new)[^/]+$/, { timeout: 30_000 });
    id = new URL(page.url()).pathname.split("/").pop()!;
    refNo = (await page.getByRole("heading", { level: 1 }).textContent())!.trim();
    expect(refNo).toMatch(/^PO-\d{4}$/);
    await expect(toast(page, `${refNo} saved`)).toBeVisible();
    // no drafts: saving sends IT gear to IT
    await expect(header(page)).toContainText("With IT");

    // The edit form's price input reads straight from what Postgres holds: exactly "1850.5", not truncated or drifted.
    await page.goto(`/purchases/${id}/edit`);
    await expect(page.getByLabel("Line 1 unit price")).toHaveValue("1850.5");
    const row = await db.purchaseOrder.findUniqueOrThrow({ where: { id }, include: { lines: true } });
    expect(row.state).toBe("WITH_IT");
    expect(row.invoiceRef).toBe("SI-50001");
    expect(Number(row.lines[0].unitPrice)).toBe(1850.5);
  });

  test("Purchasing edits its own PO while IT has it — no reason needed", async ({ page }) => {
    await login(page, "purchasing@thebackroomop.com");
    await page.goto(`/purchases/${id}`);
    await page.getByRole("link", { name: "Edit", exact: true }).click();
    await page.waitForURL(new RegExp(`/purchases/${id}/edit$`));
    const save = page.getByRole("button", { name: "Save", exact: true });
    await waitForHydration(save);
    await page.getByLabel("Line 1 quantity").fill("4");
    await save.click();
    await page.waitForURL(new RegExp(`/purchases/${id}$`), { timeout: 30_000 });
    await expect(page.locator("#unit-1")).toContainText("4");
    await expect(header(page)).toContainText("With IT");
  });

  test("Cancel asks for a reason, and the PO reads Cancelled with it", async ({ page }) => {
    await login(page, "purchasing@thebackroomop.com");
    await page.goto(`/purchases/${id}`);
    const cancel = page.getByRole("button", { name: "Cancel purchase order" });
    await waitForHydration(cancel);
    await cancel.click();
    const dialog = page.getByRole("dialog", { name: "Cancel purchase order" });
    await dialog.getByRole("textbox", { name: "Reason" }).fill("Ordered twice by mistake");
    await dialog.getByRole("button", { name: "Cancel purchase order" }).click();
    await expect(toast(page, `${refNo} cancelled`)).toBeVisible();
    await expect(header(page)).toContainText("Cancelled");
    await expect(page.getByRole("main")).toContainText("Ordered twice by mistake");
    await expect(page.getByRole("button", { name: "Cancel purchase order" })).toHaveCount(0);
  });
});

test.describe("purchase orders — viewer is read-only", () => {
  test("no New purchase order, no action buttons, no comment box; READ-ONLY badge shows", async ({ page }) => {
    await login(page, "viewer@thebackroomop.com");
    await page.goto("/purchases");
    await expect(page.getByText("READ-ONLY · VIEWER")).toBeVisible();
    await expect(page.getByRole("link", { name: "New purchase order" })).toHaveCount(0);

    await page.getByRole("link", { name: "PO-0198" }).click();
    await expect(page.getByRole("heading", { name: "PO-0198" })).toBeVisible();
    await expect(page.getByText("READ-ONLY · VIEWER")).toBeVisible();

    // The actions bar is omitted for a viewer — not merely disabled. Phase 28's Back control is navigation, the one
    // button allowed in the header.
    const headerButtons = header(page).getByRole("button");
    await expect(headerButtons).toHaveCount(1);
    await expect(headerButtons).toHaveAccessibleName("Back");
    await expect(page.getByRole("link", { name: "Edit", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Register", exact: true })).toHaveCount(0);

    await expect(page.getByLabel("Add a comment")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Post comment" })).toHaveCount(0);
  });
});

test.describe("purchase orders — audit trail", () => {
  test("/purchases/activity shows a PO sentence; /audit resolves purchase entries to PO-#### links", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/purchases/activity");
    await expect(page.getByRole("heading", { name: "Purchasing activity" })).toBeVisible();
    await expect(page.locator("ol")).toContainText(/PO-\d{4}/);

    await page.goto("/audit?entity=purchase-order");
    await expect(page).toHaveURL(/entity=purchase-order/);
    const table = page.locator("table");
    await expect(table.getByRole("link", { name: /^PO-\d{4}$/ }).first()).toBeVisible();
  });
});
