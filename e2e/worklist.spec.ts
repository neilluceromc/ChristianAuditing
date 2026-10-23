import { test, expect, type Locator, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import { login } from "./fixtures/login";

/**
 * Worklist split view (H4), Task 4: the one-screen Worklist in a real browser against real Postgres.
 *
 *   1  one screen: the document never scrolls; a page is as many 52 px rows as fit, 6 to 10 (final review ruling)
 *   2  Keep as spare → the next row and its Keep as spare; the toast's Undo puts the row, its selection and
 *      Cleared today back (the decision's updatedAt survives the Postgres round trip, or the undo is refused)
 *   3  the last row decided: focus lands on the empty state
 *   4  Dispose needs a reason: Confirm is gated, nothing is written until one is given
 *   5  bulk: two rows sent to repair, one Undo takes both back
 *   6  filters, sort (red first on Status), paging, URL sel through a reload, a stale sel
 *   7  1024 px: the drawer — Enter focuses its first action, Escape returns to the row, decide → next inside it,
 *      the last row closes it and an Undo doesn't reopen it
 *   8  375 px: the stacked list, each value read with its column's name
 *   9  a viewer: read-only
 *  10  changed by someone else: a triage in another session, then the stale page's own — refused, the selection
 *      moves on; on the last row focus still lands on the empty state
 *  11  Undo after a later change is refused with the exact copy and changes nothing
 *  12  timing: the largest bulk the page can tick (50, the queue's cap), and its Undo
 *  13  axe: light, dark and 375 px
 *
 * The seed has no Triage row, so the spec registers its own sixty IT spares (BR-WL-0001…0060, "WL Unit 01"…) after
 * the seed and arms the ones a case needs by setting `returnedAt`; every case starts from all sixty disarmed.
 */

const db = new PrismaClient();
const IT = "it@thebackroomop.com";
const ADMIN = "admin@thebackroomop.com";
const VIEWER = "viewer@thebackroomop.com";
const DAY = 86_400_000;

const tagOf = (n: number) => `BR-WL-${String(n).padStart(4, "0")}`;
const modelOf = (n: number) => `WL Unit ${String(n).padStart(2, "0")}`;
/** Twelve rows' waits: four over 90 days, the rest under; two of them monitors (11 and 12). */
const TWELVE = [200, 150, 120, 95, 60, 40, 30, 20, 10, 5, 3, 1];

/** The fixture assets' ids, by number (1-based). */
const ids: string[] = [];
/** The category of fixtures 11 and 12 (BR-MN-0910's: the seed's monitors). */
let monitorName = "";

test.beforeAll(async () => {
  test.setTimeout(180_000);
  execSync("npm run db:seed", { timeout: 120_000 });
  // the seed puts nothing in Triage: every Triage row below is this spec's own
  expect(await db.asset.count({ where: { cls: "IT", returnedAt: { not: null } } })).toBe(0);
  const laptop = await db.assetCategory.findFirstOrThrow({ where: { name: "Laptop" } });
  const mn = await db.asset.findUniqueOrThrow({ where: { tag: "BR-MN-0910" }, select: { categoryId: true, category: { select: { name: true } } } });
  const monitor = mn.categoryId;
  monitorName = mn.category.name;
  await db.asset.createMany({
    data: Array.from({ length: 60 }, (_, i) => ({
      tag: tagOf(i + 1), model: modelOf(i + 1), categoryId: i === 10 || i === 11 ? monitor : laptop.id,
      cls: "IT" as const, status: "SPARE" as const, itVerifiedAt: new Date(),
    })),
  });
  const rows = await db.asset.findMany({ where: { tag: { startsWith: "BR-WL-" } }, orderBy: { tag: "asc" }, select: { id: true } });
  ids.push(...rows.map((r) => r.id));
});
test.afterAll(async () => {
  await db.$disconnect();
});

test.beforeEach(async () => {
  await disarm();
});

/** Every fixture back to an idle spare, nothing waiting. Audit rows stay (append-only). */
async function disarm() {
  await db.asset.updateMany({
    where: { tag: { startsWith: "BR-WL-" } },
    data: { status: "SPARE", returnedAt: null, defectiveSince: null, repairEndedAt: null, notes: null, warrantyUntil: null, assigneeId: null },
  });
}

/** Fixtures 1…n back for triage, `days[i]` days ago (default 200, 199, …). */
async function arm(n: number, days: readonly number[] = Array.from({ length: n }, (_, i) => 200 - i)) {
  const now = Date.now();
  await db.$transaction(
    Array.from({ length: n }, (_, i) => db.asset.update({ where: { id: ids[i] }, data: { returnedAt: new Date(now - days[i] * DAY) } })),
  );
}

async function waitForHydration(target: Locator) {
  const el = target.first();
  await el.waitFor({ state: "attached", timeout: 30_000 });
  await expect(async () => {
    expect(await el.evaluate((node) => Object.keys(node).some((k) => k.startsWith("__reactFiber$")))).toBe(true);
  }).toPass({ timeout: 30_000 });
}

const table = (page: Page, queue = "Triage") => page.getByRole("table", { name: queue, exact: true });
const rowOf = (page: Page, n: number) => page.locator(`tr[data-row-key="triage:${ids[n - 1]}"]`);
const bodyRows = (page: Page, queue = "Triage") => table(page, queue).locator("tbody tr[data-row-key]");
const panel = (page: Page) => page.locator("aside[data-worklist-panel]");
const drawer = (page: Page) => page.getByRole("dialog", { name: "Triage", exact: true });
const pager = (page: Page) => page.getByRole("navigation", { name: "Pages" });
const toast = (page: Page, text: string | RegExp) => page.locator("[data-toast-id]").filter({ hasText: text });
const empty = (page: Page) => page.locator("[data-worklist-empty]");
/** Rows per page as the page measured them (6–10; ten before the measurement and below 640 px). */
async function perPageOf(page: Page): Promise<number> {
  return Number(await page.locator("section[data-per-page]").getAttribute("data-per-page"));
}
/** The URL's ?page (null when it is page 1, which the URL leaves out). */
const urlPage = (page: Page) => new URL(page.url()).searchParams.get("page");

/** "Cleared today {n}" in the page header. */
async function cleared(page: Page): Promise<number> {
  const text = await page.locator("span").filter({ hasText: /^Cleared today\s*\d+$/ }).innerText();
  return Number(/(\d+)/.exec(text)![1]);
}

async function open(page: Page, query = "q=triage", queue = "Triage") {
  await page.goto(`/inventory/work?${query}`);
  await expect(table(page, queue)).toBeVisible({ timeout: 30_000 });
  await waitForHydration(table(page, queue));
}

async function axeProblems(page: Page, label: string): Promise<string[]> {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(700);
  const results = await new AxeBuilder({ page }).analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${label}: ${v.id} (${v.impact}) ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

test.describe("worklist — one screen", () => {
  /** How far the document, main and the table's own box scroll (0 = they don't). */
  async function overflow(page: Page) {
    return page.evaluate(() => {
      const doc = document.scrollingElement ?? document.documentElement;
      const main = document.querySelector("main");
      const box = document.querySelector('table[aria-label="Triage"]')!.parentElement!;
      return {
        doc: doc.scrollHeight - doc.clientHeight,
        main: main ? main.scrollHeight - main.clientHeight : 0,
        table: box.scrollHeight - box.clientHeight,
      };
    });
  }

  test("1. the document never scrolls; at 1440×900 the page shows as many rows as fit and the table doesn't scroll", async ({ page }) => {
    test.setTimeout(120_000);
    await arm(12, TWELVE);
    await login(page, IT);
    // Cris shows in the corner (the default), so #main carries Cris's 88 px clearance: the screen must allow for it
    await page.goto("/");
    await expect(page.locator("[data-cris-dock]")).toHaveCount(1, { timeout: 20_000 });
    for (const [width, height] of [[1440, 900], [1280, 720]] as const) {
      await page.setViewportSize({ width, height });
      await open(page);
      const per = await perPageOf(page);
      expect(per).toBeGreaterThanOrEqual(6);
      expect(per).toBeLessThanOrEqual(10);
      await expect(bodyRows(page)).toHaveCount(per);
      await expect(pager(page)).toContainText(`1–${per} of 12`);
      const fit = await overflow(page);
      console.log(`[worklist rows per page] ${width}×${height}, Cris docked: ${per}; the table scrolls ${fit.table} px inside`);
      expect(fit.doc, `document scrolls at ${width}×${height}`).toBeLessThanOrEqual(1);
      expect(fit.main, `main scrolls at ${width}×${height}`).toBeLessThanOrEqual(1);
      if (width === 1440) {
        expect(fit.table, "the table scrolls inside at 1440×900: the rows shown don't fit").toBeLessThanOrEqual(1);
        const last = await bodyRows(page).nth(per - 1).boundingBox();
        expect(last!.y + last!.height).toBeLessThanOrEqual(height);
      }
    }
  });

  test("1b. at 1280×720 the page shows the rows that fit and the table doesn't scroll; ?page=2&sel= keeps the row", async ({ page }) => {
    // At 1280×720 with Cris docked the table's box holds four 52 px rows, below the ruled minimum of six, so the six
    // shown scroll inside (case 1 records it). With Cris tucked away the box holds six: that is the case pinned here.
    test.setTimeout(120_000);
    await arm(12, TWELVE);
    await login(page, IT);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");
    await expect(page.locator("[data-cris-dock]")).toHaveCount(1, { timeout: 20_000 });
    await page.locator('button[aria-label="Tuck Cris away"]').dispatchEvent("click");
    await expect(page.locator("[data-cris-dock]")).toHaveCount(0);
    try {
      await open(page);
      const per = await perPageOf(page);
      expect(per).toBe(6);
      await expect(bodyRows(page)).toHaveCount(6);
      await expect(pager(page)).toContainText("1–6 of 12");
      const fit = await overflow(page);
      expect(fit.doc).toBeLessThanOrEqual(1);
      expect(fit.table, "the table scrolls inside at 1280×720").toBeLessThanOrEqual(1);
      const last = await bodyRows(page).nth(5).boundingBox();
      expect(last!.y + last!.height).toBeLessThanOrEqual(720);

      // a ?page= written under ten rows a page: the URL's sel wins, and its page is the one six rows a page put it on
      await open(page, `q=triage&page=2&sel=triage:${ids[11]}`);
      await expect(rowOf(page, 12)).toHaveAttribute("aria-selected", "true");
      await expect(pager(page)).toContainText("7–12 of 12");
      await expect.poll(() => urlPage(page)).toBe("2");
      await expect(page).toHaveURL(new RegExp(`sel=triage(%3A|:)${ids[11]}`));
      await open(page, `q=triage&page=2&sel=triage:${ids[4]}`);
      await expect(rowOf(page, 5)).toHaveAttribute("aria-selected", "true");
      await expect(pager(page)).toContainText("1–6 of 12");
      await expect.poll(() => urlPage(page)).toBeNull();
    } finally {
      await page.getByRole("button", { name: /^Bring Cris back/ }).click();
      await expect(page.locator("[data-cris-dock]")).toHaveCount(1);
    }
  });
});

test.describe("worklist — triage", () => {
  test("2. Keep as spare selects the next row and focuses its Keep as spare; Undo restores the row, its selection and Cleared today", async ({ page }) => {
    test.setTimeout(120_000);
    const started = new Date();
    await arm(3);
    await login(page, IT);
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, `q=triage&sel=triage:${ids[0]}`);
    await expect(rowOf(page, 1)).toHaveAttribute("aria-selected", "true");
    await expect(panel(page).getByRole("heading", { name: modelOf(1) })).toBeVisible();
    const before = await cleared(page);

    await panel(page).getByRole("button", { name: "Keep as spare", exact: true }).click();
    await expect(toast(page, `${modelOf(1)} · kept as a spare`)).toBeVisible({ timeout: 20_000 });
    await expect(rowOf(page, 1)).toHaveCount(0);
    await expect(rowOf(page, 2)).toHaveAttribute("aria-selected", "true");
    await expect(panel(page).getByRole("heading", { name: modelOf(2) })).toBeVisible();
    await expect(panel(page).getByRole("button", { name: "Keep as spare", exact: true })).toBeFocused();
    await expect.poll(() => cleared(page), { timeout: 15_000 }).toBe(before + 1);
    expect((await db.asset.findUniqueOrThrow({ where: { id: ids[0] } })).returnedAt).toBeNull();

    await toast(page, `${modelOf(1)} · kept as a spare`).getByRole("button", { name: "Undo", exact: true }).click();
    await expect(toast(page, `${modelOf(1)} · back in Triage`)).toBeVisible({ timeout: 20_000 });
    await expect(rowOf(page, 1)).toHaveAttribute("aria-selected", "true", { timeout: 15_000 });
    await expect(panel(page).getByRole("heading", { name: modelOf(1) })).toBeVisible();
    await expect.poll(() => cleared(page), { timeout: 15_000 }).toBe(before);
    const back = await db.asset.findUniqueOrThrow({ where: { id: ids[0] } });
    expect(back.returnedAt).not.toBeNull();
    expect(back.status).toBe("SPARE");
    const undone = await db.auditEntry.findFirst({ where: { entityId: ids[0], action: "lifecycle.triage.undone", createdAt: { gte: started } } });
    expect(undone).not.toBeNull();
  });

  test("3. deciding the last row leaves focus on the empty state", async ({ page }) => {
    test.setTimeout(90_000);
    await arm(1);
    await login(page, IT);
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page);
    await panel(page).getByRole("button", { name: "Send to repair", exact: true }).click();
    await expect(toast(page, `${modelOf(1)} · sent to repair`)).toBeVisible({ timeout: 20_000 });
    await expect(empty(page)).toBeFocused();
    await expect(empty(page)).toContainText("All clear");
    await expect(empty(page)).toContainText("Nothing left in Triage.");
    expect((await db.asset.findUniqueOrThrow({ where: { id: ids[0] } })).status).toBe("DEFECTIVE");
  });

  test("4. Dispose needs a reason: Confirm refuses an empty one and writes nothing", async ({ page }) => {
    test.setTimeout(90_000);
    await arm(2);
    await login(page, IT);
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page);
    await panel(page).getByRole("button", { name: "Dispose", exact: true }).click();
    const reason = panel(page).getByRole("textbox", { name: /Reason/ });
    await expect(reason).toBeFocused();
    // the four buttons gave way to the reason with Confirm and Cancel
    await expect(panel(page).getByRole("button", { name: "Keep as spare", exact: true })).toHaveCount(0);
    await panel(page).getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(panel(page).getByText("Give a reason (at least 2 characters)")).toBeVisible();
    await expect(reason).toHaveAttribute("aria-invalid", "true");
    await expect(reason).toBeFocused();
    await page.waitForTimeout(500);
    const still = await db.asset.findUniqueOrThrow({ where: { id: ids[0] } });
    expect(still.status).toBe("SPARE");
    expect(still.returnedAt).not.toBeNull();

    await reason.fill("Beyond repair");
    await panel(page).getByRole("button", { name: "Confirm", exact: true }).click();
    const done = toast(page, `${modelOf(1)} · marked for disposal`);
    await expect(done).toBeVisible({ timeout: 20_000 });
    // Dispose can't be undone: no Undo on its toast
    await expect(done.getByRole("button", { name: "Undo" })).toHaveCount(0);
    await expect(rowOf(page, 1)).toHaveCount(0);
    await expect(rowOf(page, 2)).toHaveAttribute("aria-selected", "true");
    expect((await db.asset.findUniqueOrThrow({ where: { id: ids[0] } })).status).toBe("DISPOSE");
  });

  test("5. bulk: two rows sent to repair at once, and one Undo takes both back", async ({ page }) => {
    test.setTimeout(120_000);
    await arm(4);
    await login(page, IT);
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page);
    await page.getByRole("checkbox", { name: `Select ${tagOf(1)}`, exact: true }).check();
    await page.getByRole("checkbox", { name: `Select ${tagOf(3)}`, exact: true }).check();
    const bar = page.getByRole("region", { name: "Bulk actions" });
    await expect(bar).toContainText("2 selected");
    await bar.getByRole("button", { name: "Send to repair", exact: true }).click();
    const done = toast(page, "2 items · sent to repair");
    await expect(done).toBeVisible({ timeout: 30_000 });
    await expect(rowOf(page, 1)).toHaveCount(0);
    await expect(rowOf(page, 3)).toHaveCount(0);
    await expect(bodyRows(page)).toHaveCount(2);
    await expect(bar).toHaveCount(0);
    for (const i of [0, 2]) expect((await db.asset.findUniqueOrThrow({ where: { id: ids[i] } })).status).toBe("DEFECTIVE");

    await done.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(toast(page, "2 items · back in Triage")).toBeVisible({ timeout: 30_000 });
    await expect(bodyRows(page)).toHaveCount(4, { timeout: 15_000 });
    for (const i of [0, 2]) {
      const a = await db.asset.findUniqueOrThrow({ where: { id: ids[i] } });
      expect(a.status).toBe("SPARE");
      expect(a.returnedAt).not.toBeNull();
    }
  });
});

test.describe("worklist — filters, sort and paging", () => {
  test("6. filters, sort, paging; red rows first on Status; URL sel survives a reload; a stale sel falls back to the first row", async ({ page }) => {
    test.setTimeout(150_000);
    await arm(12, TWELVE);
    await login(page, IT);
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page);
    await expect(page.getByRole("navigation", { name: "Queues" }).getByRole("link", { name: /^Triage/ })).toHaveAttribute("aria-current", "page");

    // paging: as many rows a page as fit (6–10), so twelve rows make two pages
    const P = await perPageOf(page);
    expect(P).toBeGreaterThanOrEqual(6);
    expect(P).toBeLessThanOrEqual(10);
    const pageOne = `1–${P} of 12`;
    const pageTwo = `${P + 1}–12 of 12`;
    await expect(pager(page)).toContainText(pageOne);
    await expect(bodyRows(page)).toHaveCount(P);
    await expect(bodyRows(page).first()).toHaveAttribute("data-row-key", `triage:${ids[0]}`);
    await pager(page).getByRole("button", { name: "Next →" }).click();
    await expect(pager(page)).toContainText(pageTwo);
    await expect(bodyRows(page)).toHaveCount(12 - P);
    await expect(pager(page).getByRole("button", { name: "Next →" })).toBeDisabled();
    // a page change selects that page's first row
    await expect(rowOf(page, P + 1)).toHaveAttribute("aria-selected", "true");
    await pager(page).getByRole("button", { name: "← Previous" }).click();
    await expect(pager(page)).toContainText(pageOne);

    // filters: Over 90 days, a category chip, the search box; each narrows the rows
    await page.getByRole("checkbox", { name: "Over 90 days" }).check();
    await expect(pager(page)).toContainText("1–4 of 4");
    await page.getByRole("checkbox", { name: "Over 90 days" }).uncheck();
    await expect(pager(page)).toContainText(pageOne);
    const monitorChip = page.getByRole("group", { name: "Category" }).getByRole("button", { name: new RegExp(`^${monitorName} `) });
    await expect(monitorChip).toHaveText(/2/);
    await monitorChip.click();
    await expect(monitorChip).toHaveAttribute("aria-pressed", "true");
    await expect(pager(page)).toContainText("1–2 of 2");
    await expect(rowOf(page, 11)).toBeVisible();
    await page.getByRole("group", { name: "Category" }).getByRole("button", { name: /^All\b/ }).click();
    const search = page.getByRole("searchbox", { name: "Search Triage" });
    await search.fill(tagOf(7));
    await expect(bodyRows(page)).toHaveCount(1);
    await expect(rowOf(page, 7)).toBeVisible();
    await search.fill("nothing like this");
    await expect(table(page)).toContainText("Nothing matches these filters.");
    await table(page).getByRole("button", { name: "Clear filters" }).click();
    await expect(pager(page)).toContainText(pageOne);

    // sort: Waiting opens descending (oldest first); one click turns it
    const waiting = table(page).getByRole("columnheader", { name: /Waiting/ });
    await expect(waiting).toHaveAttribute("aria-sort", "descending");
    await expect(rowOf(page, 1)).toHaveAttribute("aria-selected", "true");
    await waiting.getByRole("button").click();
    await expect(waiting).toHaveAttribute("aria-sort", "ascending");
    // the selected row (200 days) keeps its selection and the page follows it: now the last row of the last page
    await expect(rowOf(page, 1)).toHaveAttribute("aria-selected", "true");
    await expect(pager(page)).toContainText(pageTwo);
    await expect(bodyRows(page).last()).toHaveAttribute("data-row-key", `triage:${ids[0]}`);
    await pager(page).getByRole("button", { name: "← Previous" }).click();
    await expect(bodyRows(page).first()).toHaveAttribute("data-row-key", `triage:${ids[11]}`);
    // page 1's first row (1 day) is selected now; turning the sort back takes it, and its page, to the end
    await expect(rowOf(page, 12)).toHaveAttribute("aria-selected", "true");
    await waiting.getByRole("button").click();
    await expect(waiting).toHaveAttribute("aria-sort", "descending");
    await expect(pager(page)).toContainText(pageTwo);
    await expect(bodyRows(page).first()).toHaveAttribute("data-row-key", `triage:${ids[P]}`);

    // URL sel: a row on page 2, selected, survives a reload with its page
    await rowOf(page, 12).click();
    await expect(rowOf(page, 12)).toHaveAttribute("aria-selected", "true");
    await expect(page).toHaveURL(new RegExp(`sel=triage(%3A|:)${ids[11]}`));
    await page.reload();
    await waitForHydration(table(page));
    await expect(rowOf(page, 12)).toHaveAttribute("aria-selected", "true");
    await expect(pager(page)).toContainText(pageTwo);
    await expect(panel(page).getByRole("heading", { name: modelOf(12) })).toBeVisible();

    // a stale sel (decided elsewhere, or a typo) falls back to the first row, and the URL follows
    await open(page, "q=triage&sel=triage:not-a-row");
    await expect(rowOf(page, 1)).toHaveAttribute("aria-selected", "true");
    await expect(panel(page).getByRole("heading", { name: modelOf(1) })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`sel=triage(%3A|:)${ids[0]}`));

    // a ?page= written under another rows-per-page: the URL's sel wins and the page index is recomputed (row 7 is on
    // page 1 at seven or more rows a page, on page 2 at six)
    await open(page, `q=triage&page=2&sel=triage:${ids[6]}`);
    await expect(rowOf(page, 7)).toHaveAttribute("aria-selected", "true");
    await expect(pager(page)).toContainText(P >= 7 ? pageOne : pageTwo);
    await expect.poll(() => urlPage(page)).toBe(P >= 7 ? null : "2");

    // red first: the first click on Loans' Status puts the late loan on top
    const late = await db.asset.findUniqueOrThrow({ where: { tag: "BR-PH-0287" } });
    await db.asset.update({ where: { id: late.id }, data: { loanDueAt: new Date(Date.now() - 2 * DAY) } });
    try {
      await open(page, "q=loans", "Loans");
      const status = table(page, "Loans").getByRole("columnheader", { name: /Status/ });
      await status.getByRole("button").click();
      await expect(status).toHaveAttribute("aria-sort", "ascending");
      const first = bodyRows(page, "Loans").first();
      await expect(first).toHaveAttribute("data-row-key", `loans:${late.id}`);
      await expect(first).toContainText("days late");
    } finally {
      await db.asset.update({ where: { id: late.id }, data: { loanDueAt: late.loanDueAt } });
    }
  });
});

test.describe("worklist — narrow windows and a viewer", () => {
  test("7. at 1024 px the panel is a drawer: Enter focuses its first action, Escape returns to the row; the last row closes it for good", async ({ page }) => {
    test.setTimeout(120_000);
    await arm(2);
    await login(page, IT);
    await page.setViewportSize({ width: 1024, height: 768 });
    await open(page);
    await expect(panel(page)).toHaveCount(0);
    await expect(drawer(page)).toHaveCount(0);

    // keyboard: Enter on the row opens the drawer on its first action; Escape closes it, back on the row
    await rowOf(page, 1).focus();
    await page.keyboard.press("Enter");
    await expect(drawer(page)).toBeVisible();
    const keep = drawer(page).getByRole("button", { name: "Keep as spare", exact: true });
    await expect(keep).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(drawer(page)).toHaveCount(0);
    await expect(rowOf(page, 1)).toBeFocused();

    // decide → next inside the drawer
    await page.keyboard.press("Enter");
    await expect(keep).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(toast(page, `${modelOf(1)} · kept as a spare`)).toBeVisible({ timeout: 20_000 });
    await expect(drawer(page).getByRole("heading", { name: modelOf(2) })).toBeVisible();
    await expect(keep).toBeFocused();

    // the last row: the drawer closes and focus lands on the empty state
    await page.keyboard.press("Enter");
    await expect(toast(page, `${modelOf(2)} · kept as a spare`)).toBeVisible({ timeout: 20_000 });
    await expect(drawer(page)).toHaveCount(0);
    await expect(empty(page)).toBeFocused();

    // an Undo brings the row back without reopening the drawer unasked
    await toast(page, `${modelOf(2)} · kept as a spare`).getByRole("button", { name: "Undo", exact: true }).click();
    await expect(toast(page, `${modelOf(2)} · back in Triage`)).toBeVisible({ timeout: 20_000 });
    await expect(rowOf(page, 2)).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(500);
    await expect(drawer(page)).toHaveCount(0);

    // a click on a row opens it
    await rowOf(page, 2).click();
    await expect(drawer(page)).toBeVisible();
    await expect(drawer(page).getByRole("heading", { name: modelOf(2) })).toBeVisible();
  });

  test("8. at 375 px the rows stack, each value read with its column's name, and the page doesn't scroll sideways", async ({ page }) => {
    test.setTimeout(90_000);
    await arm(3);
    await login(page, IT);
    await page.setViewportSize({ width: 375, height: 812 });
    await open(page);
    // the head is hidden; the names travel with the values
    await expect(table(page).getByRole("columnheader").first()).toBeHidden();
    const row = rowOf(page, 1);
    await expect(row).toBeVisible();
    expect(await row.evaluate((el) => getComputedStyle(el).display)).toBe("flex");
    // "Waiting: 200 days" — the label and its value never run together ("Waiting200 days")
    await expect(page.getByRole("row", { name: /Waiting\s?:\s?200 days/ })).toHaveCount(1);
    await expect(row).toContainText("Waiting");
    // no ticks on a phone; a tap opens the drawer
    await expect(page.getByRole("checkbox", { name: `Select ${tagOf(1)}` })).toBeHidden();
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(sideways).toBeLessThanOrEqual(1);
    await row.click();
    await expect(drawer(page)).toBeVisible();
    await expect(drawer(page).getByRole("button", { name: "Keep as spare", exact: true })).toBeVisible();
  });

  test("9. a viewer sees the queue read-only: no ticks, no decisions, no Hide; the facts and the record link stay", async ({ page }) => {
    test.setTimeout(90_000);
    await arm(2);
    await login(page, VIEWER);
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page);
    await expect(bodyRows(page)).toHaveCount(2);
    await expect(page.getByRole("checkbox", { name: /^Select / })).toHaveCount(0);
    for (const name of ["Keep as spare", "Send to repair", "Dispose", "Donate", "Hide until tomorrow", "Mark checked"]) {
      await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
    }
    await expect(panel(page).getByRole("heading", { name: modelOf(1) })).toBeVisible();
    await expect(panel(page).getByRole("link", { name: "Open the full record →" })).toHaveAttribute("href", `/inventory/${ids[0]}`);
  });
});

test.describe("worklist — someone else got there first", () => {
  test("10. a triage in another session: the stale page's decision is refused and the selection moves on", async ({ page, browser }) => {
    test.setTimeout(180_000);
    const started = new Date();
    await arm(3);
    await login(page, IT);
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page);
    await expect(rowOf(page, 1)).toHaveAttribute("aria-selected", "true");

    // an admin, in their own session, keeps the same asset as a spare
    const other = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const p2 = await other.newPage();
      await login(p2, ADMIN);
      await open(p2, `q=triage&sel=triage:${ids[0]}`);
      await panel(p2).getByRole("button", { name: "Keep as spare", exact: true }).click();
      await expect(toast(p2, `${modelOf(1)} · kept as a spare`)).toBeVisible({ timeout: 20_000 });
    } finally {
      await other.close();
    }
    expect((await db.asset.findUniqueOrThrow({ where: { id: ids[0] } })).returnedAt).toBeNull();

    // the stale page still shows it; acting on it is refused, and the selection moves on
    await expect(rowOf(page, 1)).toBeVisible();
    await panel(page).getByRole("button", { name: "Keep as spare", exact: true }).click();
    const refused = toast(page, "Changed by someone else since — try again");
    await expect(refused).toBeVisible({ timeout: 20_000 });
    await expect(refused).toContainText(`${tagOf(1)} is not waiting for triage.`);
    await expect(refused).toHaveAttribute("role", "alert");
    await expect(rowOf(page, 2)).toHaveAttribute("aria-selected", "true");
    await expect(rowOf(page, 1)).toHaveCount(0, { timeout: 15_000 });
    await expect(panel(page).getByRole("button", { name: "Keep as spare", exact: true })).toBeFocused();
    // final review I1: once the refresh has dropped the refused row, ↑/↓ keep focus in the table (nothing stays armed)
    await rowOf(page, 2).click();
    await expect(rowOf(page, 2)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rowOf(page, 3)).toHaveAttribute("aria-selected", "true");
    await expect(rowOf(page, 3)).toBeFocused();
    await page.waitForTimeout(800);
    await expect(rowOf(page, 3)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rowOf(page, 2)).toBeFocused();
    await page.waitForTimeout(800);
    await expect(rowOf(page, 2)).toBeFocused();
    // nothing more was written: one triage audit entry on it, the admin's
    expect(await db.auditEntry.count({ where: { entityId: ids[0], action: "lifecycle.triage", createdAt: { gte: started } } })).toBe(1);

    // the last row, decided elsewhere: the refusal's refresh drops it and focus still lands on the empty state
    await disarm();
    await arm(1);
    await open(page);
    await expect(bodyRows(page)).toHaveCount(1);
    await db.asset.update({ where: { id: ids[0] }, data: { returnedAt: null } });
    await panel(page).getByRole("button", { name: "Keep as spare", exact: true }).click();
    await expect(toast(page, "Changed by someone else since — try again").last()).toBeVisible({ timeout: 20_000 });
    await expect(rowOf(page, 1)).toHaveCount(0, { timeout: 15_000 });
    await expect(empty(page)).toBeFocused();
  });

  test("11. Undo after a later change is refused with the exact copy and changes nothing", async ({ page }) => {
    test.setTimeout(120_000);
    const started = new Date();
    await arm(2);
    await login(page, IT);
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page);
    await panel(page).getByRole("button", { name: "Keep as spare", exact: true }).click();
    const done = toast(page, `${modelOf(1)} · kept as a spare`);
    await expect(done).toBeVisible({ timeout: 20_000 });
    // a later change to the asset (its updatedAt moves on)
    const warranty = new Date(Date.now() + 365 * DAY);
    await db.asset.update({ where: { id: ids[0] }, data: { warrantyUntil: warranty } });
    const before = await db.asset.findUniqueOrThrow({ where: { id: ids[0] } });

    await done.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(toast(page, "Changed by someone else since — open the record")).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(500);
    const after = await db.asset.findUniqueOrThrow({ where: { id: ids[0] } });
    expect(after.returnedAt).toBeNull();
    expect(after.status).toBe("SPARE");
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    expect(await db.auditEntry.count({ where: { entityId: ids[0], action: "lifecycle.triage.undone", createdAt: { gte: started } } })).toBe(0);
    await expect(rowOf(page, 1)).toHaveCount(0);
  });
});

test.describe("worklist — scale", () => {
  test("12. timing: the largest bulk the page can tick (the queue's 50) and its Undo", async ({ page }) => {
    test.setTimeout(300_000);
    await arm(50);
    await login(page, IT);
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page);
    await expect(page.getByRole("navigation", { name: "Queues" }).getByRole("link", { name: /^Triage/ })).toContainText("50+");
    const per = await perPageOf(page);
    const pages = Math.ceil(50 / per);
    for (let p = 1; p <= pages; p++) {
      await page.getByRole("checkbox", { name: "Select all on this page" }).check();
      if (p < pages) await pager(page).getByRole("button", { name: "Next →" }).click();
    }
    // the last page carries the cap note and See all (the bar replaces the filters, not the pager)
    await expect(pager(page)).toContainText(`${(pages - 1) * per + 1}–50 of 50`);
    await expect(pager(page).getByRole("link", { name: "See all →" })).toHaveAttribute("href", "/inventory?sort=attention");
    await expect(pager(page)).toContainText("Showing the first 50 — clear some to see more");
    const bar = page.getByRole("region", { name: "Bulk actions" });
    await expect(bar).toContainText("50 selected");

    const t0 = Date.now();
    await bar.getByRole("button", { name: "Keep as spares", exact: true }).click();
    const done = toast(page, "50 items · kept as spares");
    await expect(done).toBeVisible({ timeout: 240_000 });
    const decide = Date.now() - t0;
    expect(await db.asset.count({ where: { tag: { startsWith: "BR-WL-" }, returnedAt: { not: null } } })).toBe(0);

    const t1 = Date.now();
    await done.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(toast(page, "50 items · back in Triage")).toBeVisible({ timeout: 240_000 });
    const undo = Date.now() - t1;
    expect(await db.asset.count({ where: { tag: { startsWith: "BR-WL-" }, returnedAt: { not: null } } })).toBe(50);
    console.log(`[worklist timing] 50-item Keep as spares: ${decide} ms; its Undo: ${undo} ms`);
    test.info().annotations.push({ type: "timing", description: `bulk 50: ${decide} ms; undo 50: ${undo} ms` });
  });
});

test.describe("worklist — axe", () => {
  test("13. axe: light, dark and 375 px, with a row selected and the drawer open on a phone", async ({ page }) => {
    test.setTimeout(180_000);
    await arm(12, TWELVE);
    await login(page, IT);
    const problems: string[] = [];
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const theme of ["light", "dark"] as const) {
      await page.context().addCookies([{ name: "br.theme", value: theme, url: new URL(page.url()).origin }]);
      await open(page);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      problems.push(...(await axeProblems(page, `Triage (${theme})`)));
      await open(page, "q=queue", "Approvals & leavers");
      problems.push(...(await axeProblems(page, `Approvals & leavers (${theme})`)));
      // ticked rows: the bulk bar
      await open(page);
      await page.getByRole("checkbox", { name: `Select ${tagOf(1)}`, exact: true }).check();
      await expect(page.getByRole("region", { name: "Bulk actions" })).toBeVisible();
      problems.push(...(await axeProblems(page, `bulk bar (${theme})`)));
    }
    await page.context().addCookies([{ name: "br.theme", value: "light", url: new URL(page.url()).origin }]);
    await page.setViewportSize({ width: 375, height: 812 });
    await open(page);
    problems.push(...(await axeProblems(page, "Triage at 375 px")));
    await rowOf(page, 1).click();
    await expect(drawer(page)).toBeVisible();
    problems.push(...(await axeProblems(page, "drawer at 375 px")));
    expect(problems).toEqual([]);
  });
});
