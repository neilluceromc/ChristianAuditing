import { test, expect, type Locator, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { SEED_PASSWORD } from "../prisma/fixtures";

/**
 * Phase 37 — client staff and the profile (spec §7.2). Task 10 added cases 1–3 (Add employee, spec §5);
 * Task 11 adds cases 4–7 (notes, IT setup, ending a client, the Works for column and filter).
 *   1 (§5.2–§5.4) client staff on "Bluepeak Telecom": Works for, accounts & access, a first note; step 2
 *     lists the policy's four lines with "Monitor" / "Monitor 2", a spare picked on Monitor is disabled on
 *     Monitor 2; step 3 sums it up; the profile shows "1 item assigned", the Monitor tile Held, Monitor 2
 *     Missing, the note and Argus Done.
 *   2 (Review Focus 1) the client is ended in another tab while the form is open: Create is refused with
 *     "That department or client is archived" on step 1 and nobody is added. The client is restored.
 *   3 (Review Focus 4) a spare picked in step 2 is assigned to someone else before Create: the person
 *     still exists and the notice says "{tag} could not be assigned: …".
 *   4 (§4.5) notes on a profile: add, edit, delete as IT; a viewer then sees the notes with no textarea and
 *     no Edit or Delete.
 *   5 (§4.6) IT setup: VPN "Other…" with "Zscaler" saves, survives a reload; Argus keeps its value.
 *   6 (§2.2, §5) ending a client on /admin/departments takes it off Client staff on /employees/new; restoring
 *     it puts it back.
 *   7 (§2.3) /employees?kind=CLIENT lists the client hire with the "Client" pill and not EMP-0042.
 *
 * Cases 4–7 do not depend on case 1's hire or on each other: each makes the person (or client) it needs
 * straight in the database, so any of them can run alone.
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
  await page.getByRole("link", { name: /^Log in/ }).click();
  await page.locator('[data-login-ready="true"]').waitFor();
  await page.getByLabel("Work email", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Password", { exact: true }).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
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
const VIEWER = "viewer@thebackroomop.com";

const stepItem = (page: Page, label: string) =>
  page.getByRole("list", { name: "Steps" }).getByRole("listitem").filter({ hasText: label });

/** Step 1: Works for → Client staff; returns the Client select. */
async function chooseClientStaff(page: Page) {
  const worksFor = page.getByRole("radiogroup", { name: "Works for" });
  await waitForHydration(worksFor);
  await expect(worksFor).toBeVisible();
  await worksFor.getByText("Client staff", { exact: true }).click();
  // A required FormField's label carries an aria-hidden "*": getByLabel's exact match sees it, the role's
  // accessible name does not — so required fields are found by role (exact: the radio is "Client staff").
  return page.getByRole("combobox", { name: "Client", exact: true });
}

/** Step 1 up to the group: Works for → Client staff, then the client by name. */
async function pickClient(page: Page, client: string) {
  await (await chooseClientStaff(page)).selectOption({ label: client });
}

/**
 * A client-staff person straight in the database (Bluepeak Telecom), so a case needs nothing from another
 * case. The number is unique per call; the cuid is read back, never hardcoded.
 */
async function makeClientHire(name: string, data: { argusStatus?: "DONE" | "NOT_YET" | "NOT_NEEDED"; vpn?: string } = {}) {
  const dept = await db.department.findUniqueOrThrow({ where: { name: "Bluepeak Telecom" } });
  const employeeNo = `EMP-${String(Date.now()).slice(-6)}${Math.floor(Math.random() * 10)}`;
  return db.employee.create({
    data: { employeeNo, name, title: "Agent", departmentId: dept.id, joinedAt: new Date(), ...data },
  });
}

test.describe.serial("Phase 37 — Add an employee in three steps", () => {
  test("1. client staff with one spare: Monitor picked, the same spare disabled on Monitor 2, setup and a first note", async ({ page }) => {
    test.setTimeout(90_000); // first hit of /employees/new in this file
    const name = `E2E Hire ${Date.now()}`;
    await login(page, IT);
    await page.goto("/employees/new");
    await pickClient(page, "Bluepeak Telecom");
    await page.getByRole("textbox", { name: "Name", exact: true }).fill(name);
    await page.getByRole("textbox", { name: "Title", exact: true }).fill("Agent");
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
    // Phase 39 (spec §2.1): the side card's tabs carry the counts; IT setup is its own tab.
    await expect(page.getByRole("tab", { name: "Notes 1" })).toBeVisible();
    await expect(page.getByText("Starts Monday", { exact: true })).toBeVisible();
    const setupTab = page.getByRole("tab", { name: /^IT setup/ });
    await waitForHydration(setupTab);
    await setupTab.click();
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
      await page.getByRole("textbox", { name: "Name", exact: true }).fill(name);
      await page.getByRole("textbox", { name: "Title", exact: true }).fill("Agent");
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
    await page.getByRole("textbox", { name: "Name", exact: true }).fill(name);
    await page.getByRole("textbox", { name: "Title", exact: true }).fill("Agent");
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

// Cases 4–7 each make what they need, so they are not serial: a failure in 1–3 must not skip them.
test.describe("Phase 37 — notes, IT setup, clients and the Works for filter", () => {
  test("4. notes: add, edit and delete as IT, then a viewer sees them with no textarea and no Edit or Delete", async ({ page }) => {
    test.setTimeout(120_000);
    const stamp = Date.now();
    const hire = await makeClientHire(`E2E Notes ${stamp}`);
    const first = `Laptop ordered ${stamp}`;
    const firstEdited = `Laptop arrived ${stamp}`;
    const second = `Badge printed ${stamp}`;
    // Phase 39 (spec §2.1): the side card's Notes tab panel (its name is the tab's, "Notes {n}") — not every
    // listitem on the page.
    const card = page.getByRole("tabpanel", { name: /^Notes \d+$/ });
    const notesTab = (n: number) => page.getByRole("tab", { name: `Notes ${n}`, exact: true });
    const note = (text: string) => card.getByRole("listitem").filter({ hasText: text });
    const countOf = (action: string) => db.auditEntry.count({ where: { entityType: "employee", entityId: hire.id, action } });

    await login(page, IT);
    await page.goto(`/employees/${hire.id}`);
    const box = page.getByLabel("New note");
    await waitForHydration(box);
    await expect(notesTab(0)).toBeVisible();
    await expect(card.getByText("No notes yet.", { exact: true })).toBeVisible();
    // Phase 39 (spec §2.2): the composer's button is "Add"; Edit and Delete sit behind each note's ⋯ menu.
    const addButton = card.getByRole("button", { name: "Add", exact: true });
    const fromMenu = async (text: string, action: "Edit" | "Delete") => {
      await note(text).getByRole("button", { name: "Note actions", exact: true }).click();
      await page.getByRole("menuitem", { name: action, exact: true }).click();
    };

    // Add.
    await box.fill(first);
    await addButton.click();
    await expect(notesTab(1)).toBeVisible({ timeout: 15_000 });
    await expect(note(first)).toBeVisible();
    await expect(box).toHaveValue("");

    // Edit your own note.
    await fromMenu(first, "Edit");
    await page.getByLabel("Edited text").fill(firstEdited);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(note(firstEdited)).toBeVisible({ timeout: 15_000 });
    await expect(note(firstEdited)).toContainText("edited");
    await expect(note(first)).toHaveCount(0);

    // A second note, so the viewer has something to read after the first is deleted.
    await box.fill(second);
    await addButton.click();
    await expect(notesTab(2)).toBeVisible({ timeout: 15_000 });

    // Delete the first, after its confirmation.
    await fromMenu(firstEdited, "Delete");
    const dialog = page.getByRole("dialog", { name: "Delete this note?" });
    await expect(dialog).toContainText(firstEdited);
    await dialog.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(notesTab(1)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(firstEdited)).toHaveCount(0);
    await expect(note(second)).toBeVisible();
    expect({ added: await countOf("note.added"), edited: await countOf("note.edited"), deleted: await countOf("note.deleted") })
      .toEqual({ added: 2, edited: 1, deleted: 1 });

    // A viewer reads the note and can do nothing to it.
    await login(page, VIEWER);
    await page.goto(`/employees/${hire.id}`);
    await expect(notesTab(1)).toBeVisible({ timeout: 20_000 });
    await expect(note(second)).toBeVisible();
    await expect(page.getByLabel("New note")).toHaveCount(0);
    await expect(card.getByRole("button", { name: "Add", exact: true })).toHaveCount(0);
    await expect(note(second).getByRole("button")).toHaveCount(0);
  });

  test("5. IT setup: VPN Other… with Zscaler saves, and after a reload it is still there and Argus keeps its value", async ({ page }) => {
    test.setTimeout(90_000);
    const hire = await makeClientHire(`E2E Setup ${Date.now()}`, { argusStatus: "DONE" });
    await login(page, IT);
    // Phase 39 (spec §2.1): ?side=setup opens the side card on IT setup (and survives the reload below).
    await page.goto(`/employees/${hire.id}?side=setup`);
    const vpn = page.getByLabel("VPN in use", { exact: true });
    await waitForHydration(vpn);
    await expect(page.getByRole("combobox", { name: "Argus" })).toHaveValue("DONE");

    await vpn.selectOption({ label: "Other…" });
    await page.getByLabel("VPN name", { exact: true }).fill("Zscaler");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    // The "Saved" toast is short-lived; the row is the truth.
    await expect.poll(async () => (await db.employee.findUniqueOrThrow({ where: { id: hire.id } })).vpn, { timeout: 15_000 })
      .toBe("Zscaler");

    await page.reload();
    const after = page.getByLabel("VPN in use", { exact: true });
    await waitForHydration(after);
    await expect(after.locator("option:checked")).toHaveText("Other…");
    await expect(page.getByLabel("VPN name", { exact: true })).toHaveValue("Zscaler");
    await expect(page.getByRole("combobox", { name: "Argus" })).toHaveValue("DONE");
    const row = await db.employee.findUniqueOrThrow({ where: { id: hire.id } });
    expect({ argus: row.argusStatus, vpn: row.vpn }).toEqual({ argus: "DONE", vpn: "Zscaler" });
  });

  test("6. ending a client takes it off Client staff on Add employee, and restoring it puts it back", async ({ page }) => {
    test.setTimeout(120_000);
    const name = `E2E Client ${Date.now()}`;
    const client = await db.department.create({ data: { name, kind: "CLIENT" } });
    const option = (select: Locator) => select.locator("option").filter({ hasText: name });
    await login(page, IT);

    // The new client is offered while it is active.
    await page.goto("/employees/new");
    await expect(option(await chooseClientStaff(page))).toHaveCount(1);

    // End it.
    await page.goto(`/admin/departments?tab=client&q=${encodeURIComponent(name)}`);
    const end = page.getByRole("button", { name: `End the ${name} account` });
    await waitForHydration(end);
    await end.click();
    await expect(page.getByText(`Ended ${name}`)).toBeVisible({ timeout: 15_000 });
    expect((await db.department.findUniqueOrThrow({ where: { id: client.id } })).archivedAt).not.toBeNull();

    // Client staff no longer lists it; the seeded active client is still there.
    await page.goto("/employees/new");
    const ended = await chooseClientStaff(page);
    await expect(ended.locator("option").filter({ hasText: "Bluepeak Telecom" })).toHaveCount(1);
    await expect(option(ended)).toHaveCount(0);

    // Restore it from the Ended filter.
    await page.goto(`/admin/departments?tab=client&show=ended&q=${encodeURIComponent(name)}`);
    const restore = page.getByRole("button", { name: `Restore ${name}`, exact: true });
    await waitForHydration(restore);
    await restore.click();
    await expect(page.getByText(`Restored ${name}`)).toBeVisible({ timeout: 15_000 });
    expect((await db.department.findUniqueOrThrow({ where: { id: client.id } })).archivedAt).toBeNull();

    await page.goto("/employees/new");
    await expect(option(await chooseClientStaff(page))).toHaveCount(1);
  });

  test("7. the Works for column and the Staff filter: ?kind=CLIENT lists the client hire with the Client pill, not EMP-0042", async ({ page }) => {
    test.setTimeout(90_000);
    const name = `E2E Listed ${Date.now()}`;
    await makeClientHire(name);
    await login(page, IT);

    await page.goto("/employees?kind=CLIENT");
    await expect(page.getByRole("heading", { name: "Employees", level: 1 })).toBeVisible({ timeout: 20_000 });
    const row = page.getByRole("row", { name: new RegExp(name) });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row).toContainText("Bluepeak Telecom");
    await expect(row.getByText("Client", { exact: true })).toBeVisible();
    await expect(page.getByRole("row", { name: /EMP-0042/ })).toHaveCount(0);

    // EMP-0042 is Finance, an internal department: it shows under no filter with no pill.
    await page.goto(`/employees?q=${encodeURIComponent("Marites")}`);
    const marites = page.getByRole("row", { name: /EMP-0042/ });
    await expect(marites).toBeVisible({ timeout: 20_000 });
    await expect(marites).toContainText("Finance");
    await expect(marites.getByText("Client", { exact: true })).toHaveCount(0);
  });
});
