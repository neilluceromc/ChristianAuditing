import { test, expect, type Locator, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import { SEED_PASSWORD } from "../prisma/fixtures";
import { fmtDate } from "@/lib/format";

/**
 * Phase 20, Task 7 — the Transfer feature (spec §3), 5 cases.
 *
 * Seeded fixtures this file depends on (prisma/seed.ts), verified against
 * source rather than assumed from the brief:
 *   EMP-0042 Marites Bautista, Accountant, FINANCE (not Sales — R6). EMP-0095
 *   Leo Tan, Contractor, Operations, no equipment policy applies to them,
 *   holds BR-LT-0210 as a TEMPORARY loan. EMP-0071 Paolo Santos, IT Support,
 *   IT. EMP-0051 Ramon Cruz, Account Executive, Sales. EMP-0063 Grace Lim, HR
 *   Generalist, HR. "Finance standard" is the Finance department's own
 *   equipment policy (laptop/monitor/dock/headset/phone required, second
 *   monitor optional). Departments: Finance, HR, IT, Operations, Sales.
 *   Every account is @thebackroomop.com / SEED_PASSWORD.
 *
 * The Transfer dialog's own department picker (transfer-dialog.tsx) is
 * handed `departments` with the employee's CURRENT department already
 * excluded server-side by the page — so the UI alone can never submit a
 * same-department transfer. Case 3 proves the server's own guard
 * (transfer-actions.ts: `toDepartmentId === employee.departmentId` ->
 * "Already in this department") via the only route left: open the dialog
 * (picker offers a real other department), move the employee to THAT
 * department directly in the database while the dialog stays open, then
 * submit the still-picked value into the now-stale dialog (R8).
 */

const db = new PrismaClient();

test.beforeAll(() => {
  execSync("npm run db:seed", { timeout: 120_000 });
});
test.afterAll(async () => {
  await db.$disconnect();
});

// Copied from e2e/stock.spec.ts:45-51 — house rule: never import helpers
// across spec files, since each file reseeds independently.
async function login(page: Page, email: string) {
  await page.goto("/logout");
  await page.getByLabel(/Email/).fill(email);
  await page.getByLabel(/Password/).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

// Copied from e2e/stock.spec.ts:56-62.
async function expectNoSeriousAxe(page: Page) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(700);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
}

// Copied from e2e/stock.spec.ts:67-77.
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
const IT = "it@thebackroomop.com";

test.describe.serial("transfers", () => {
  test("1. transferring EMP-0042 Finance to HR records the transfer, timeline, audit and the department list", async ({ page }) => {
    const marites = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0042" } });
    const hr = await db.department.findUniqueOrThrow({ where: { name: "HR" } });

    await login(page, IT);
    await page.goto(`/employees/${marites.id}`);
    await page.getByRole("button", { name: "Transfer" }).click();
    const dialog = page.getByRole("dialog");
    await waitForHydration(dialog);
    await expect(dialog.getByRole("heading", { name: "Transfer Marites Bautista" })).toBeVisible();

    await dialog.getByLabel(/^New department\b/).selectOption({ label: "HR" });
    await dialog.getByLabel("Reason").fill("Reorg");
    await dialog.getByRole("button", { name: "Record transfer" }).click();

    // Success toast, before it fades — exact:true because the employee
    // page's own "Transferred from X on Y" header line also contains
    // "Transferred" and would otherwise strict-mode-fail a loose match.
    await expect(page.getByText("Success: Transferred to HR", { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(dialog).toBeHidden();

    // The header line (employees/[id]/page.tsx ~line 185), built with the
    // app's own fmtDate rather than a hand-rolled format so the two never
    // silently disagree.
    await expect(
      page.getByText(`Transferred from Finance on ${fmtDate(new Date())}`),
    ).toBeVisible({ timeout: 15_000 });

    // The Transfers card (transfers-card.tsx): a new row, Finance -> HR,
    // carrying the reason and the actor.
    await expect(page.getByRole("heading", { name: "Transfers" })).toBeVisible();
    const row = page.locator("li").filter({ hasText: "Finance → HR" });
    await expect(row).toBeVisible();
    await expect(row).toContainText("Reorg");
    await expect(row).toContainText("J. Sarmiento");

    // The timeline's fourth source (employees/[id]/timeline/page.tsx).
    await page.goto(`/employees/${marites.id}/timeline`);
    const transferItem = page.locator('li[data-id^="transfer-"]').first();
    await expect(transferItem).toBeVisible({ timeout: 15_000 });
    await expect(transferItem).toContainText("Transferred to");
    await expect(transferItem).toContainText("HR");
    await expect(transferItem).toContainText("from Finance");
    await expect(transferItem).toContainText("Reorg");
    await expect(transferItem).toContainText("J. Sarmiento");

    // The audit entry (transfer-actions.ts's own writeAudit).
    const entry = await db.auditEntry.findFirst({
      where: { entityType: "employee", entityId: marites.id, action: "employee.transferred" },
      orderBy: { createdAt: "desc" },
    });
    expect(entry).not.toBeNull();
    expect(entry!.diff).toMatchObject({
      department: { from: "Finance", to: "HR" },
      title: { from: "Accountant", to: "Accountant" },
    });

    // The employee now shows up under the HR department filter.
    await page.goto(`/employees?department=${hr.id}`);
    await expect(page.getByRole("row", { name: /EMP-0042/ })).toBeVisible({ timeout: 15_000 });
  });

  test("2. moving EMP-0095 (no policy) into Finance (Finance standard) re-evaluates the loadout", async ({ page }) => {
    const leo = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0095" } });

    await login(page, IT);
    await page.goto(`/employees/${leo.id}`);
    // Before: Operations has no equipment policy at all — the "Equipment
    // slots" grid still renders (it's the view's own container, shown
    // regardless), but empty: the "No equipment policy applies" banner is
    // up, and it holds no slot tiles.
    await expect(page.getByText("No equipment policy applies")).toBeVisible();
    const slotGroup = page.getByRole("group", { name: "Equipment slots" });
    await expect(slotGroup.getByRole("button")).toHaveCount(0);

    await page.getByRole("button", { name: "Transfer" }).click();
    const dialog = page.getByRole("dialog");
    await waitForHydration(dialog);
    await dialog.getByLabel(/^New department\b/).selectOption({ label: "Finance" });
    await dialog.getByRole("button", { name: "Record transfer" }).click();
    await expect(dialog).toBeHidden();

    // After: "Finance standard" applies, so the grid gets real slot tiles —
    // the required laptop slot has no laptop assigned but BR-LT-0210
    // (TEMPORARY) covers it, so it reads "on loan" rather than a bare
    // policy gap (spec §6.3, gap 3).
    await expect(page.getByText("No equipment policy applies")).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByRole("button", { name: /^laptop slot, on loan, required$/ })).toBeVisible();
  });

  test("3. a stale dialog cannot transfer into the employee's now-current department", async ({ page }) => {
    const paolo = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0071" } }); // IT
    const hr = await db.department.findUniqueOrThrow({ where: { name: "HR" } });

    await login(page, IT);
    await page.goto(`/employees/${paolo.id}`);
    await page.getByRole("button", { name: "Transfer" }).click();
    const dialog = page.getByRole("dialog");
    await waitForHydration(dialog);

    // R8: the picker excludes the employee's CURRENT department (IT) — the
    // UI alone can never produce this refusal.
    const deptSelect = dialog.getByLabel(/^New department\b/);
    const optionLabels = await deptSelect.locator("option").allTextContents();
    expect(optionLabels).not.toContain("IT");
    expect(optionLabels).toContain("HR");
    await deptSelect.selectOption({ label: "HR" });

    // The race: while this dialog is still open (still offering HR as a
    // valid destination), move Paolo to HR directly, out from under it.
    await db.employee.update({ where: { id: paolo.id }, data: { departmentId: hr.id } });

    await dialog.getByRole("button", { name: "Record transfer" }).click();
    // The server's own guard (transferEmployee: toDepartmentId ===
    // employee.departmentId), surfaced under "New department".
    await expect(dialog.getByText("Already in this department")).toBeVisible({ timeout: 10_000 });
    await expect(dialog).toBeVisible();
  });

  test("4. a future effective date is refused", async ({ page }) => {
    const ramon = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0051" } }); // Sales

    await login(page, IT);
    await page.goto(`/employees/${ramon.id}`);
    await page.getByRole("button", { name: "Transfer" }).click();
    const dialog = page.getByRole("dialog");
    await waitForHydration(dialog);
    await dialog.getByLabel(/^New department\b/).selectOption({ label: "HR" });

    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    await dialog.getByLabel(/^Effective date\b/).fill(tomorrow);
    await dialog.getByRole("button", { name: "Record transfer" }).click();

    await expect(dialog.getByText("That date is in the future")).toBeVisible({ timeout: 10_000 });
    await expect(dialog).toBeVisible();

    // Refused — Ramon never actually moved.
    const after = await db.employee.findUniqueOrThrow({ where: { id: ramon.id } });
    expect(after.departmentId).toBe(ramon.departmentId);
  });

  test("5. the edit form drops the Department select and points to Transfer; the dialog passes axe", async ({ page }) => {
    const grace = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0063" } }); // HR

    await login(page, ADMIN);
    await page.goto(`/employees/${grace.id}/edit`);
    await expect(page.getByLabel(/^Department\b/)).toHaveCount(0);
    await expect(page.getByText("Department changes are recorded with")).toBeVisible();
    await page.getByRole("link", { name: "Transfer" }).click();
    await expect(page).toHaveURL(new RegExp(`/employees/${grace.id}$`));

    await page.getByRole("button", { name: "Transfer" }).click();
    const dialog = page.getByRole("dialog");
    await waitForHydration(dialog);
    await expect(dialog.getByRole("heading", { name: "Transfer Grace Lim" })).toBeVisible();
    await expectNoSeriousAxe(page);
  });
});
