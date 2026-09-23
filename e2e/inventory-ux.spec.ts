import { test, expect, type Locator, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import { SEED_PASSWORD } from "../prisma/fixtures";
import { localDateISO } from "@/lib/format";

/**
 * Phase 30, Task 8 — the inventory area after the Laws of UX pass, end to end.
 * Thirteen independent cases; each restores the mutable state it touched in a
 * `finally` (audit rows are append-only and are never deleted).
 *   1  (§4.1) a spare's header: Assign, Edit, and a More menu of exactly three.
 *   2  (§4.1/§4.3) a held device's header: Return, Replace… first, the named Return dialog.
 *   3  (§4.1) back, not checked: Triage, one extra pill, Save decision.
 *   4  (§4.1, P-4) a pending approval: no primary, the banner, only Print label.
 *   5  (§4.2, P-6) Change status offers only the legal targets, in friendly words.
 *   6  (§6.3) the list's row menu returns a device.
 *   7  (§6.3, P-10) the attention count, its sort, and the reason lines.
 *   8  (§6.2) holder search and Clear search.
 *   9  (§5.3) Register at quantity 1 as a loan.
 *   10 (§5.4) a batch with pasted serials; Enter moves, never submits.
 *   11 (§5.5) one-pass errors, focus on the first invalid field.
 *   12 (decision 6, P-7) Purchasing staff open on their own class.
 *   13 (§4.1) a viewer's record: nothing to press, the READ-ONLY pill.
 *
 * Seeded fixtures (prisma/seed.ts): BR-HS-0502 SPARE, no hold (its reservation
 * is RELEASED); BR-LT-0201 DEPLOYED to Carlo Dizon EMP-0099 (MacBook Air M3);
 * BR-LT-0181 SPARE with APR-2041 PENDING; BR-DK-0071 DEPLOYED to Marites
 * Bautista EMP-0042 (WD19S Dock); Nina Robles EMP-0097 ACTIVE; BR-FN-0003 is a
 * Purchasing asset. No seeded asset carries `returnedAt`, so case 3 sets it.
 * Cases 9 and 10 create assets, which cannot be deleted — their model names are
 * unique and the next spec file's reseed removes them.
 */

const db = new PrismaClient();

test.beforeAll(() => {
  execSync("npm run db:seed", { timeout: 120_000 });
});
test.afterAll(async () => {
  await db.$disconnect();
});

const IT = "it@thebackroomop.com";
const PURCHASING = "purchasing@thebackroomop.com";
const VIEWER = "viewer@thebackroomop.com";

// Copied from e2e/it-nav.spec.ts (itself from e2e/it-gaps.spec.ts) — house
// rule: never import helpers across spec files, since each file reseeds
// independently.
async function login(page: Page, email: string) {
  await page.goto("/logout");
  await page.getByLabel(/Email/).fill(email);
  await page.getByLabel(/Password/).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

// Copied from e2e/it-nav.spec.ts.
async function expectNoSeriousAxe(page: Page) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(700);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
}

// Copied from e2e/it-nav.spec.ts.
async function waitForHydration(target: Locator) {
  const el = target.first();
  await el.waitFor({ state: "attached", timeout: 20_000 });
  await expect(async () => {
    expect(await el.evaluate((node) => Object.keys(node).some((k) => k.startsWith("__reactFiber$")))).toBe(
      true,
    );
  }).toPass({ timeout: 20_000 });
}

/** The record's page header — the `<header>` that carries the tag as its h1. */
function recordHeader(page: Page, tag: string): Locator {
  return page.locator("header").filter({ has: page.getByRole("heading", { level: 1, name: tag, exact: true }) });
}

/** The header's actions group (PageHeader renders it as the header's second div). */
function headerActions(page: Page, tag: string): Locator {
  return recordHeader(page, tag).locator(":scope > div").last();
}

/** Every button in the actions group except a menu trigger — i.e. the state-chosen primary, if any. */
function primaries(page: Page, tag: string): Locator {
  return headerActions(page, tag).locator('button:not([aria-haspopup="menu"])');
}

/** The pills beside the h1: the status pill first, then at most one more. */
function headerPills(page: Page, tag: string): Locator {
  return recordHeader(page, tag).locator("h1 + span > span");
}

/**
 * Opens a ⋯ menu and returns it — retried until the island has hydrated, since
 * a click on the server-rendered trigger before then does nothing (the same
 * shape as direct-lifecycle.spec.ts's openMore).
 */
async function openMenu(page: Page, trigger: Locator): Promise<Locator> {
  const menu = page.getByRole("menu");
  await expect(async () => {
    if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click();
    await expect(menu).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  return menu;
}

async function openMore(page: Page): Promise<Locator> {
  return openMenu(page, page.getByRole("button", { name: "More actions", exact: true }));
}

/** Clicks a server-rendered button until the dialog it opens is visible (hydration). */
async function openDialog(page: Page, button: Locator, name: string): Promise<Locator> {
  const dialog = page.getByRole("dialog", { name });
  await expect(async () => {
    if (!(await dialog.isVisible())) await button.click();
    await expect(dialog).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  return dialog;
}

/** A list row's cell under the named column header (the column chooser may hide columns, so never a fixed index). */
async function cellOf(page: Page, row: Locator, header: string): Promise<Locator> {
  const idx = await page
    .locator("thead th")
    .evaluateAll((ths, h) => ths.findIndex((th) => (th.textContent ?? "").trim().startsWith(h)), header);
  expect(idx, `a "${header}" column`).toBeGreaterThanOrEqual(0);
  return row.locator("td").nth(idx);
}

async function assetId(tag: string): Promise<string> {
  return (await db.asset.findUniqueOrThrow({ where: { tag }, select: { id: true } })).id;
}

test.describe("record header", () => {
  test("1. a spare offers Assign, Edit, and a More menu of Reserve, Change status and Print label", async ({ page }) => {
    const id = await assetId("BR-HS-0502");
    await login(page, IT);
    await page.goto(`/inventory/${id}`);

    await expect(primaries(page, "BR-HS-0502")).toHaveCount(1);
    await expect(primaries(page, "BR-HS-0502")).toHaveText("Assign");
    await expect(headerActions(page, "BR-HS-0502").getByRole("link", { name: "Edit", exact: true })).toBeVisible();
    const menu = await openMore(page);
    await expect(menu.getByRole("menuitem")).toHaveText(["Reserve…", "Change status…", "Print label"]);
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expectNoSeriousAxe(page);
  });

  test("2. a held device offers Return first, Replace… first in More, and the named Return dialog", async ({ page }) => {
    const id = await assetId("BR-LT-0201");
    await login(page, IT);
    await page.goto(`/inventory/${id}`);

    await expect(primaries(page, "BR-LT-0201")).toHaveCount(1);
    await expect(primaries(page, "BR-LT-0201")).toHaveText("Return");
    const menu = await openMore(page);
    await expect(menu.getByRole("menuitem").first()).toHaveText("Replace…");
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();

    const dialog = await openDialog(
      page,
      primaries(page, "BR-LT-0201"),
      "Return BR-LT-0201 · MacBook Air M3 from Carlo Dizon?",
    );
    await expect(dialog.getByRole("button", { name: "Return", exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    // Cancelled: nothing moved.
    const after = await db.asset.findUniqueOrThrow({ where: { id }, include: { assignee: true } });
    expect(after.assignee?.employeeNo).toBe("EMP-0099");
  });

  test("3. back, not checked: Triage is the primary, one extra pill, and the dialog saves a decision", async ({ page }) => {
    const id = await assetId("BR-HS-0502");
    const before = await db.asset.findUniqueOrThrow({ where: { id }, select: { returnedAt: true } });
    try {
      await db.asset.update({ where: { id }, data: { returnedAt: new Date() } });
      await login(page, IT);
      await page.goto(`/inventory/${id}`);

      await expect(primaries(page, "BR-HS-0502")).toHaveCount(1);
      await expect(primaries(page, "BR-HS-0502")).toHaveText("Triage");
      // the status pill plus exactly one pill that asks something
      await expect(headerPills(page, "BR-HS-0502")).toHaveCount(2);
      await expect(headerPills(page, "BR-HS-0502").nth(1)).toHaveText("BACK · NOT CHECKED");

      const dialog = await openDialog(page, primaries(page, "BR-HS-0502"), "Triage BR-HS-0502 · Jabra Evolve2 40");
      await expect(dialog.getByRole("button", { name: "Save decision" })).toBeVisible();
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(dialog).toBeHidden();
    } finally {
      await db.asset.update({ where: { id }, data: { returnedAt: before.returnedAt } });
    }
  });

  test("4. a pending approval: no primary, the pending banner, and only Print label in More", async ({ page }) => {
    const id = await assetId("BR-LT-0181");
    await login(page, IT);
    await page.goto(`/inventory/${id}`);

    await expect(headerActions(page, "BR-LT-0181").getByRole("button", { name: "More actions", exact: true })).toBeVisible();
    await expect(primaries(page, "BR-LT-0181")).toHaveCount(0);
    await expect(page.getByText(/^APR-2041 · .+ is pending$/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Open request" })).toBeVisible();
    const menu = await openMore(page);
    await expect(menu.getByRole("menuitem")).toHaveText(["Print label"]);
  });

  test("5. Change status opens on Pick a status…, offers only the legal targets, and refuses an empty pick", async ({ page }) => {
    const id = await assetId("BR-HS-0502");
    await login(page, IT);
    await page.goto(`/inventory/${id}`);

    const menu = await openMore(page);
    await menu.getByRole("menuitem", { name: "Change status…", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Change status of BR-HS-0502 · Jabra Evolve2 40" });
    await expect(dialog).toBeVisible();
    const select = dialog.getByLabel("New status");
    await expect(select).toHaveValue("");
    await expect(select.locator("option:checked")).toHaveText("Pick a status…");
    // Friendly words (plan P-6) for DEFECTIVE, DONATED, BUYOUT, DISPOSE, MISSING — never SPARE (current) or a holder status.
    await expect(select.locator("option")).toHaveText(["Pick a status…", "Defective", "Donated", "Buyout", "Dispose", "Missing"]);
    await expect(select.locator("option:not([value=''])")).toHaveCount(5);
    expect(await select.locator("option:not([value=''])").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value))).toEqual([
      "DEFECTIVE", "DONATED", "BUYOUT", "DISPOSE", "MISSING",
    ]);

    await dialog.getByRole("button", { name: "Change status", exact: true }).click();
    await expect(dialog.getByText("Pick a status", { exact: true })).toBeVisible();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    expect((await db.asset.findUniqueOrThrow({ where: { id } })).status).toBe("SPARE");
  });
});

test.describe("inventory list", () => {
  test("6. the row menu returns a held device; the holder cell empties", async ({ page }) => {
    const before = await db.asset.findUniqueOrThrow({
      where: { tag: "BR-DK-0071" },
      select: { id: true, status: true, assigneeId: true, returnedAt: true },
    });
    try {
      await login(page, IT);
      // An exact tag in q jumps straight to the record (page.tsx), so narrow by the model instead.
      await page.goto("/inventory?q=WD19S");
      const row = page.getByRole("row", { name: /BR-DK-0071/ });
      await expect(row).toBeVisible();
      await expect(await cellOf(page, row, "Assigned")).toContainText("Marites Bautista");

      const menu = await openMenu(page, row.getByRole("button", { name: "Actions for BR-DK-0071" }));
      await expect(menu.getByRole("menuitem")).toHaveText(["Return…", "Change status…", "Print label", "Open record"]);
      await menu.getByRole("menuitem", { name: "Return…", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Return BR-DK-0071 · WD19S Dock from Marites Bautista?" });
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Return", exact: true }).click();

      await expect(page.getByText("BR-DK-0071 returned · now SPARE")).toBeVisible({ timeout: 15_000 });
      await expect(dialog).toBeHidden();
      await expect(await cellOf(page, row, "Assigned")).toHaveText("—", { timeout: 15_000 });
      const after = await db.asset.findUniqueOrThrow({ where: { id: before.id } });
      expect(after.assigneeId).toBeNull();
      expect(after.status).toBe("SPARE");
    } finally {
      await db.asset.update({
        where: { id: before.id },
        data: { status: before.status, assigneeId: before.assigneeId, returnedAt: before.returnedAt },
      });
    }
  });

  test("7. the attention count links the Attention sort; rows carry their reason", async ({ page }) => {
    await login(page, IT);
    await page.goto("/inventory");

    const count = page.locator('p[aria-live="polite"]').filter({ hasText: /assets? ·/ });
    await expect(count).toHaveText(/^\d+ assets · \d+ needs? attention$/);
    const link = count.getByRole("link", { name: /needs? attention$/ });
    await waitForHydration(link);
    await link.click();
    await expect(page).toHaveURL(/[?&]sort=attention(&|$)/);

    const first = page.locator("tbody tr").first();
    const reason = (await cellOf(page, first, "Status")).locator("span.block");
    await expect(reason).toBeVisible();
    await expect(reason).not.toHaveText("");

    const queued = page.getByRole("row", { name: /BR-LT-0181/ });
    await expect(await cellOf(page, queued, "Status")).toContainText("queued APR-2041");
  });

  test("8. a holder's name finds their device; Clear search empties the box and drops q", async ({ page }) => {
    await login(page, IT);
    await page.goto("/inventory");

    const search = page.getByRole("searchbox", { name: "Search assets" });
    await waitForHydration(search);
    await expect(search).toHaveAttribute("placeholder", "Search tag, model, serial, holder · Enter");
    await search.fill("Carlo");
    await search.press("Enter");
    await expect(page).toHaveURL(/[?&]q=Carlo/);
    await expect(page.getByRole("row", { name: /BR-LT-0201/ })).toBeVisible();

    const clear = page.getByRole("button", { name: "Clear search" });
    await waitForHydration(clear);
    await clear.click();
    await expect(page).not.toHaveURL(/[?&]q=/);
    await expect(page.getByRole("searchbox", { name: "Search assets" })).toHaveValue("");
  });
});

test.describe("register", () => {
  test("9. quantity 1 as a Loan lands on the record with Print label and Register another", async ({ page }) => {
    const model = `ThinkPad X13 (e2e ux loan ${Date.now()})`;
    const due = localDateISO(new Date(Date.now() + 10 * 86_400_000));
    const nina = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0097" } });

    await login(page, IT);
    await page.goto("/inventory/register");
    await waitForHydration(page.getByLabel("Category"));
    await page.getByLabel("Category").selectOption({ label: "Laptop" });
    await page.getByLabel("Model").fill(model);
    await page.getByRole("radiogroup", { name: "Initial state" }).getByText("Loan", { exact: true }).click();
    await expect(page.getByLabel("Loan until")).toBeVisible();
    await page.getByLabel("Assign to").fill("EMP-0097");
    await page.getByRole("option", { name: /EMP-0097/ }).click();
    await page.getByLabel("Loan until").fill(due);
    await page.getByRole("button", { name: "Register 1 asset" }).click();

    await expect(page).toHaveURL(/\/inventory\/[^/?]+\?created=1$/, { timeout: 30_000 });
    await expect(page.getByRole("link", { name: "Print label" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Register another" })).toHaveAttribute("href", "/inventory/register?cls=IT");

    const created = await db.asset.findFirstOrThrow({ where: { model } });
    expect(new URL(page.url()).pathname).toBe(`/inventory/${created.id}`);
    expect(created.status).toBe("TEMPORARY");
    expect(created.assigneeId).toBe(nina.id);
    expect(created.loanDueAt?.toISOString().slice(0, 10)).toBe(due);
  });

  test("10. pasted serials fill the rows, Enter moves without submitting, and the batch lists its tags", async ({ page }) => {
    const model = `ThinkPad X13 (e2e ux batch ${Date.now()})`;

    await login(page, IT);
    await page.goto("/inventory/register");
    await waitForHydration(page.getByLabel("Category"));
    await page.getByLabel("Category").selectOption({ label: "Laptop" });
    await page.getByLabel("Model").fill(model);
    await page.getByLabel("Quantity").fill("3");
    await expect(page.getByLabel("Serial 3")).toBeVisible();

    // A real paste event carrying text/plain — the cell's onPaste reads clipboardData.
    await page.getByLabel("Serial 1").evaluate((el, text) => {
      const data = new DataTransfer();
      data.setData("text/plain", text);
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    }, "SN-A\nSN-B\nSN-C");
    await expect(page.getByLabel("Serial 1")).toHaveValue("SN-A");
    await expect(page.getByLabel("Serial 2")).toHaveValue("SN-B");
    await expect(page.getByLabel("Serial 3")).toHaveValue("SN-C");
    await expect(page.getByText("Pasted 3 serials", { exact: true })).toBeVisible();

    const url = page.url();
    await page.getByLabel("Serial 1").focus();
    await page.getByLabel("Serial 1").press("Enter");
    await expect(page.getByLabel("Serial 2")).toBeFocused();
    await expect(page).toHaveURL(url);
    await expect(page.getByRole("button", { name: "Register 3 assets" })).toBeVisible();
    expect(await db.asset.count({ where: { model } })).toBe(0);

    const tags = await Promise.all([1, 2, 3].map((i) => page.getByLabel(`Tag ${i}`).inputValue()));
    await page.getByRole("button", { name: "Register 3 assets" }).click();
    await expect(page.getByText(new RegExp(`^3 assets registered — ${tags[0]} … ${tags[2]}$`))).toBeVisible({ timeout: 30_000 });
    for (const tag of tags) await expect(page.getByRole("link", { name: tag, exact: true })).toBeVisible();

    const rows = await db.asset.findMany({ where: { model }, orderBy: { tag: "asc" } });
    expect(rows.map((r) => r.tag)).toEqual([...tags].sort());
    expect(rows.map((r) => r.serial).sort()).toEqual(["SN-A", "SN-B", "SN-C"]);
  });

  test("11. a refused submit shows every error at once and focuses Category", async ({ page }) => {
    await login(page, IT);
    await page.goto("/inventory/register");
    const register = page.getByRole("button", { name: "Register 1 asset" });
    await waitForHydration(register);
    await register.click();

    await expect(page.getByText("Pick a category", { exact: true })).toBeVisible();
    await expect(page.getByText("Name the model", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Category")).toBeFocused();
    await expect(page).toHaveURL(/\/inventory\/register$/);
  });
});

test.describe("roles", () => {
  test("12. purchasing staff open on Purchasing; the IT switch names cls=IT; a Purchasing record returns to plain /inventory", async ({ page }) => {
    const id = await assetId("BR-FN-0003");
    await login(page, PURCHASING);
    await page.goto("/inventory");

    await expect(page.getByRole("heading", { level: 1, name: "Purchasing assets" })).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Asset class" }).getByRole("link", { name: "IT", exact: true }),
    ).toHaveAttribute("href", /[?&]cls=IT(&|$)/);

    await page.goto(`/inventory/${id}`);
    const crumb = page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Purchasing assets" });
    await expect(crumb).toHaveAttribute("href", "/inventory");
    await waitForHydration(crumb);
    await crumb.click();
    await expect(page).toHaveURL((u) => u.pathname === "/inventory" && !u.searchParams.has("cls"));
    await expect(page.getByRole("heading", { level: 1, name: "Purchasing assets" })).toBeVisible();
  });

  test("13. a viewer's record: no primary, no Edit, no More actions, the READ-ONLY pill", async ({ page }) => {
    const id = await assetId("BR-LT-0201");
    await login(page, VIEWER);
    await page.goto(`/inventory/${id}`);

    await expect(page.getByRole("heading", { level: 1, name: "BR-LT-0201", exact: true })).toBeVisible();
    await expect(headerActions(page, "BR-LT-0201").getByRole("button")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Edit", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "More actions" })).toHaveCount(0);
    await expect(recordHeader(page, "BR-LT-0201").getByText("READ-ONLY · VIEWER", { exact: true })).toBeVisible();
    await expectNoSeriousAxe(page);
  });
});
