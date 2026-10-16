import { test, expect, type Locator, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import { SEED_PASSWORD } from "../prisma/fixtures";
import { fmtDate } from "@/lib/format";

/**
 * Phase 40 (spec §7, migration 33): offboarding removes IT access. A leaver whose Argus is Done holds nothing and
 * has no M365 account, yet cannot be completed: the Finish checklist reads "IT access · 1 still active" and the
 * Complete button is withheld (the server gate refuses with "Remove their IT access first" behind it) until
 * "Mark removed" on the Accounts step writes Removed.
 *
 * Also (spec 2.1, 2.2): employment moves only through offboarding — Edit offers no "Offboarded" and starts nothing — and
 * the accountability form's Issued column prints the date the item was assigned to this person, not its purchase date.
 */

const db = new PrismaClient();
const IT = "it@thebackroomop.com";
const NO = "EMP-0401";
const NAME = "Phase Forty Leaver";
const NO2 = "EMP-0402";
const NAME2 = "Phase Forty Holder";

test.beforeAll(() => {
  execSync("npm run db:seed", { timeout: 120_000 });
});
test.afterAll(async () => {
  // the holder's asset goes back to the pool before the holder is deleted
  const holder = await db.employee.findUnique({ where: { employeeNo: NO2 } });
  if (holder) await db.asset.updateMany({ where: { assigneeId: holder.id }, data: { assigneeId: null, status: "SPARE" } });
  await db.employee.deleteMany({ where: { employeeNo: { in: [NO, NO2] } } });
  await db.$disconnect();
});

// Copied from e2e/it-work-ux.spec.ts — house rule: never import helpers across spec files.
async function login(page: Page, email: string) {
  await page.goto("/logout");
  await page.getByLabel(/Email/).fill(email);
  await page.getByLabel(/Password/).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
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

test.describe.serial("phase 40 — offboarding removes IT access", () => {
  test("1. a leaver with Argus Done is blocked until Mark removed", async ({ page }) => {
    test.setTimeout(120_000);
    const ops = await db.department.findFirstOrThrow({ where: { name: "Operations" } });
    const leaver = await db.employee.create({
      data: {
        employeeNo: NO, name: NAME, title: "Warehouse Associate", departmentId: ops.id,
        employment: "OFFBOARDING", offboardingAt: new Date(), offboardingDueAt: new Date(Date.now() + 10 * 86_400_000),
        joinedAt: new Date(Date.now() - 300 * 86_400_000),
        // holds nothing, no M365 account: Argus is the only thing in the way
        m365Status: null, entraStatus: "NOT_NEEDED", autopilotStatus: "NOT_YET", argusStatus: "DONE", vpn: "None",
      },
    });

    await login(page, IT);

    // The bare URL opens where the work is: the Accounts step.
    await page.goto(`/offboarding/${leaver.id}`);
    await expect(page.getByRole("heading", { name: NAME, level: 1 })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("region", { name: "IT access" })).toBeVisible();
    await page.goto(`/offboarding/${leaver.id}?step=report`);
    const checklist = page.getByRole("list", { name: "Ready to complete" });
    await expect(checklist).toBeVisible({ timeout: 20_000 });
    await expect(checklist).toContainText("IT access · 1 still active");
    await expect(page.getByRole("button", { name: "Complete offboarding" })).toHaveCount(0);

    // The Accounts step lists the four; only the live one offers Mark removed.
    await checklist.getByRole("link", { name: "IT access · 1 still active" }).click();
    await page.waitForURL(/step=accounts/);
    const access = page.getByRole("region", { name: "IT access" });
    await expect(access.getByRole("listitem")).toHaveCount(4);
    await expect(access.getByRole("button", { name: /Mark removed/ })).toHaveCount(1);
    await expect(access.getByRole("listitem").filter({ hasText: "VPN" })).toContainText("None");
    await expectNoSeriousAxe(page);

    const mark = access.getByRole("button", { name: "Mark removed: Argus" });
    await waitForHydration(mark);
    await mark.click();
    await expect(page.getByText("Argus marked removed")).toBeVisible();
    await expect(access.getByRole("listitem").filter({ hasText: "Argus" })).toContainText("Removed");
    await expect(access.getByRole("button", { name: /Mark removed/ })).toHaveCount(0);
    expect((await db.employee.findUniqueOrThrow({ where: { id: leaver.id } })).argusStatus).toBe("REMOVED");
    const audit = await db.auditEntry.findFirstOrThrow({
      where: { entityType: "employee", entityId: leaver.id, action: "employee.setup" }, orderBy: { createdAt: "desc" },
    });
    expect(JSON.stringify(audit.diff)).toContain("Removed");

    // Now clear: the line reads removed and Complete is offered and works.
    await page.goto(`/offboarding/${leaver.id}?step=report`);
    await expect(page.getByRole("list", { name: "Ready to complete" })).toContainText("IT access · removed");
    const complete = page.getByRole("button", { name: "Complete offboarding" });
    await waitForHydration(complete);
    await complete.click();
    const confirm = page.getByRole("dialog", { name: `Complete ${NAME}'s offboarding?` });
    await confirm.getByRole("button", { name: "Complete", exact: true }).click();
    await page.waitForURL(/done=1/);
    await expect(page.getByRole("heading", { name: `${NAME} offboarded · 0 decisions · ${fmtDate(new Date())}` })).toBeVisible({ timeout: 20_000 });
  });

  test("2. a named VPN is live access too, and Mark removed writes Removed", async ({ page }) => {
    test.setTimeout(90_000);
    const leaver = await db.employee.findFirstOrThrow({ where: { employeeNo: NO } });
    await db.employee.update({
      where: { id: leaver.id },
      data: { employment: "OFFBOARDING", offboardingAt: new Date(), argusStatus: "NOT_NEEDED", vpn: "Cloudflare WARP" },
    });
    await login(page, IT);
    await page.goto(`/offboarding/${leaver.id}?step=accounts`);
    const access = page.getByRole("region", { name: "IT access" });
    const mark = access.getByRole("button", { name: "Mark removed: VPN" });
    await waitForHydration(mark);
    await mark.click();
    await expect(page.getByText("VPN marked removed")).toBeVisible();
    expect((await db.employee.findUniqueOrThrow({ where: { id: leaver.id } })).vpn).toBe("Removed");
  });

  test("3. Edit offers no Offboarded: read-only for an active person, Offboarding or Active for a leaver", async ({ page }) => {
    test.setTimeout(90_000);
    const ops = await db.department.findFirstOrThrow({ where: { name: "Operations" } });
    const holder = await db.employee.create({
      data: {
        employeeNo: NO2, name: NAME2, title: "Warehouse Associate", departmentId: ops.id,
        employment: "ACTIVE", joinedAt: new Date(Date.now() - 300 * 86_400_000),
      },
    });
    const leaver = await db.employee.findFirstOrThrow({ where: { employeeNo: NO } });
    await db.employee.update({
      where: { id: leaver.id },
      data: { employment: "OFFBOARDING", offboardingAt: new Date(), offboardingDueAt: new Date(Date.now() + 10 * 86_400_000) },
    });
    await login(page, IT);

    // ACTIVE: no select at all, just the word and the way into the offboarding dialog.
    await page.goto(`/employees/${holder.id}/edit`);
    const start = page.getByRole("button", { name: "Start offboarding…" });
    await waitForHydration(start);
    await expect(page.getByLabel("Employment")).toHaveCount(0);
    await expect(page.getByText("Offboarded", { exact: true })).toHaveCount(0);
    await start.click();
    await expect(page.getByRole("dialog", { name: `Start offboarding ${NAME2}` })).toBeVisible();
    await page.keyboard.press("Escape");

    // OFFBOARDING: exactly two options, and neither is Offboarded.
    await page.goto(`/employees/${leaver.id}/edit`);
    const employment = page.getByLabel("Employment");
    await waitForHydration(employment);
    await expect(employment.locator("option")).toHaveText(["Offboarding", "Active (cancel offboarding)"]);
    await expect(page.getByRole("button", { name: "Start offboarding…" })).toHaveCount(0);
    await expect(page.getByLabel("Complete offboarding by")).toBeVisible();
  });

  test("4. the accountability form's Issued column is the assignment date, not the purchase date", async ({ page }) => {
    test.setTimeout(60_000);
    const holder = await db.employee.findFirstOrThrow({ where: { employeeNo: NO2 } });
    const asset = await db.asset.findFirstOrThrow({ where: { status: "SPARE", assigneeId: null }, orderBy: { tag: "asc" } });
    const purchased = new Date(Date.now() - 400 * 86_400_000);
    const assigned = new Date(Date.now() - 20 * 86_400_000);
    await db.asset.update({ where: { id: asset.id }, data: { assigneeId: holder.id, status: "DEPLOYED", purchasedAt: purchased } });
    await db.auditEntry.create({
      data: {
        actorLabel: "IT", entityType: "asset", entityId: asset.id, action: "asset.assign",
        diff: { assignee: { from: null, to: NO2 } }, createdAt: assigned,
      },
    });
    await login(page, IT);
    await page.goto(`/employees/${holder.id}/form`);
    const row = page.getByRole("row", { name: new RegExp(asset.tag) });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row).toContainText(fmtDate(assigned));
    await expect(row).not.toContainText(fmtDate(purchased));
  });
});
