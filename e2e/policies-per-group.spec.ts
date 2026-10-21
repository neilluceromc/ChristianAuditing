import { test, expect, type Locator, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { SEED_PASSWORD } from "../prisma/fixtures";

/**
 * Phase 37 Task 5 (spec §3.3): the Equipment policies page, one list per client and per internal department.
 *
 * Seed: "Bluepeak Telecom" (client) has a base policy of four required lines — Workstation (PC)/Mini PC,
 * Monitor/24-inch twice, Headset/Wired; "Harborline Billing" (client) has none; "Finance standard" (Finance)
 * has six lines, the fourth Headset. EMP-0042 (Finance) holds no headset, so their Headset tile is a gap.
 *
 * Cases run serial: case 3 reads Harborline's list as case 2 left it.
 */

const db = new PrismaClient();

test.beforeAll(() => {
  execSync("npm run db:seed", { timeout: 120_000 });
});
test.afterAll(async () => {
  await db.$disconnect();
});

// Copied from e2e/admin.spec.ts — house rule: never import helpers across spec files.
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

// Copied from e2e/admin.spec.ts (itself from e2e/it-nav.spec.ts:88-97).
async function waitForHydration(target: Locator) {
  const el = target.first();
  await el.waitFor({ state: "attached", timeout: 20_000 });
  await expect(async () => {
    expect(await el.evaluate((node) => Object.keys(node).some((k) => k.startsWith("__reactFiber$")))).toBe(
      true,
    );
  }).toPass({ timeout: 20_000 });
}

const IT = "it@thebackroomop.com";
const VIEWER = "viewer@thebackroomop.com";

/** The base policy's editor (title rules get their own region, named after the title). */
const baseEditor = (page: Page) => page.getByRole("region", { name: "What their staff should have" });
const kindSelects = (editor: Locator) => editor.getByLabel(/^Line \d+ kind$/);
const kindOf = (editor: Locator, n: number) => editor.getByLabel(`Line ${n} kind`, { exact: true }).locator("option:checked");
const toasts = (page: Page) => page.locator('div[aria-live="polite"]');
const groupLink = (page: Page, name: string) => page.getByRole("link", { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) });

/**
 * After a save, wait until the refreshed page has replaced the editor (Save idle and disabled again: nothing
 * unsaved). Navigating earlier would meet the editor's beforeunload guard while it is still dirty.
 */
async function settled(editor: Locator) {
  const save = editor.getByRole("button", { name: "Save", exact: true });
  await expect(save).not.toHaveAttribute("aria-busy", "true", { timeout: 15_000 });
  await expect(save).toBeDisabled();
}

test.describe.serial("equipment policies per group", () => {
  test("1. Bluepeak Telecom shows its four lines, two of them Monitor, and the impact line", async ({ page }) => {
    await login(page, IT);
    await page.goto("/admin/equipment-policies?tab=client");
    const bluepeak = groupLink(page, "Bluepeak Telecom");
    await waitForHydration(bluepeak);
    await bluepeak.click();
    await expect(page).toHaveURL(/tab=client&group=/);
    await expect(bluepeak).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { name: "Bluepeak Telecom", level: 2 })).toBeVisible();

    const editor = baseEditor(page);
    await expect(kindSelects(editor)).toHaveCount(4);
    await expect(kindOf(editor, 1)).toHaveText("Workstation (PC)");
    await expect(kindOf(editor, 2)).toHaveText("Monitor");
    await expect(kindOf(editor, 3)).toHaveText("Monitor");
    await expect(kindOf(editor, 4)).toHaveText("Headset");
    await expect(editor.getByText("shows as Monitor 2")).toBeVisible();
    await expect(editor.getByText("0 people get 4 slots (4 required). Missing items show as gaps on their profile. Nothing is taken back.")).toBeVisible();
  });

  test("2. Harborline Billing starts from Bluepeak's list, changes line 4 to Keyboard and saves", async ({ page }) => {
    await login(page, IT);
    await page.goto("/admin/equipment-policies?tab=client");
    const harbor = groupLink(page, "Harborline Billing");
    await waitForHydration(harbor);
    await expect(harbor.locator("[data-has-policy]")).toHaveAttribute("data-has-policy", "no");
    await harbor.click();
    await expect(harbor).toHaveAttribute("aria-current", "page");
    await expect(page.getByText("has no equipment policy yet")).toBeVisible();

    const start = page.getByRole("combobox", { name: "Start from another client's list…" });
    await waitForHydration(start);
    await start.click();
    await start.fill("Blue");
    await page.getByRole("option", { name: /Bluepeak Telecom/ }).click();

    const editor = baseEditor(page);
    await expect(kindSelects(editor)).toHaveCount(4);
    await editor.getByLabel("Line 4 kind", { exact: true }).selectOption({ label: "Keyboard" });
    await expect(editor.getByLabel("Line 4 variant", { exact: true }).locator("option:checked")).toHaveText("Wired");
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await expect(toasts(page)).toContainText("Saved", { timeout: 10_000 });
    await expect(harbor.locator("[data-has-policy]")).toHaveAttribute("data-has-policy", "yes", { timeout: 15_000 });
    await settled(baseEditor(page));

    await page.reload();
    const reloaded = baseEditor(page);
    await expect(kindSelects(reloaded)).toHaveCount(4);
    await expect(kindOf(reloaded, 2)).toHaveText("Monitor");
    await expect(kindOf(reloaded, 3)).toHaveText("Monitor");
    await expect(kindOf(reloaded, 4)).toHaveText("Keyboard");
  });

  test("3. Copy to other clients: replaces a list, or creates one for a client with none", async ({ page }) => {
    const name = `E2E Copy ${Date.now()}`;
    try {
      await login(page, IT);
      await page.goto("/admin/equipment-policies?tab=client");
      await groupLink(page, "Bluepeak Telecom").click();
      let copy = page.getByRole("button", { name: "Copy to other clients…" });
      await waitForHydration(copy);
      await copy.click();
      let dialog = page.getByRole("dialog", { name: "Copy to other clients" });
      await expect(dialog.getByRole("listitem").filter({ hasText: "Harborline Billing" })).toContainText("replaces its 4 items");
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(dialog).toHaveCount(0);

      // a fresh client, made on the Departments & clients page
      await page.goto("/admin/departments");
      const add = page.getByRole("button", { name: "+ Add client" });
      await waitForHydration(add);
      await add.click();
      await page.getByLabel("Name for the new client").fill(name);
      await page.getByRole("button", { name: "Add", exact: true }).click();
      await expect(page.getByRole("row").filter({ hasText: name })).toContainText("Client account", { timeout: 10_000 });

      await page.goto("/admin/equipment-policies?tab=client");
      await groupLink(page, "Bluepeak Telecom").click();
      await expect(groupLink(page, "Bluepeak Telecom")).toHaveAttribute("aria-current", "page");
      copy = page.getByRole("button", { name: "Copy to other clients…" });
      await waitForHydration(copy);
      await copy.click();
      dialog = page.getByRole("dialog", { name: "Copy to other clients" });
      const fresh = dialog.getByRole("listitem").filter({ hasText: name });
      await expect(fresh).toContainText("no policy yet");
      await fresh.getByRole("checkbox").check();
      await dialog.getByRole("button", { name: "Copy to 1", exact: true }).click();
      await expect(toasts(page)).toContainText("Copied to 1", { timeout: 10_000 });
      await expect(dialog).toHaveCount(0);

      const freshLink = groupLink(page, name);
      await expect(freshLink.locator("[data-has-policy]")).toHaveAttribute("data-has-policy", "yes", { timeout: 15_000 });
      await freshLink.click();
      await expect(page.getByRole("heading", { name, level: 2 })).toBeVisible();
      await expect(kindSelects(baseEditor(page))).toHaveCount(4);
    } finally {
      const dept = await db.department.findUnique({ where: { name } });
      if (dept) {
        await db.equipmentPolicy.deleteMany({ where: { appliesToDepartmentId: dept.id } });
        await db.department.delete({ where: { id: dept.id } });
      }
    }
  });

  test("4. removing a line someone had waived drops the waiver with it (Review Focus 3)", async ({ page }) => {
    const marites = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0042" } });
    const finance = await db.department.findFirstOrThrow({ where: { name: "Finance" } });

    await login(page, IT);
    await page.goto(`/employees/${marites.id}`);
    // Phase 37 (spec §4.3): the tile's ⋯ is "More for {label}".
    const actions = page.getByRole("button", { name: "More for Headset", exact: true });
    await waitForHydration(actions);
    await actions.click();
    await page.getByRole("menuitem", { name: "Waive this slot…" }).click();
    const waive = page.getByRole("dialog", { name: "Waive the Headset slot?" });
    await waive.getByRole("button", { name: "Uses own device" }).click();
    await waive.getByRole("button", { name: "Waive", exact: true }).click();
    await expect(page.getByText("Waived for this person (1)")).toBeVisible({ timeout: 10_000 });
    expect(await db.employeeSlotException.count({ where: { employeeId: marites.id, kind: "WAIVE" } })).toBe(1);

    await page.goto(`/admin/equipment-policies?tab=internal&group=${finance.id}`);
    const editor = baseEditor(page);
    await expect(kindSelects(editor)).toHaveCount(6);
    let headset = 0;
    for (let n = 1; n <= 6; n++) {
      if ((await kindOf(editor, n).textContent()) === "Headset") headset = n;
    }
    expect(headset).toBeGreaterThan(0);
    const remove = editor.getByRole("button", { name: `Remove line ${headset}`, exact: true });
    await waitForHydration(remove);
    await remove.click();
    await expect(kindSelects(editor)).toHaveCount(5);
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await expect(toasts(page)).toContainText("Saved", { timeout: 10_000 });
    await settled(editor);
    await expect(kindSelects(editor)).toHaveCount(5);

    await page.goto(`/employees/${marites.id}`);
    await expect(page.getByRole("button", { name: "More for Headset", exact: true })).toHaveCount(0);
    await expect(page.getByText(/Waived for this person/)).toHaveCount(0);
    expect(await db.employeeSlotException.count({ where: { employeeId: marites.id, kind: "WAIVE" } })).toBe(0);
  });

  test("5. a viewer reads the lists but cannot change them", async ({ page }) => {
    const finance = await db.department.findFirstOrThrow({ where: { name: "Finance" } });
    await login(page, VIEWER);
    await page.goto(`/admin/equipment-policies?tab=internal&group=${finance.id}`);
    await expect(page.getByText("READ-ONLY")).toBeVisible();
    const editor = baseEditor(page);
    await expect(editor).toBeVisible();
    await expect(editor.getByRole("cell", { name: "Laptop", exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Save" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "+ Add slot" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Copy to other/ })).toHaveCount(0);
    await expect(page.getByLabel(/^Line \d+ kind$/)).toHaveCount(0);
  });
});
