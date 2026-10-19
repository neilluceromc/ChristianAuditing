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
 * Also (spec 2.4): the asset History and Timeline read in words — names for ids, labels for actions and fields,
 * and never "[object Object]" for the Finance send-back's object value.
 *
 * Also (spec 2.1, 2.2): employment moves only through offboarding — Edit offers no "Offboarded" and starts nothing — and
 * the accountability form's Issued column prints the date the item was assigned to this person, not its purchase date.
 */

const db = new PrismaClient();
const IT = "it@thebackroomop.com";
const FINANCE = "finance@thebackroomop.com";
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
    // Focus is never lost to body: closing the dialog hands it back to its trigger.
    await expect(page.getByRole("dialog", { name: `Start offboarding ${NAME2}` })).toHaveCount(0);
    await expect(start).toBeFocused();

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

test.describe("phase 40 — readable asset history", () => {
  test("5. History and Timeline show names, labels and the send-back's words — never ids or [object Object]", async ({ page }) => {
    test.setTimeout(120_000);
    const tag = "BR-HS-0502";
    const before = await db.asset.findUniqueOrThrow({
      where: { tag },
      select: {
        id: true, financeConfirmedAt: true, financeConfirmedById: true, financeReturnedAt: true, financeReturnedById: true,
        financeReturnReason: true, financeReturnFields: true, financeResubmitNote: true, financeNotCapitalised: true,
      },
    });
    const { id, ...saved } = before;
    try {
      // "IT-checked, with Finance, nothing flagged" — the state Finance's Send back needs
      await db.asset.update({
        where: { id },
        data: {
          financeConfirmedAt: null, financeConfirmedById: null, financeReturnedAt: null, financeReturnedById: null,
          financeReturnReason: null, financeReturnFields: [], financeResubmitNote: null, financeNotCapitalised: false,
        },
      });

      // The real send-back: its audit value is an OBJECT ({ fields, note }), the thing that printed "[object Object]".
      await login(page, FINANCE);
      await page.goto(`/finance/assets/${id}`);
      const sendBack = page.getByRole("region", { name: "Review" }).getByRole("button", { name: "Send back to IT…" });
      await waitForHydration(sendBack);
      await sendBack.click();
      const dialog = page.getByRole("dialog", { name: `Send ${tag} back to IT` });
      await expect(dialog).toBeVisible();
      await dialog.getByLabel("Cost", { exact: true }).check();
      await dialog.getByLabel("Sales invoice").check();
      await dialog.getByLabel("Note for IT").fill("Invoice is for another PO");
      await dialog.getByRole("button", { name: "Send back", exact: true }).click();
      await expect(page.getByText(`${tag} sent back to IT`)).toBeVisible();

      // An edit records ids (categoryId, assigneeId) — written as updateAsset does — plus one id that no longer exists.
      const [fromCat, toCat] = await db.assetCategory.findMany({ where: { cls: "IT" }, orderBy: { name: "asc" }, take: 2 });
      const nina = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0097" } });
      await db.auditEntry.create({
        data: {
          actorLabel: "E2E Phase 40", entityType: "asset", entityId: id, action: "update",
          diff: {
            categoryId: { from: fromCat.id, to: toCat.id },
            assigneeId: { from: "cgone00000000000000000000", to: nina.id },
            purchasedAt: { from: null, to: "2026-01-05T00:00:00.000Z" },
          },
        },
      });

      await login(page, IT);
      await page.goto(`/inventory/${id}/history`);
      const rowOf = (field: string) => page.getByRole("row").filter({ has: page.getByRole("cell", { name: field, exact: true }) }).first();
      await expect(rowOf("Category")).toContainText(toCat.name, { timeout: 20_000 });
      await expect(rowOf("Category")).toContainText(fromCat.name);
      await expect(rowOf("Holder")).toContainText(nina.name);
      await expect(rowOf("Holder")).toContainText("(removed)");
      await expect(rowOf("Purchase date")).toContainText("5 Jan 2026");
      await expect(rowOf("Finance return")).toContainText("Cost, Sales invoice — Invoice is for another PO");
      await expect(page.getByRole("cell", { name: "Returned by Finance" }).first()).toBeVisible();
      const main = page.getByRole("main");
      await expect(main).not.toContainText("[object Object]");
      await expect(main).not.toContainText(toCat.id);
      await expect(main).not.toContainText(nina.id);
      await expect(main).not.toContainText("finance.return");

      await page.goto(`/inventory/${id}/timeline`);
      await expect(page.getByText("sent back: Cost, Sales invoice", { exact: false }).first()).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText("updated category, holder, purchase date").first()).toBeVisible();
      await expect(page.getByRole("main")).not.toContainText("finance.return");
      await expect(page.getByRole("main")).not.toContainText("[object Object]");
    } finally {
      await db.asset.update({ where: { id }, data: saved });
    }
  });
});

/**
 * Phase 40 (spec §2.3, §3, §5): the phone shell, the Keyboard shortcuts dialog that replaced the Help 404, the "/"
 * shortcut, and page titles.
 */
const ADMIN = "admin@thebackroomop.com";

test.describe("phase 40 — phone shell, shortcuts, titles", () => {
  test("6. at 375 px: menu, Search and Scan a tag in the top bar; the drawer has the workspace switch and Sign out", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 375, height: 812 });
    await login(page, ADMIN);
    const menu = page.getByRole("button", { name: "Open menu", exact: true });
    await waitForHydration(menu);
    // the sidebar is hidden below lg; the top bar carries the page name instead
    await expect(page.getByRole("complementary", { name: "Primary" })).toBeHidden();
    await expectNoSeriousAxe(page);

    // Search opens the palette plain …
    await page.getByRole("button", { name: "Search", exact: true }).click();
    const palette = page.getByRole("dialog", { name: "Command palette" });
    const input = palette.getByRole("combobox", { name: "Search" });
    await expect(input).toBeFocused();
    await expect(input).toHaveAttribute("placeholder", "Search assets, people, requests…");
    await page.keyboard.press("Escape");
    await expect(palette).toHaveCount(0);

    // … and Scan a tag opens it with the scan hint
    await page.getByRole("button", { name: "Scan a tag", exact: true }).click();
    await expect(input).toBeFocused();
    await expect(input).toHaveAttribute("placeholder", "Type or scan a tag");
    await page.keyboard.press("Escape");
    await expect(palette).toHaveCount(0);

    // The drawer: workspace switch at the top, the account block (name, role, Sign out) at the bottom
    await menu.click();
    const drawer = page.getByRole("dialog", { name: "IT" });
    await expect(drawer).toBeVisible();
    const switcher = drawer.getByRole("group", { name: "Switch workspace" });
    await expect(switcher.getByRole("button")).toHaveCount(4);
    await expect(switcher.getByRole("button", { name: "IT", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(drawer.getByText("4 workspaces", { exact: true })).toBeVisible();
    await expect(drawer.getByText("System Admin", { exact: true })).toBeVisible();
    // the role line reads the role's label (a <p>, so the "Admin" workspace button does not match)
    await expect(drawer.locator("p", { hasText: /^Admin$/ })).toBeVisible();
    const signOut = drawer.getByRole("button", { name: "Sign out", exact: true });
    await expect(signOut).toBeVisible();
    await expect(drawer).not.toContainText("br.dept");
    await expectNoSeriousAxe(page);

    // the focus trap holds: Tab from Sign out (the last control) wraps to the drawer's Close, never out of it
    await signOut.focus();
    await page.keyboard.press("Tab");
    await expect(drawer.getByRole("button", { name: "Close", exact: true })).toBeFocused();
    expect(await drawer.evaluate((el) => el.contains(document.activeElement))).toBe(true);

    // switching from the drawer closes it, hands focus back to the menu button, and lands on that workspace
    await switcher.getByRole("button", { name: "Purchasing", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page).toHaveURL(/\/purchases$/);
    await expect(page.getByRole("button", { name: "Open menu", exact: true })).toBeFocused();

    // and Sign out from the drawer signs out
    const menuAgain = page.getByRole("button", { name: "Open menu", exact: true });
    await waitForHydration(menuAgain);
    await menuAgain.click();
    await page.getByRole("dialog", { name: "Purchasing" }).getByRole("button", { name: "Sign out", exact: true }).click();
    await page.waitForURL(/\/login/);
  });

  test("7. Keyboard shortcuts replaces Help and lists \"/\"; \"/\" focuses the page's search box, never while typing", async ({ page }) => {
    await login(page, IT);
    await page.goto("/inventory");
    const button = page.getByRole("button", { name: "Keyboard shortcuts", exact: true });
    await waitForHydration(button);
    await expect(page.getByRole("link", { name: "Help" })).toHaveCount(0);
    await expect(page.locator('a[href="/dev/kitchen-sink"]')).toHaveCount(0);

    await button.click();
    const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("kbd", { hasText: /^\/$/ })).toBeVisible();
    await expect(dialog.getByText("Focus this page's search box")).toBeVisible();
    await expect(dialog.locator("kbd", { hasText: /^(Ctrl K|⌘K)$/ })).toBeVisible();
    await expect(dialog.locator("kbd", { hasText: /^J$/ })).toBeVisible();
    await expect(dialog.locator("kbd", { hasText: /^A$/ })).toBeVisible();
    await expect(dialog.locator("kbd", { hasText: /^Esc$/ })).toBeVisible();
    await expectNoSeriousAxe(page);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(button).toBeFocused();

    // "/" from outside a field focuses the search box, and the "/" itself is not typed
    await page.keyboard.press("/");
    const search = page.getByRole("searchbox", { name: "Search assets" });
    await expect(search).toBeFocused();
    await expect(search).toHaveValue("");
    // inside a field, "/" is just a character
    await page.keyboard.type("BR/LT");
    await expect(search).toHaveValue("BR/LT");
  });

  test("8. every page is titled \"{Page} · Backroom IT\" — records by their tag or name", async ({ page }) => {
    await login(page, IT);
    await page.goto("/inventory");
    await expect(page).toHaveTitle("Inventory · Backroom IT");
    const asset = await db.asset.findUniqueOrThrow({ where: { tag: "BR-LT-0148" }, select: { id: true } });
    await page.goto(`/inventory/${asset.id}`);
    await expect(page).toHaveTitle("BR-LT-0148 · Backroom IT");
    await page.goto(`/inventory/${asset.id}/history`);
    await expect(page).toHaveTitle("History · BR-LT-0148 · Backroom IT");
    const person = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0042" }, select: { id: true } });
    await page.goto(`/employees/${person.id}`);
    await expect(page).toHaveTitle("Marites Bautista · Backroom IT");
    await page.goto("/approvals");
    await expect(page).toHaveTitle("Approvals · Backroom IT");
  });

  test("9. an error toast stays until Dismiss; a success toast leaves on its own", async ({ page }) => {
    // The kitchen sink's Row actions menu: "Dispose" raises an error toast, "Request return" a success one.
    await page.goto("/dev/kitchen-sink");
    const menuButton = page.getByRole("button", { name: "Row actions ⋯" });
    await waitForHydration(menuButton);
    const toasts = page.locator('[aria-live="polite"]');

    await menuButton.click();
    await page.getByRole("menuitem", { name: "Dispose" }).click();
    await expect(toasts).toContainText("Not allowed");
    const dismiss = toasts.getByRole("button", { name: "Dismiss" });
    await expect(dismiss).toBeVisible();
    // well past the 4 s a success toast gets: the error is still there
    await page.waitForTimeout(6_000);
    await expect(toasts).toContainText("Not allowed");
    await dismiss.click();
    await expect(toasts).not.toContainText("Not allowed");

    // a success toast carries the same button and goes by itself after ~4 s
    await menuButton.click();
    await page.getByRole("menuitem", { name: "Request return" }).click();
    await expect(toasts).toContainText("Return requested");
    await expect(toasts.getByRole("button", { name: "Dismiss" })).toBeVisible();
    await expect(toasts).not.toContainText("Return requested", { timeout: 10_000 });
  });

  test("10. Approvals' filtered-empty offers Clear filters, and it clears the search", async ({ page }) => {
    await login(page, IT);
    await page.goto("/approvals?q=zzzz-nothing-matches-this");
    const empty = page.getByText("Your filters matched nothing").locator("xpath=..");
    await expect(empty).toBeVisible({ timeout: 20_000 });
    // scoped to the empty state: the chip row above it has its own "Clear filters"
    await empty.getByRole("link", { name: "Clear filters" }).click();
    await expect(page).toHaveURL(/\/approvals$/);
    await expect(page.getByText("Your filters matched nothing")).toHaveCount(0);
  });
});

/**
 * Phase 40 (spec §4): the palette matches serials and holders and says so, an exact tag leads and opens on Enter,
 * and the input is a combobox whose options are real options. The seed carries no serials, so case 11 gives the
 * seeded BR-LT-0148 (held by EMP-0042, Marites Bautista) a unique one for the test and puts its own back.
 */
test.describe("phase 40 — palette search", () => {
  async function openPalette(page: Page) {
    await page.goto("/inventory");
    const trigger = page.getByRole("button", { name: /Search assets, people, requests/ });
    await waitForHydration(trigger);
    await trigger.click();
    const palette = page.getByRole("dialog", { name: "Command palette" });
    const input = palette.getByRole("combobox", { name: "Search" });
    await expect(input).toBeFocused();
    return { palette, input };
  }

  test("11. a serial finds its asset with the \"serial …\" hint; a holder's name finds theirs with \"held by\"", async ({ page }) => {
    const serial = `PH40SN${Date.now()}`;
    const asset = await db.asset.findUniqueOrThrow({ where: { tag: "BR-LT-0148" }, select: { id: true, serial: true } });
    await db.asset.update({ where: { id: asset.id }, data: { serial } });
    try {
      await login(page, IT);
      const { palette, input } = await openPalette(page);

      // "/" while the palette is open never pulls focus to the page's own search box
      await page.keyboard.press("/");
      await expect(input).toBeFocused();

      await input.fill(serial.slice(0, 12).toLowerCase());
      const option = palette.getByRole("group", { name: "Assets" }).getByRole("option", { name: /BR-LT-0148/ });
      await expect(option).toBeVisible({ timeout: 10_000 });
      await expect(option).toContainText(`serial ${serial}`);
      await expect(input).toHaveAttribute("aria-expanded", "true");
      await expect(input).toHaveAttribute("aria-controls", /.+/);
      // the highlighted option is the combobox's active descendant
      const activeId = await input.getAttribute("aria-activedescendant");
      expect(activeId).toBeTruthy();
      await expect(palette.locator(`[id="${activeId}"]`)).toHaveAttribute("aria-selected", "true");

      // a holder's name: the asset says who holds it, and the person says the first tag they hold
      await input.fill("Marites Bautista");
      await expect(option).toContainText("held by Marites Bautista", { timeout: 10_000 });
      const marites = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0042" }, select: { id: true } });
      const first = await db.asset.findFirstOrThrow({
        where: { assigneeId: marites.id, cls: "IT" }, orderBy: { tag: "asc" }, select: { tag: true },
      });
      const person = palette.getByRole("group", { name: "People" }).getByRole("option", { name: /Marites Bautista/ });
      await expect(person).toContainText(`holds ${first.tag}`);

      // hover moves the highlight
      await person.hover();
      await expect(person).toHaveAttribute("aria-selected", "true");
      await expectNoSeriousAxe(page);

      await person.click();
      await expect(page).toHaveURL(new RegExp(`/employees/${marites.id}$`));
    } finally {
      await db.asset.update({ where: { id: asset.id }, data: { serial: asset.serial } });
    }
  });

  test("12. typing an exact tag and pressing Enter at once opens that record", async ({ page }) => {
    const asset = await db.asset.findUniqueOrThrow({ where: { tag: "BR-LT-0148" }, select: { id: true } });
    await login(page, IT);
    const { palette, input } = await openPalette(page);
    // lower case, and Enter straight after the last key (as a scanner sends it) — before the results are back
    await input.pressSequentially("br-lt-0148");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/inventory/${asset.id}$`), { timeout: 10_000 });
    await expect(palette).toHaveCount(0);
  });
});

/**
 * Phase 40 (spec §10, Task 9): the overlays the phase added, scanned with axe, and the toasts' keyboard hand-off.
 *
 * Cases 6, 7 and 11 already run expectNoSeriousAxe with the drawer, the shortcuts dialog and the palette (with
 * results) on screen — serious and critical only, whole page. Cases 13 and 14 hold the two overlays to a stricter
 * bar: the dialog's own subtree, WCAG A/AA tags, NO violation of any impact. (The "region" and "landmark-unique"
 * rules are page-structure rules that mean nothing inside a dialog's subtree, so they are off here.) The palette
 * is not repeated: case 11 scans it open, with its results showing.
 */
async function expectDialogClean(page: Page, label: string) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(700);
  const results = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .disableRules(["region", "landmark-unique"])
    .analyze();
  expect(
    results.violations.map((v) => `${v.id} (${v.impact}) ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`),
    `axe on ${label}`,
  ).toEqual([]);
}
/** Press Tab until the target holds focus — how a keyboard user reaches a toast, which sits last in the page. */
async function tabTo(page: Page, target: Locator) {
  const el = target.first();
  for (let i = 0; i < 300; i++) {
    await page.keyboard.press("Tab");
    if (await el.evaluate((node) => node === document.activeElement)) return;
  }
  throw new Error("Tab never reached the target within 300 presses");
}

test.describe("phase 40 — axe on the new overlays, and toast keyboard hand-off", () => {
  test("13. axe: the Keyboard shortcuts dialog has no violations of any impact", async ({ page }) => {
    test.setTimeout(90_000);
    await login(page, IT);
    await page.goto("/inventory");
    const button = page.getByRole("button", { name: "Keyboard shortcuts", exact: true });
    await waitForHydration(button);
    await button.click();
    const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("kbd", { hasText: /^\/$/ })).toBeVisible();
    await expectDialogClean(page, "the Keyboard shortcuts dialog");
  });

  test("14. axe: the phone shell at 375 px with the drawer open has no violations of any impact", async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 375, height: 812 });
    await login(page, ADMIN);
    const menu = page.getByRole("button", { name: "Open menu", exact: true });
    await waitForHydration(menu);
    await menu.click();
    const drawer = page.getByRole("dialog", { name: "IT" });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
    await expectDialogClean(page, "the phone drawer at 375 px");
  });

  // The kitchen sink's Row actions menu: "Dispose" raises an error toast, and an error toast stays until dismissed,
  // so nothing expires while the keyboard walks to it (a success toast would, after ~4 s, until focus reaches it).
  test("15. with two toasts up, Enter on the first one's Dismiss moves focus to the remaining toast's Dismiss", async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto("/dev/kitchen-sink");
    const menuButton = page.getByRole("button", { name: "Row actions ⋯" });
    await waitForHydration(menuButton);
    const cards = page.locator('[aria-live="polite"] [data-toast-id]');

    for (let n = 1; n <= 2; n++) {
      await menuButton.click();
      await page.getByRole("menuitem", { name: "Dispose" }).click();
      await expect(cards).toHaveCount(n);
    }
    await expect(cards.first()).toContainText("Not allowed");

    await tabTo(page, cards.first().getByRole("button", { name: "Dismiss", exact: true }));
    await page.keyboard.press("Enter");
    await expect(cards).toHaveCount(1);
    await expect(cards.first().getByRole("button", { name: "Dismiss", exact: true })).toBeFocused();

    // the last one goes too, and focus is still not dropped on the page
    await page.keyboard.press("Enter");
    await expect(cards).toHaveCount(0);
    expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true);
  });

  test("16. with a single toast, Enter on its Dismiss hands focus back to the page, never the body", async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto("/dev/kitchen-sink");
    const menuButton = page.getByRole("button", { name: "Row actions ⋯" });
    await waitForHydration(menuButton);
    const cards = page.locator('[aria-live="polite"] [data-toast-id]');

    await menuButton.click();
    await page.getByRole("menuitem", { name: "Dispose" }).click();
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText("Not allowed");

    const dismiss = cards.first().getByRole("button", { name: "Dismiss", exact: true });
    await tabTo(page, dismiss);
    await expect(dismiss).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(cards).toHaveCount(0);
    // the toast went away with focus on it: focus moved to a page element first (the control it came from, or main)
    expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true);
    expect(await page.evaluate(() => document.activeElement?.isConnected === true)).toBe(true);
  });
});
