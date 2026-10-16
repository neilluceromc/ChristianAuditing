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
 */

const db = new PrismaClient();
const IT = "it@thebackroomop.com";
const NO = "EMP-0401";
const NAME = "Phase Forty Leaver";

test.beforeAll(() => {
  execSync("npm run db:seed", { timeout: 120_000 });
});
test.afterAll(async () => {
  await db.employee.deleteMany({ where: { employeeNo: NO } });
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
});
