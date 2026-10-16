import { test, expect, type Locator, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { SEED_PASSWORD } from "../prisma/fixtures";

/**
 * Phase 37 — client staff and the profile (spec §7.2). Task 10 adds the three cases of Add employee
 * (spec §5); Task 11 extends this file.
 *   1 (§5.2–§5.4) client staff on "Bluepeak Telecom": Works for, accounts & access, a first note; step 2
 *     lists the policy's four lines with "Monitor" / "Monitor 2", a spare picked on Monitor is disabled on
 *     Monitor 2; step 3 sums it up; the profile shows "1 item assigned", the Monitor tile Held, Monitor 2
 *     Missing, the note and Argus Done.
 *   2 (Review Focus 1) the client is ended in another tab while the form is open: Create is refused with
 *     "That department or client is archived" on step 1 and nobody is added. The client is restored.
 *   3 (Review Focus 4) a spare picked in step 2 is assigned to someone else before Create: the person
 *     still exists and the notice says "{tag} could not be assigned: …".
 *
 * Seed (prisma/seed.ts): Bluepeak Telecom's base policy is Workstation (PC)/Mini PC, Monitor/24-inch twice
 * and Headset/Wired, all required. The free 24-inch monitor is BR-MN-0911 (BR-MN-0910 is held for Nina by
 * an ACTIVE reservation, so it is not offered); the free wired headset is BR-HS-0502 (its reservation was
 * RELEASED). Case 1 spends a monitor and case 3 a headset, so the two never compete for one spare.
 * Ramon Cruz EMP-0051 is the someone else in case 3. Spares are read off the select, never hardcoded.
 *
 * Never reference a raw cuid — the DB reseeds and cuids change every run.
 */

const db = new PrismaClient();

test.beforeAll(() => {
  execSync("npm run db:seed", { timeout: 120_000 });
});
test.afterAll(async () => {
  await db.$disconnect();
});

// Copied from e2e/it-nav.spec.ts — house rule: never import helpers across spec files.
async function login(page: Page, email: string) {
  await page.goto("/logout");
  await page.getByLabel(/Email/).fill(email);
  await page.getByLabel(/Password/).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

async function waitForHydration(target: Locator) {
  const el = target.first();
  await el.waitFor({ state: "attached", timeout: 20_000 });
  await expect(async () => {
    expect(await el.evaluate((node) => Object.keys(node).some((k) => k.startsWith("__reactFiber$")))).toBe(true);
  }).toPass({ timeout: 20_000 });
}

const IT = "it@thebackroomop.com";

const stepItem = (page: Page, label: string) =>
  page.getByRole("list", { name: "Steps" }).getByRole("listitem").filter({ hasText: label });

/** Step 1 up to the group: Works for → Client staff, then the client by name. */
async function pickClient(page: Page, client: string) {
  const worksFor = page.getByRole("radiogroup", { name: "Works for" });
  await waitForHydration(worksFor);
  await expect(worksFor).toBeVisible();
  await worksFor.getByText("Client staff", { exact: true }).click();
  // exact: the "Client staff" radio's own label also contains the word
  await page.getByLabel("Client", { exact: true }).selectOption({ label: client });
}

test.describe.serial("Phase 37 — Add an employee in three steps", () => {
  test("1. client staff with one spare: Monitor picked, the same spare disabled on Monitor 2, setup and a first note", async ({ page }) => {
    test.setTimeout(90_000); // first hit of /employees/new in this file
    const name = `E2E Hire ${Date.now()}`;
    await login(page, IT);
    await page.goto("/employees/new");
    await pickClient(page, "Bluepeak Telecom");
    await page.getByLabel("Name", { exact: true }).fill(name);
    await page.getByLabel("Title", { exact: true }).fill("Agent");
    const number = page.getByLabel("Employee no.");
    await expect(number).not.toHaveValue("");
    const employeeNo = await number.inputValue();
    await page.getByRole("radiogroup", { name: "Argus" }).getByText("Done", { exact: true }).click();
    await page.getByLabel("VPN", { exact: true }).selectOption("Cloudflare WARP");
    await page.getByLabel("First note").fill("Starts Monday");
    await page.getByRole("button", { name: "Next", exact: true }).click();

    // Step 2: the policy's four lines, numbered.
    await expect(stepItem(page, "Equipment")).toHaveAttribute("aria-current", "step");
    const monitor = page.getByLabel("Monitor", { exact: true });
    await expect(monitor).toBeVisible({ timeout: 15_000 });
    for (const label of ["Workstation (PC)", "Monitor 2", "Headset"]) {
      await expect(page.getByLabel(label, { exact: true })).toBeVisible();
    }
    await expect(monitor.locator("option").first()).toHaveText("Leave as a gap");
    await monitor.selectOption({ index: 1 });
    const pickedId = await monitor.inputValue();
    expect(pickedId).not.toBe("");
    const picked = await db.asset.findUniqueOrThrow({ where: { id: pickedId } });
    // Each spare can be picked once: the same asset is disabled on the other Monitor line.
    await expect(page.getByLabel("Monitor 2", { exact: true }).locator(`option[value="${pickedId}"]`)).toBeDisabled();
    await page.getByRole("button", { name: "Next", exact: true }).click();

    // Step 3: the summary.
    await expect(stepItem(page, "Check & create")).toHaveAttribute("aria-current", "step");
    await expect(page.getByText(/Argus: Done/)).toBeVisible();
    await expect(page.getByText(/VPN: Cloudflare WARP/)).toBeVisible();
    await expect(page.getByText(`Monitor: ${picked.tag} · ${picked.model}`, { exact: true })).toBeVisible();
    await expect(page.getByText("Monitor 2: gap", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Create employee" }).click();

    await page.waitForURL(/\/employees\/[^/?]+\?created=1&assigned=1$/, { timeout: 30_000 });
    await expect(page.getByText("1 item assigned", { exact: true })).toBeVisible();
    await expect(page.getByRole("group", { name: "Monitor", exact: true })).toContainText("Held", { timeout: 15_000 });
    await expect(page.getByRole("group", { name: "Monitor 2", exact: true })).toContainText("Missing");
    await expect(page.getByRole("heading", { name: "Notes (1)" })).toBeVisible();
    await expect(page.getByText("Starts Monday", { exact: true })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Argus" })).toHaveValue("DONE");

    const hire = await db.employee.findUniqueOrThrow({ where: { employeeNo }, include: { department: true } });
    expect(hire.name).toBe(name);
    expect(hire.department.name).toBe("Bluepeak Telecom");
    expect({ entra: hire.entraStatus, autopilot: hire.autopilotStatus, argus: hire.argusStatus, vpn: hire.vpn })
      .toEqual({ entra: "NOT_YET", autopilot: "NOT_YET", argus: "DONE", vpn: "Cloudflare WARP" });
    expect((await db.asset.findUniqueOrThrow({ where: { id: pickedId } })).assigneeId).toBe(hire.id);
    expect(await db.auditEntry.count({ where: { entityType: "employee", entityId: hire.id, action: "note.added" } })).toBe(1);
  });

  test("2. a client ended while the form is open: Create is refused on step 1 and nobody is added", async ({ page, context }) => {
    test.setTimeout(90_000);
    const name = `E2E Ended ${Date.now()}`;
    const harbor = await db.department.findUniqueOrThrow({ where: { name: "Harborline Billing" } });
    try {
      await login(page, IT);
      await page.goto("/employees/new");
      await pickClient(page, "Harborline Billing");
      await page.getByLabel("Name", { exact: true }).fill(name);
      await page.getByLabel("Title", { exact: true }).fill("Agent");
      await expect(page.getByLabel("Employee no.")).not.toHaveValue("");

      // Meanwhile, in another tab of the same session, the client account is ended.
      const other = await context.newPage();
      await other.goto("/admin/departments");
      const end = other.getByRole("button", { name: "End the Harborline Billing account" });
      await waitForHydration(end);
      await end.click();
      await expect(other.getByText("Ended Harborline Billing")).toBeVisible({ timeout: 15_000 });
      await other.close();
      expect((await db.department.findUniqueOrThrow({ where: { id: harbor.id } })).archivedAt).not.toBeNull();

      await page.getByRole("button", { name: "Next", exact: true }).click();
      const next = page.getByRole("button", { name: "Next", exact: true });
      await expect(stepItem(page, "Equipment")).toHaveAttribute("aria-current", "step");
      await expect(next).toBeEnabled({ timeout: 15_000 });
      await next.click();
      await page.getByRole("button", { name: "Create employee" }).click();

      // The server refuses; the error lands under the Client select on step 1.
      await expect(page.getByText("That department or client is archived", { exact: true })).toBeVisible({ timeout: 15_000 });
      await expect(stepItem(page, "Details")).toHaveAttribute("aria-current", "step");
      await expect(page).toHaveURL(/\/employees\/new$/);
      expect(await db.employee.count({ where: { name } })).toBe(0);

      await page.goto(`/employees?q=${encodeURIComponent(name)}`);
      await expect(page.getByRole("heading", { name: "Employees", level: 1 })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole("row", { name: new RegExp(name) })).toHaveCount(0);
    } finally {
      // Restore the client whatever happened above, so later cases and files see it active.
      await db.department.update({ where: { id: harbor.id }, data: { archivedAt: null } });
    }
  });

  test("3. a spare taken between steps: the person is still created and the notice names the spare", async ({ page, context }) => {
    test.setTimeout(90_000);
    const name = `E2E Taken ${Date.now()}`;
    const ramon = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0051" } });
    await login(page, IT);
    await page.goto("/employees/new");
    await pickClient(page, "Bluepeak Telecom");
    await page.getByLabel("Name", { exact: true }).fill(name);
    await page.getByLabel("Title", { exact: true }).fill("Agent");
    await page.getByRole("button", { name: "Next", exact: true }).click();

    const headset = page.getByLabel("Headset", { exact: true });
    await expect(headset).toBeVisible({ timeout: 15_000 });
    await headset.selectOption({ index: 1 });
    const assetId = await headset.inputValue();
    expect(assetId).not.toBe("");
    const asset = await db.asset.findUniqueOrThrow({ where: { id: assetId } });
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByText(`Headset: ${asset.tag} · ${asset.model}`, { exact: true })).toBeVisible();

    // Before Create, the same spare goes to Ramon from its record (the direct Assign dialog).
    const other = await context.newPage();
    await other.goto(`/inventory/${assetId}`);
    const assign = other.getByRole("button", { name: "Assign", exact: true });
    await waitForHydration(assign);
    await assign.click();
    const dialog = other.getByRole("dialog", { name: `Assign ${asset.tag} · ${asset.model}` });
    await dialog.getByRole("combobox").fill("EMP-0051");
    await dialog.getByRole("option", { name: /EMP-0051/ }).click();
    await dialog.getByRole("button", { name: "Assign", exact: true }).click();
    await expect(other.getByText(`${asset.tag} assigned to ${ramon.name}`)).toBeVisible({ timeout: 15_000 });
    await other.close();

    await page.getByRole("button", { name: "Create employee" }).click();
    await page.waitForURL(/\/employees\/[^/?]+\?created=1&assigned=0&failed=/, { timeout: 30_000 });
    await expect(page.getByText(`${asset.tag} could not be assigned:`)).toBeVisible();
    await expect(page.getByText(/^\d+ items? assigned$/)).toHaveCount(0);

    const hire = await db.employee.findFirstOrThrow({ where: { name } });
    expect((await db.asset.findUniqueOrThrow({ where: { id: assetId } })).assigneeId).toBe(ramon.id);
    expect(await db.asset.count({ where: { assigneeId: hire.id } })).toBe(0);
  });
});
