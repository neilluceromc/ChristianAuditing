import { test, expect, type Locator, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import { SEED_PASSWORD } from "../prisma/fixtures";

/**
 * Phase 40 Task 8 (spec §8, §2.6).
 *   1  The Overview's "Procurement & warranty" card shows OR no., Covered by and Who to call for repairs when set,
 *      and leaves the rows out when they are not.
 *   2  Triage preselects nothing; Dispose needs a reason (a chip, or at least 2 characters) before anything is written.
 *   3  Print asks "Did the labels print correctly?" once the print dialog closes: No keeps the label waiting,
 *      Yes marks it printed. Focus comes back to the Print button either way.
 *   4  (spec §2.5) the Columns chooser's Registration checkbox has its label.
 *
 * Fixtures are created here (tags BR-OT-94xx) and removed before and after; window.print is stubbed so the
 * headless browser returns from it at once, as Chromium does when its dialog closes.
 */

const db = new PrismaClient();
const IT = "it@thebackroomop.com";
const SET_TAG = "BR-OT-9401";
const UNSET_TAG = "BR-OT-9402";
const TRIAGE_TAG = "BR-OT-9403";
const PRINT_TAG = "BR-OT-9404";
const MODEL = "Logitech C920 (e2e phase 40)";
const TAGS = [SET_TAG, UNSET_TAG, TRIAGE_TAG, PRINT_TAG];

async function cleanup() {
  const assets = await db.asset.findMany({ where: { tag: { in: TAGS } }, select: { id: true, purchaseRecordId: true } });
  const ids = assets.map((a) => a.id);
  if (ids.length) {
    await db.approval.deleteMany({ where: { assetId: { in: ids } } });
    await db.asset.deleteMany({ where: { id: { in: ids } } });
  }
  const records = assets.map((a) => a.purchaseRecordId).filter((r): r is string => r !== null);
  if (records.length) await db.purchaseRecord.deleteMany({ where: { id: { in: records }, assets: { none: {} } } });
}

test.beforeAll(async () => {
  execSync("npm run db:seed", { timeout: 120_000 });
  await cleanup();
});
test.afterAll(async () => {
  await cleanup();
  await db.$disconnect();
});

// Copied from e2e/phase-40.spec.ts — house rule: never import helpers across spec files.
async function login(page: Page, email: string) {
  await page.goto("/logout");
  await page.getByRole("link", { name: /^Log in/ }).click();
  await page.locator('[data-login-ready="true"]').waitFor();
  await page.getByLabel("Work email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Password", { exact: true }).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}
async function expectNoSeriousAxe(page: Page) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(700);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
}
async function waitForHydration(target: Locator) {
  const el = target.first();
  await el.waitFor({ state: "attached", timeout: 20_000 });
  await expect(async () => {
    expect(await el.evaluate((node) => Object.keys(node).some((k) => k.startsWith("__reactFiber$")))).toBe(true);
  }).toPass({ timeout: 20_000 });
}
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A description-list term, matched exactly. */
const term = (page: Page, label: string) => page.locator("dt").filter({ hasText: new RegExp(`^${escapeRe(label)}$`) });
/** The value beside that term. */
const valueOf = (page: Page, label: string) => term(page, label).locator("xpath=following-sibling::dd[1]");

async function otherCategory() {
  return db.assetCategory.findFirstOrThrow({ where: { name: "Other", cls: "IT" }, select: { id: true } });
}

test.describe.serial("phase 40 — asset record, triage and the print confirmation", () => {
  test("1. Procurement & warranty shows OR no., Covered by and Who to call for repairs only when set", async ({ page }) => {
    test.setTimeout(90_000);
    const cat = await otherCategory();
    const set = await db.asset.create({
      data: {
        tag: SET_TAG, model: MODEL, categoryId: cat.id, cls: "IT", status: "SPARE", itVerifiedAt: new Date(), labelPrintedAt: new Date(),
        receiptRef: "OR-77120", warrantyCoveredBy: "vendor", warrantyContact: "Acme Service Desk 0917 555 0101",
      },
    });
    const unset = await db.asset.create({
      data: { tag: UNSET_TAG, model: MODEL, categoryId: cat.id, cls: "IT", status: "SPARE", itVerifiedAt: new Date(), labelPrintedAt: new Date() },
    });
    await login(page, IT);

    await page.goto(`/inventory/${set.id}`);
    await expect(page.getByText("Procurement & warranty", { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(valueOf(page, "OR no.")).toHaveText("OR-77120");
    await expect(valueOf(page, "Covered by")).toHaveText("Vendor");
    await expect(valueOf(page, "Who to call for repairs")).toHaveText("Acme Service Desk 0917 555 0101");

    await page.goto(`/inventory/${unset.id}`);
    await expect(page.getByText("Procurement & warranty", { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(term(page, "Invoice / receipt no.")).toHaveCount(1);
    for (const label of ["OR no.", "Covered by", "Who to call for repairs"]) {
      await expect(term(page, label)).toHaveCount(0);
    }
  });

  test("2. triage preselects nothing and Dispose requires a reason", async ({ page }) => {
    test.setTimeout(90_000);
    const cat = await otherCategory();
    const asset = await db.asset.create({
      data: {
        tag: TRIAGE_TAG, model: MODEL, categoryId: cat.id, cls: "IT", status: "SPARE",
        itVerifiedAt: new Date(), labelPrintedAt: new Date(), returnedAt: new Date(),
      },
    });
    await login(page, IT);
    await page.goto(`/inventory/${asset.id}`);
    const open = page.getByRole("button", { name: "Triage", exact: true });
    await expect(open).toBeVisible({ timeout: 20_000 });
    await waitForHydration(open);
    await open.click();
    const dialog = page.getByRole("dialog", { name: `Triage ${TRIAGE_TAG} · ${MODEL}` });
    await expect(dialog).toBeVisible();

    // No default: saving straight away asks for a decision and writes nothing.
    const decision = dialog.getByRole("combobox", { name: "Decision", exact: true });
    await expect(decision).toHaveValue("");
    await dialog.getByRole("button", { name: "Save decision", exact: true }).click();
    await expect(dialog.getByText("Choose a decision", { exact: true })).toBeVisible();
    await expect(decision).toBeFocused();

    // Keep as spare and Send to repair carry an optional Note and no chips.
    await decision.selectOption("SPARE");
    await expect(dialog.getByRole("textbox", { name: "Note", exact: true })).toBeVisible();
    await expect(dialog.getByRole("group", { name: "Quick picks" })).toHaveCount(0);

    // Each decision offers the chips that fit it: Donate has "Donated to staff/charity" and "Obsolete".
    const reason = dialog.getByRole("textbox", { name: "Reason", exact: true });
    const picks = dialog.getByRole("group", { name: "Quick picks" });
    const chipNames = async () => (await picks.getByRole("button").allTextContents()).map((s) => s.trim());
    await decision.selectOption("DONATED");
    await expect(reason).toBeVisible();
    await expect.poll(chipNames).toEqual(["Donated to staff/charity", "Obsolete"]);
    // A chip Dispose does not offer is cleared on the switch.
    await picks.getByRole("button", { name: "Donated to staff/charity", exact: true }).click();
    await expect(reason).toHaveValue("Donated to staff/charity");

    // Dispose: a required Reason with "Beyond repair" and "Obsolete".
    await decision.selectOption("DISPOSE");
    await expect.poll(chipNames).toEqual(["Beyond repair", "Obsolete"]);
    await expect(reason).toHaveValue("");
    await expectNoSeriousAxe(page);

    await dialog.getByRole("button", { name: "Save decision", exact: true }).click();
    await expect(dialog.getByText("Give a reason (at least 2 characters)", { exact: true })).toBeVisible();
    await expect(reason).toBeFocused();
    await reason.fill("x");
    await dialog.getByRole("button", { name: "Save decision", exact: true }).click();
    await expect(dialog.getByText("Give a reason (at least 2 characters)", { exact: true })).toBeVisible();
    let row = await db.asset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(row.status).toBe("SPARE");
    expect(row.returnedAt).not.toBeNull();

    // A chip fills the reason; now it saves.
    await picks.getByRole("button", { name: "Beyond repair", exact: true }).click();
    await expect(reason).toHaveValue("Beyond repair");
    await dialog.getByRole("button", { name: "Save decision", exact: true }).click();
    await expect(page.getByText(`${TRIAGE_TAG} triaged · Dispose`)).toBeVisible({ timeout: 15_000 });
    await expect(dialog).toBeHidden();

    row = await db.asset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(row.status).toBe("DISPOSE");
    expect(row.returnedAt).toBeNull();
    // No reason column on the asset: the audit entry carries it.
    const audit = await db.auditEntry.findFirstOrThrow({
      where: { entityType: "asset", entityId: asset.id, action: "lifecycle.triage" }, orderBy: { createdAt: "desc" },
    });
    expect((audit.diff as Record<string, { to: unknown }>).reason.to).toBe("Beyond repair");
  });

  test("3. the labels print confirmation: No keeps the label waiting, Yes marks it printed", async ({ page }) => {
    test.setTimeout(90_000);
    const cat = await otherCategory();
    const itUser = await db.user.findUniqueOrThrow({ where: { email: IT }, select: { id: true } });
    const record = await db.purchaseRecord.create({
      data: {
        cls: "IT", quantity: 1, createdById: itUser.id,
        assets: { create: { tag: PRINT_TAG, model: MODEL, categoryId: cat.id, cls: "IT", status: "SPARE", labelPrintedAt: null } },
      },
      include: { assets: { select: { id: true } } },
    });
    const id = record.assets[0].id;
    const printedAt = async () => (await db.asset.findUniqueOrThrow({ where: { id }, select: { labelPrintedAt: true } })).labelPrintedAt;

    await login(page, IT);
    // A list selection (?ids=) of a waiting asset: Print stamps it (ruling R26) — now only after Yes.
    await page.goto(`/inventory/labels?ids=${id}`);
    const print = page.getByRole("button", { name: "Print 1 label", exact: true });
    await waitForHydration(print);
    await page.evaluate(() => { window.print = () => {}; });

    // No: the dialog closes, focus is back on Print, and the label is still waiting.
    await print.click();
    const confirm = page.getByRole("dialog", { name: "Did the labels print correctly?" });
    await expect(confirm).toBeVisible();
    await expect(confirm.getByRole("button", { name: "Yes, mark printed", exact: true })).toBeVisible();
    await expectNoSeriousAxe(page);
    await confirm.getByRole("button", { name: "No, keep them in the queue", exact: true }).click();
    await expect(confirm).toBeHidden();
    await expect(print).toBeFocused();
    await page.waitForTimeout(1_500);
    expect(await printedAt()).toBeNull();

    // Escape is No too.
    await print.click();
    await expect(confirm).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(confirm).toBeHidden();
    await expect(print).toBeFocused();
    expect(await printedAt()).toBeNull();

    // Yes: stamped; focus returns to Print, never to <body>.
    await print.click();
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Yes, mark printed", exact: true }).click();
    await expect(confirm).toBeHidden({ timeout: 15_000 });
    await expect(async () => {
      expect(await printedAt()).not.toBeNull();
    }).toPass({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: /^Print \d+ labels?$/ })).toBeFocused();

    // Nothing waiting on the sheet any more (a reprint): Print asks nothing.
    await page.reload();
    const reprint = page.getByRole("button", { name: "Print 1 label", exact: true });
    await waitForHydration(reprint);
    await page.evaluate(() => { window.print = () => {}; });
    await reprint.click();
    await page.waitForTimeout(1_000);
    await expect(confirm).toHaveCount(0);
  });

  test("4. the Columns chooser labels every checkbox, Registration included", async ({ page }) => {
    test.setTimeout(60_000);
    await login(page, IT);
    await page.goto("/inventory");
    const columns = page.getByRole("button", { name: "Columns", exact: true });
    await waitForHydration(columns);
    await columns.click();
    const chooser = page.getByRole("dialog", { name: "Choose columns" });
    await expect(chooser.getByRole("checkbox", { name: "Registration", exact: true })).toHaveCount(1);
    for (const box of await chooser.getByRole("checkbox").all()) {
      expect((await box.evaluate((el) => el.closest("label")?.textContent ?? "")).trim()).not.toBe("");
    }
  });
});
