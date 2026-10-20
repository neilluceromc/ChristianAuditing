import { test, expect, type Locator, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import { readSheet } from "read-excel-file/node";
import { SEED_PASSWORD } from "../prisma/fixtures";
import { BULK_MAX } from "@/lib/inventory-list";
import { INVENTORY_COLUMNS_SEEN_KEY } from "@/lib/column-prefs";

/**
 * Phase 45 — the Inventory and Employees lists redesign (spec §2–§4), end to end:
 *   tiles      the count tiles filter and count (In stock, Need attention with a search), one pressed at a time
 *   tabs       the Employees tabs filter and count (Missing kit = gaps=1); an old URL selects no tab
 *   per        Rows per page: 50 and 100 on both lists (also under the attention sort and gaps=1), a bad
 *              value reads as 25, and a change lands on page 1
 *   sticky     toolbar, head and footer stay in view after a scroll; focusing a stuck bar's control does not
 *              scroll the window, and a focused row clears the pinned head; at 1280×800 the default inventory
 *              table fits its card, and the wide views (Repairs, Registration) scroll inside the card, their head
 *              at the card's top (not the toolbar's height down inside it) at 1100 and 1440
 *   row size   Dense is 36 px and one line, Compact 48 px, the top-bar button goes Dense → Comfortable
 *   zebra      even body rows are tinted, odd rows are not
 *   columns    Serial number by default; Registration only once chosen in Columns
 *   bulk       Employees selection: Export, Print IT forms, Transfer… (all or nothing), the offboarded row
 *   forms      /employees/forms: order, an unknown id, the cap refusal, the empty state
 *   axe        both lists, light and dark, with and without the bulk bar (its own describe)
 *
 * Fixtures (beforeAll, after a fresh db:seed): 120 spare IT assets BR-PF-0001…0120 (model "P45 List Unit"),
 * 120 ACTIVE Finance people EMP-8001…8120 holding nothing (so Finance standard leaves each with missing kit),
 * and two ACTIVE HR people, "P45 Mover A" EMP-8201 and "P45 Mover B" EMP-8202, for the bulk cases. The lists
 * therefore run past 100 rows, and gaps=1 past 100 people. Never a raw cuid; the next spec file's reseed
 * removes every fixture. Seed facts used: BR-DK-0071 (WD19S Dock) is deployed to Marites Bautista EMP-0042;
 * Faith Mercado EMP-0093 is the one OFFBOARDED person; the seed has DEFECTIVE assets (the Repairs view).
 */

const db = new PrismaClient();

const IT = "it@thebackroomop.com";
const FIXTURE_ASSETS = 120;
const FIXTURE_PEOPLE = 120;
const MOVER_A = { employeeNo: "EMP-8201", name: "P45 Mover A" };
const MOVER_B = { employeeNo: "EMP-8202", name: "P45 Mover B" };

test.beforeAll(async () => {
  test.setTimeout(180_000);
  execSync("npm run db:seed", { timeout: 120_000 });
  const laptop = await db.assetCategory.findFirstOrThrow({ where: { name: "Laptop", cls: "IT" } });
  const now = new Date();
  await db.asset.createMany({
    data: Array.from({ length: FIXTURE_ASSETS }, (_, i) => ({
      tag: `BR-PF-${String(i + 1).padStart(4, "0")}`,
      model: "P45 List Unit",
      categoryId: laptop.id,
      cls: "IT" as const,
      status: "SPARE" as const,
      itVerifiedAt: now,
    })),
  });
  const finance = await db.department.findUniqueOrThrow({ where: { name: "Finance" } });
  const hr = await db.department.findUniqueOrThrow({ where: { name: "HR" } });
  const longAgo = new Date(now.getTime() - 400 * 86_400_000);
  await db.employee.createMany({
    data: [
      ...Array.from({ length: FIXTURE_PEOPLE }, (_, i) => ({
        employeeNo: `EMP-${8001 + i}`,
        name: `P45 Finance ${String(i + 1).padStart(3, "0")}`,
        title: "Finance Analyst",
        departmentId: finance.id,
        employment: "ACTIVE" as const,
        joinedAt: longAgo,
      })),
      ...[MOVER_A, MOVER_B].map((m) => ({
        ...m, title: "HR Associate", departmentId: hr.id, employment: "ACTIVE" as const, joinedAt: longAgo,
      })),
    ],
  });
});
test.afterAll(async () => {
  await db.$disconnect();
});

// Copied from e2e/inventory-ux.spec.ts — house rule: never import helpers across spec files.
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

// Copied from e2e/inventory-ux.spec.ts.
async function expectNoSeriousAxe(page: Page) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(700);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
}

// Copied from e2e/inventory-ux.spec.ts.
async function waitForHydration(target: Locator) {
  const el = target.first();
  await el.waitFor({ state: "attached", timeout: 20_000 });
  await expect(async () => {
    expect(await el.evaluate((node) => Object.keys(node).some((k) => k.startsWith("__reactFiber$")))).toBe(
      true,
    );
  }).toPass({ timeout: 20_000 });
}

/** A list row's cell under the named column header (as e2e/inventory-ux.spec.ts's cellOf: never a fixed index). */
async function cellOf(page: Page, row: Locator, header: string): Promise<Locator> {
  const idx = await page
    .locator("thead th")
    .evaluateAll((ths, h) => ths.findIndex((th) => (th.textContent ?? "").trim().startsWith(h)), header);
  expect(idx, `a "${header}" column`).toBeGreaterThanOrEqual(0);
  return row.locator("td").nth(idx);
}

/** Every body cell's text under the named column header, top to bottom. */
async function columnTexts(page: Page, header: string): Promise<string[]> {
  await expect(page.locator("tbody tr").first()).toBeVisible();
  const idx = await page
    .locator("thead th")
    .evaluateAll((ths, h) => ths.findIndex((th) => (th.textContent ?? "").trim().startsWith(h)), header);
  expect(idx, `a "${header}" column`).toBeGreaterThanOrEqual(0);
  return page.locator(`tbody tr td:nth-child(${idx + 1})`).allTextContents();
}

const fmt = (n: number) => n.toLocaleString("en-US");
const num = (s: string) => Number(s.replace(/,/g, "").trim());

/** The inventory toolbar's count line: "N assets · N need(s) attention". */
const assetCountLine = (page: Page) => page.locator('p[aria-live="polite"]').filter({ hasText: /\d[\d,]* assets?\b/ });
/** The employees toolbar's count line: "N people · N leaver(s) hidden". */
const peopleCountLine = (page: Page) => page.locator('p[aria-live="polite"]').filter({ hasText: /\d[\d,]* (people|person)\b/ });

/** The sticky footer's "Rows a–b of N" line (an en dash). */
const rowsLine = (page: Page) => page.getByText(/^Rows [\d,]+–[\d,]+ of [\d,]+$/);

/** A count tile's number: the tile's second child span (label, number, caption). */
async function tileCount(tile: Locator): Promise<number> {
  return num(await tile.locator(":scope > span").nth(1).innerText());
}

/** A tab's count badge: the tab's first child span (the label is a text node). */
async function tabCount(tab: Locator): Promise<number> {
  return num(await tab.locator(":scope > span").first().innerText());
}

const tilesNav = (page: Page) => page.getByRole("navigation", { name: "Filter by status" });
const tabsNav = (page: Page) => page.getByRole("navigation", { name: "Filter employees" });
const bulkBar = (page: Page) => page.getByRole("region", { name: "Bulk actions" });

async function moverIds(): Promise<{ a: string; b: string }> {
  const [a, b] = await Promise.all([
    db.employee.findUniqueOrThrow({ where: { employeeNo: MOVER_A.employeeNo } }),
    db.employee.findUniqueOrThrow({ where: { employeeNo: MOVER_B.employeeNo } }),
  ]);
  return { a: a.id, b: b.id };
}

/** Ticks the two movers on /employees?q=P45 Mover and returns the bulk bar. */
async function tickMovers(page: Page): Promise<Locator> {
  await page.goto("/employees?q=P45%20Mover");
  await expect(page.locator("tbody tr")).toHaveCount(2);
  for (const m of [MOVER_A, MOVER_B]) {
    const box = page.getByRole("checkbox", { name: `Select ${m.name}`, exact: true });
    await waitForHydration(box);
    await box.check();
  }
  const bar = bulkBar(page);
  await expect(bar).toBeVisible();
  await expect(bar).toContainText("2 selected");
  return bar;
}

/** The ids in an href's `ids=` param, sorted (the bar lists them in page order). */
function idsOf(href: string | null): string[] {
  return (new URL(href ?? "", "http://x").searchParams.get("ids") ?? "").split(",").filter(Boolean).sort();
}

test.describe("count tiles and tabs", () => {
  test("1. In stock shows only Spare rows, and its count is the list's total; one tile is pressed at a time", async ({ page }) => {
    await login(page, IT);
    await page.goto("/inventory");
    const tiles = tilesNav(page);
    const inStock = tiles.getByRole("link", { name: /^In stock/ });
    await expect(inStock).toBeVisible();
    await expect(tiles.locator('[aria-current="true"]')).toHaveCount(0);
    const n = await tileCount(inStock);
    expect(n, "the seed and the fixtures have spares").toBeGreaterThan(FIXTURE_ASSETS - 1);

    await waitForHydration(inStock);
    await inStock.click();
    await expect(page).toHaveURL(/[?&]status=SPARE(&|$)/);
    await expect(inStock).toHaveAttribute("aria-current", "true");
    await expect(tiles.locator('[aria-current="true"]')).toHaveCount(1);
    await expect(assetCountLine(page)).toHaveText(new RegExp(`^${fmt(n)} assets?( ·|$)`));
    const statuses = await columnTexts(page, "Status");
    expect(statuses.length).toBeGreaterThan(0);
    for (const s of statuses) expect(s.trim()).toMatch(/^Spare/);

    // Pressing it again clears it.
    await inStock.click();
    await expect(page).not.toHaveURL(/status=/);
    await expect(tiles.locator('[aria-current="true"]')).toHaveCount(0);
  });

  test("2. Need attention with a search: the tile's count is the list's total, and every row needs attention", async ({ page }) => {
    await login(page, IT);
    // Not an exact tag (that would open the record): BR-LT-0148 and BR-LT-0181 (queued APR-2041) among others.
    await page.goto("/inventory?q=BR-LT-01");
    const tiles = tilesNav(page);
    const attention = tiles.getByRole("link", { name: /^Need attention/ });
    const n = await tileCount(attention);
    expect(n, "BR-LT-0181's pending approval needs attention").toBeGreaterThan(0);

    await waitForHydration(attention);
    await attention.click();
    await expect(page).toHaveURL((u) => u.searchParams.get("attention") === "1" && u.searchParams.get("q") === "BR-LT-01");
    await expect(attention).toHaveAttribute("aria-current", "true");
    await expect(tiles.getByRole("link", { name: /^In stock/ })).not.toHaveAttribute("aria-current", "true");
    await expect(assetCountLine(page)).toHaveText(new RegExp(`^${fmt(n)} assets? · ${fmt(n)} needs? attention$`));
    // the search survives the tile, and the tile's own count did not move under its own filter
    await expect(page.getByRole("searchbox", { name: "Search assets" })).toHaveValue("BR-LT-01");
    expect(await tileCount(attention)).toBe(n);
  });

  test("3. the Missing kit tab sets gaps=1 and its count is the people count; an old URL selects no tab", async ({ page }) => {
    await login(page, IT);
    await page.goto("/employees");
    const tabs = tabsNav(page);
    await expect(tabs.getByRole("link", { name: /^All/ })).toHaveAttribute("aria-current", "page");
    const kit = tabs.getByRole("link", { name: /^Missing kit/ });
    const n = await tabCount(kit);
    expect(n, "the Finance fixtures hold nothing").toBeGreaterThanOrEqual(FIXTURE_PEOPLE);

    await kit.click();
    await expect(page).toHaveURL(/[?&]gaps=1(&|$)/);
    await expect(kit).toHaveAttribute("aria-current", "page");
    await expect(tabs.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(peopleCountLine(page)).toHaveText(new RegExp(`^${fmt(n)} (people|person)\\b`));
    expect(await tabCount(kit)).toBe(n);

    // Phase 42's sidebar and older links still filter, but no tab is exactly ?employment=OFFBOARDED.
    await page.goto("/employees?employment=OFFBOARDED");
    await expect(page.getByRole("row", { name: /EMP-0093/ })).toBeVisible();
    await expect(tabsNav(page).locator("[aria-current]")).toHaveCount(0);
  });
});

test.describe("rows per page", () => {
  const cases: Array<[string, number]> = [
    ["/inventory?per=50", 50],
    ["/inventory?per=100", 100],
    ["/inventory?sort=attention&per=50", 50],
    ["/inventory?sort=attention&per=100", 100],
    ["/employees?per=50", 50],
    ["/employees?per=100", 100],
    ["/employees?gaps=1&per=50", 50],
    ["/employees?gaps=1&per=100", 100],
    // anything that is not 25, 50 or 100 reads as the default
    ["/inventory?per=7", 25],
    ["/employees?per=7", 25],
  ];

  test("4. per=50 and per=100 show that many rows on both lists, under the attention sort and gaps=1 too; per=7 is 25", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, IT);
    for (const [url, rows] of cases) {
      await page.goto(url);
      await expect(page.locator("tbody tr"), url).toHaveCount(rows, { timeout: 20_000 });
      await expect(rowsLine(page), url).toHaveText(new RegExp(`^Rows 1–${rows} of [\\d,]+$`));
    }
  });

  test("5. choosing 50 in Rows per page from page 2 lands on page 1 with 50 rows", async ({ page }) => {
    await login(page, IT);
    await page.goto("/inventory?page=2");
    await expect(rowsLine(page)).toHaveText(/^Rows 26–50 of [\d,]+$/);
    const select = page.getByLabel("Rows per page");
    await waitForHydration(select);
    await expect(select).toHaveValue("25");
    await select.selectOption("50");
    await expect(page).toHaveURL((u) => u.searchParams.get("per") === "50" && (u.searchParams.get("page") ?? "1") === "1");
    await expect(page.locator("tbody tr")).toHaveCount(50, { timeout: 20_000 });
    await expect(rowsLine(page)).toHaveText(/^Rows 1–50 of [\d,]+$/);
    await expect(page.getByRole("navigation", { name: "Pagination" }).getByRole("link", { name: "1", exact: true }))
      .toHaveAttribute("aria-current", "page");
    await expect(page.getByLabel("Rows per page")).toHaveValue("50");
  });
});

test.describe("sticky toolbar, head and footer", () => {
  test("6. after a 1,400 px scroll the toolbar is stuck at the top, the head right under it, the footer at the bottom", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page, IT);
    for (const url of ["/inventory?per=100", "/employees?per=100"]) {
      await page.goto(url);
      await expect(page.locator("tbody tr")).toHaveCount(100, { timeout: 20_000 });
      const list = page.locator("[data-sticky-list]");
      const toolbar = page.locator("[data-sticky-list] > div").filter({ has: page.getByRole("searchbox") });
      // the toolbar has measured itself into --list-sticky-top (after hydration)
      await expect
        .poll(() => list.evaluate((el) => (el as HTMLElement).style.getPropertyValue("--list-sticky-top")), { timeout: 20_000 })
        .not.toBe("");
      await expect(toolbar).not.toHaveAttribute("data-stuck", /.*/);

      await page.evaluate(() => window.scrollTo(0, 1400));
      await expect(toolbar, url).toHaveAttribute("data-stuck", "true");
      // (within a pixel: the measured toolbar height is rounded into --list-sticky-top)
      await expect(async () => {
        const bar = (await toolbar.boundingBox())!;
        const head = (await page.locator("thead").boundingBox())!;
        expect(bar.y, `${url}: the toolbar's top`).toBeGreaterThanOrEqual(-0.5);
        expect(bar.y, `${url}: the toolbar's top`).toBeLessThanOrEqual(1);
        expect(Math.abs(head.y - (bar.y + bar.height)), `${url}: the head right under the toolbar`).toBeLessThanOrEqual(1);
      }).toPass({ timeout: 10_000 });
      const footer = (await rowsLine(page).locator("..").boundingBox())!;
      expect(Math.abs(footer.y + footer.height - 900), `${url}: footer bottom at the window's bottom`).toBeLessThanOrEqual(1);
      expect(await page.evaluate(() => window.scrollY), url).toBeGreaterThanOrEqual(1400);
    }
  });

  test("6b. tabbing the stuck toolbar or footer never scrolls the window; a focused row lands below the pinned head", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page, IT);
    await page.goto("/inventory?per=100");
    await expect(page.locator("tbody tr")).toHaveCount(100, { timeout: 20_000 });
    const list = page.locator("[data-sticky-list]");
    const toolbar = page.locator("[data-sticky-list] > div").filter({ has: page.getByRole("searchbox") });
    const search = page.getByRole("searchbox", { name: "Search assets" });
    await waitForHydration(search);
    await expect
      .poll(() => list.evaluate((el) => (el as HTMLElement).style.getPropertyValue("--list-sticky-top")), { timeout: 20_000 })
      .not.toBe("");

    await page.evaluate(() => window.scrollTo(0, 2000));
    await expect(toolbar).toHaveAttribute("data-stuck", "true");
    const scrollY = () => page.evaluate(() => window.scrollY);
    const y0 = await scrollY();
    expect(y0).toBeGreaterThanOrEqual(1990);

    // The toolbar: the search box, then two Tabs along its controls. The window stays put.
    await search.focus();
    expect(await scrollY(), "focusing the search box").toBe(y0);
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    expect(await toolbar.evaluate((bar) => bar.contains(document.activeElement)), "focus is still in the toolbar").toBe(true);
    await page.waitForTimeout(300); // let any smooth scroll start
    expect(await scrollY(), "tabbing the toolbar").toBe(y0);

    // The footer: Rows per page.
    await page.getByLabel("Rows per page").focus();
    await page.waitForTimeout(300);
    expect(await scrollY(), "focusing the footer's Rows per page").toBe(y0);

    // A row that sits under the toolbar and head: focusing it scrolls it clear of both (WCAG 2.4.11).
    const hiddenIdx = await page.locator("tbody tr").evaluateAll((rows) => {
      const headBottom = document.querySelector("thead")!.getBoundingClientRect().bottom;
      return rows.findIndex((r) => {
        const box = r.getBoundingClientRect();
        return box.bottom > 0 && box.top < headBottom - 4;
      });
    });
    expect(hiddenIdx, "a row under the sticky toolbar and head").toBeGreaterThanOrEqual(0);
    const row = page.locator("tbody tr").nth(hiddenIdx);
    await row.focus();
    await expect(row).toBeFocused();
    await expect(async () => {
      const rowBox = (await row.boundingBox())!;
      const head = (await page.locator("thead").boundingBox())!;
      expect(rowBox.y, "the focused row's top is at or below the head's bottom").toBeGreaterThanOrEqual(head.y + head.height - 1);
      expect(rowBox.y + rowBox.height, "and inside the window").toBeLessThanOrEqual(900);
    }).toPass({ timeout: 5_000 });
    expect(await scrollY(), "the window scrolled up to the row").toBeLessThan(y0);
  });

  /** The table card (the Table wrapper) and its table, measured against each other and the window. */
  async function cardFit(page: Page) {
    return page.locator(".list-sticky-head").evaluate((card) => {
      const table = card.querySelector("table")!;
      const doc = document.documentElement;
      return {
        tableRight: table.getBoundingClientRect().right,
        cardRight: card.getBoundingClientRect().right,
        overflowX: getComputedStyle(card).overflowX,
        scrollsInside: card.scrollWidth > card.clientWidth,
        pageOverflow: doc.scrollWidth - doc.clientWidth,
        viewport: window.innerWidth,
      };
    });
  }

  test("7. at 1280×800 the default inventory table fits its card; Repairs and Registration views scroll inside it", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await login(page, IT);

    await page.goto("/inventory");
    await waitForHydration(page.locator("tbody tr"));
    await expect.poll(async () => (await cardFit(page)).overflowX, { timeout: 20_000 }).toBe("visible");
    const fit = await cardFit(page);
    expect(fit.tableRight, "the table's right edge is inside the card").toBeLessThanOrEqual(fit.cardRight + 1);
    expect(fit.pageOverflow, "no sideways page scroll").toBeLessThanOrEqual(0);

    // Repairs (Stage + Down) and Registration (forced by the reg filter) are wider than the card at 1280.
    for (const url of ["/inventory?status=DEFECTIVE", "/inventory?reg=with-finance"]) {
      await page.goto(url);
      await waitForHydration(page.locator("tbody tr"));
      await expect.poll(async () => (await cardFit(page)).overflowX, { timeout: 20_000, message: url }).toBe("auto");
      const wide = await cardFit(page);
      expect(wide.scrollsInside, `${url}: the card scrolls sideways`).toBe(true);
      expect(wide.cardRight, `${url}: the card stays inside the window`).toBeLessThanOrEqual(wide.viewport);
      expect(wide.pageOverflow, `${url}: no sideways page scroll`).toBeLessThanOrEqual(0);
    }
    await expect(page.getByRole("columnheader", { name: "Registration" })).toBeVisible();
  });

  /** After a window scroll: the head, the table card and the body rows, against each other and the toolbar. */
  async function headInCard(page: Page) {
    return page.locator(".list-sticky-head").evaluate((card) => {
      const head = card.querySelector("thead")!.getBoundingClientRect();
      const bar = document.querySelector("[data-sticky-list] > [data-stuck]")?.getBoundingClientRect();
      const box = card.getBoundingClientRect();
      // a body row whose top is above the head's bottom edge, inside the card (hidden under the head)
      const under = [...card.querySelectorAll("tbody tr")].filter((r) => {
        const b = r.getBoundingClientRect();
        return b.top < head.bottom - 1 && b.bottom > box.top;
      }).length;
      return {
        headTop: head.top,
        cardTop: box.top,
        barBottom: bar ? bar.bottom : null,
        rowsUnderHead: under,
        scrollsInside: card.scrollWidth > card.clientWidth,
        overflowX: getComputedStyle(card).overflowX,
      };
    });
  }

  /** /inventory?per=100 loaded and hydrated, its toolbar measured, then the window scrolled 600 px. */
  async function scrolledInventory(page: Page) {
    await page.goto("/inventory?per=100");
    await expect(page.locator("tbody tr")).toHaveCount(100, { timeout: 20_000 });
    await waitForHydration(page.locator("tbody tr"));
    await expect
      .poll(() => page.locator("[data-sticky-list]").evaluate((el) => (el as HTMLElement).style.getPropertyValue("--list-sticky-top")), { timeout: 20_000 })
      .not.toBe("");
    await page.evaluate(() => window.scrollTo(0, 600));
    await expect(page.locator("[data-sticky-list] > [data-stuck]")).toHaveCount(1);
  }

  test("7b. a table scrolling inside its card keeps its head at the card's top (1100 and 1440 with Registration); a fitting one pins it under the toolbar", async ({ page }) => {
    test.setTimeout(120_000);
    const user = await db.user.findUniqueOrThrow({ where: { email: IT } });
    const keys = ["columns:inventory", INVENTORY_COLUMNS_SEEN_KEY];
    const before = await db.userPreference.findMany({ where: { userId: user.id, key: { in: keys } } });
    try {
      await db.userPreference.deleteMany({ where: { userId: user.id, key: { in: keys } } });
      await page.setViewportSize({ width: 1440, height: 800 });
      await login(page, IT);

      // The default columns fit the card at 1440: the head pins right under the stuck toolbar (unchanged).
      await scrolledInventory(page);
      await expect(page.locator(".list-sticky-head")).not.toHaveAttribute("data-scrolls-in-card", /.*/);
      await expect(async () => {
        const m = await headInCard(page);
        expect(m.overflowX, "default columns: the card does not clip").toBe("visible");
        expect(m.barBottom).not.toBeNull();
        expect(Math.abs(m.headTop - m.barBottom!), "default columns: the head right under the toolbar").toBeLessThanOrEqual(1);
      }).toPass({ timeout: 10_000 });

      // Registration on (Columns): wider than the card at 1440 and at 1100.
      const columns = page.getByRole("button", { name: "Columns", exact: true });
      await waitForHydration(columns);
      await columns.click();
      const chooser = page.getByRole("dialog", { name: "Choose columns" });
      await chooser.getByRole("checkbox", { name: "Registration", exact: true }).check();
      await chooser.getByRole("button", { name: "Apply", exact: true }).click();
      await expect(chooser).toBeHidden({ timeout: 15_000 });
      await expect(page.getByRole("columnheader", { name: "Registration" })).toBeVisible({ timeout: 15_000 });

      for (const width of [1440, 1100]) {
        await page.setViewportSize({ width, height: 800 });
        await scrolledInventory(page);
        await expect(page.getByRole("columnheader", { name: "Registration" })).toBeVisible();
        await expect(async () => {
          const m = await headInCard(page);
          expect(m.scrollsInside, `${width}: the card scrolls sideways`).toBe(true);
          expect(m.cardTop, `${width}: the card's top is above the window after the scroll`).toBeLessThan(0);
          expect(Math.abs(m.headTop - m.cardTop), `${width}: the head at the card's top`).toBeLessThanOrEqual(2);
          expect(m.rowsUnderHead, `${width}: no body row under the head`).toBe(0);
        }).toPass({ timeout: 10_000 });
      }
    } finally {
      await db.userPreference.deleteMany({ where: { userId: user.id, key: { in: keys } } });
      for (const p of before) {
        await db.userPreference.create({ data: { userId: p.userId, key: p.key, value: p.value as never } });
      }
    }
  });
});

test.describe("row size and zebra", () => {
  const rowHeight = async (row: Locator) => Math.round((await row.boundingBox())!.height);

  test("8. Dense is 36 px with one line (the EMP number beside the name), Compact 48 px; the top-bar button goes back to Comfortable", async ({ page }) => {
    await login(page, IT);
    await page.goto("/inventory?q=WD19S");
    const row = page.getByRole("row", { name: /BR-DK-0071/ });
    await expect(row).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-density", "comfortable");
    await expect.poll(() => rowHeight(row)).toBe(56);

    const sizes = page.getByRole("radiogroup", { name: "Row size" });
    await waitForHydration(sizes);
    await sizes.getByText("Dense", { exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-density", "dense");
    await expect.poll(() => rowHeight(row)).toBe(36);
    // the choice is a cookie: the server paints Dense on a reload
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-density", "dense");
    await expect.poll(() => rowHeight(row)).toBe(36);

    const assigned = (await cellOf(page, row, "Assigned")).locator("a");
    await expect(assigned).toContainText("Marites Bautista");
    const [name, empNo] = [assigned.locator(":scope > span").nth(0), assigned.locator(":scope > span").nth(1)];
    await expect(empNo).toContainText("EMP-0042");
    const nameBox = (await name.boundingBox())!;
    const empBox = (await empNo.boundingBox())!;
    // the same line: the boxes overlap vertically, and the number sits to the right of the name
    expect(empBox.y).toBeLessThan(nameBox.y + nameBox.height);
    expect(nameBox.y).toBeLessThan(empBox.y + empBox.height);
    expect(empBox.x).toBeGreaterThanOrEqual(nameBox.x + nameBox.width - 1);

    await page.getByRole("radiogroup", { name: "Row size" }).getByText("Compact", { exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
    await expect.poll(() => rowHeight(row)).toBe(48);

    // From Dense, the top bar's button reads (and goes to) Comfortable.
    await page.getByRole("radiogroup", { name: "Row size" }).getByText("Dense", { exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-density", "dense");
    const topbar = page.getByRole("button", { name: "Switch to comfortable density" });
    await expect(topbar).toHaveText("Comfortable");
    await topbar.click();
    await expect(page.locator("html")).toHaveAttribute("data-density", "comfortable");
    await expect.poll(() => rowHeight(row)).toBe(56);
    await expect(page.getByRole("radiogroup", { name: "Row size" }).getByRole("radio", { name: "Comfortable" })).toBeChecked();

    // Employees in Dense: one 36 px line too.
    await page.getByRole("radiogroup", { name: "Row size" }).getByText("Dense", { exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-density", "dense");
    await page.goto("/employees?q=Marites");
    await expect.poll(() => rowHeight(page.getByRole("row", { name: /EMP-0042/ }))).toBe(36);
  });

  test("9. zebra: even body rows are tinted, odd rows are not, on both lists", async ({ page }) => {
    await login(page, IT);
    for (const url of ["/inventory", "/employees"]) {
      await page.goto(url);
      const rows = page.locator("tbody tr");
      await expect(rows.nth(3)).toBeVisible();
      await page.mouse.move(0, 0); // no row under the pointer (hover has its own tint)
      const bg = (i: number) => rows.nth(i).locator("td").nth(1).evaluate((td) => getComputedStyle(td).backgroundColor);
      await expect
        .poll(async () => {
          const [r1, r2, r3, r4] = await Promise.all([bg(0), bg(1), bg(2), bg(3)]);
          return { oddsMatch: r1 === r3, evensMatch: r2 === r4, differ: r1 !== r2 };
        }, { message: url })
        .toEqual({ oddsMatch: true, evensMatch: true, differ: true });
    }
  });
});

test.describe("columns", () => {
  test("10. Serial number shows by default; Registration only once it is chosen in Columns", async ({ page }) => {
    const user = await db.user.findUniqueOrThrow({ where: { email: IT } });
    const keys = ["columns:inventory", INVENTORY_COLUMNS_SEEN_KEY];
    const before = await db.userPreference.findMany({ where: { userId: user.id, key: { in: keys } } });
    try {
      await db.userPreference.deleteMany({ where: { userId: user.id, key: { in: keys } } });
      await login(page, IT);
      await page.goto("/inventory");
      await expect(page.getByRole("columnheader", { name: "Serial number" })).toBeVisible();
      await expect(page.getByRole("columnheader", { name: "Registration" })).toHaveCount(0);

      const columns = page.getByRole("button", { name: "Columns", exact: true });
      await waitForHydration(columns);
      await columns.click();
      const chooser = page.getByRole("dialog", { name: "Choose columns" });
      await chooser.getByRole("checkbox", { name: "Registration", exact: true }).check();
      await chooser.getByRole("button", { name: "Apply", exact: true }).click();
      await expect(chooser).toBeHidden({ timeout: 15_000 });
      await expect(page.getByRole("columnheader", { name: "Registration" })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole("columnheader", { name: "Serial number" })).toBeVisible();
    } finally {
      await db.userPreference.deleteMany({ where: { userId: user.id, key: { in: keys } } });
      for (const p of before) {
        await db.userPreference.create({ data: { userId: p.userId, key: p.key, value: p.value as never } });
      }
    }
  });
});

test.describe("employees selection and bulk actions", () => {
  test("11. two ticked people: Export and Print IT forms carry both ids; Export downloads both; the forms page prints both", async ({ page }) => {
    const { a, b } = await moverIds();
    await login(page, IT);
    const bar = await tickMovers(page);
    await expect(bar.getByRole("button", { name: "Transfer…", exact: true })).toBeVisible();

    const exportLink = bar.getByRole("link", { name: "Export", exact: true });
    const printLink = bar.getByRole("link", { name: "Print IT forms", exact: true });
    expect(idsOf(await exportLink.getAttribute("href"))).toEqual([a, b].sort());
    expect(new URL((await exportLink.getAttribute("href"))!, "http://x").pathname).toBe("/employees/export");
    expect(idsOf(await printLink.getAttribute("href"))).toEqual([a, b].sort());
    expect(new URL((await printLink.getAttribute("href"))!, "http://x").pathname).toBe("/employees/forms");

    const [download] = await Promise.all([page.waitForEvent("download"), exportLink.click()]);
    expect(download.suggestedFilename()).toMatch(/^employees-\d{4}-\d{2}-\d{2}\.xlsx$/);
    const grid = (await readSheet(readFileSync((await download.path())!))) as unknown[][];
    expect(grid.length - 1, "two data rows under the header").toBe(2);
    expect(grid.slice(1).map((r) => String(r[0])).sort()).toEqual([MOVER_A.employeeNo, MOVER_B.employeeNo]);

    await printLink.click();
    await page.waitForURL(/\/employees\/forms\?ids=/);
    await expect(page.getByRole("button", { name: "Print 2 forms", exact: true })).toBeVisible({ timeout: 20_000 });
    const sheets = page.locator("section").filter({ has: page.getByRole("heading", { name: /Equipment accountability form/ }) });
    await expect(sheets).toHaveCount(2);
    expect((await sheets.locator("dd.font-mono").allInnerTexts()).map((t) => t.trim()).sort())
      .toEqual([MOVER_A.employeeNo, MOVER_B.employeeNo]);
  });

  test("12. an offboarded person's checkbox is disabled, and a page of only leavers cannot select all", async ({ page }) => {
    await login(page, IT);
    await page.goto("/employees?leavers=1&q=Faith");
    const box = page.getByRole("checkbox", { name: "Select Faith Mercado", exact: true });
    await expect(box).toBeVisible();
    await expect(box).toBeDisabled();
    await expect(page.getByRole("checkbox", { name: "Select all on this page" })).toBeDisabled();
    await expect(bulkBar(page)).toHaveCount(0);
  });

  test("13. Transfer… moves both people at once; the same move again is refused for both and writes nothing", async ({ page }) => {
    test.setTimeout(120_000);
    const hr = await db.department.findUniqueOrThrow({ where: { name: "HR" } });
    const ops = await db.department.findUniqueOrThrow({ where: { name: "Operations" } });
    const movers = [MOVER_A.employeeNo, MOVER_B.employeeNo];
    // start from HR whatever an earlier attempt left behind
    await db.employee.updateMany({ where: { employeeNo: { in: movers } }, data: { departmentId: hr.id } });
    const { a, b } = await moverIds();
    const transfers = () => db.employeeTransfer.count({ where: { employeeId: { in: [a, b] } } });
    const audits = () => db.auditEntry.count({ where: { entityId: { in: [a, b] }, action: "employee.transferred" } });
    const [transfers0, audits0] = [await transfers(), await audits()];

    await login(page, IT);
    let bar = await tickMovers(page);
    await bar.getByRole("button", { name: "Transfer…", exact: true }).click();
    let dialog = page.getByRole("dialog", { name: "Transfer 2 people" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Moves to").selectOption({ label: "Operations" });
    await dialog.getByRole("button", { name: "Record transfer", exact: true }).click();
    await expect(page.getByText("Success: Transferred 2 people", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(dialog).toBeHidden();
    for (const m of [MOVER_A, MOVER_B]) {
      const row = page.getByRole("row", { name: new RegExp(m.name) });
      await expect(await cellOf(page, row, "Works for")).toContainText("Operations", { timeout: 15_000 });
    }
    const moved = await db.employee.findMany({ where: { employeeNo: { in: movers } } });
    expect(moved.map((e) => e.departmentId)).toEqual([ops.id, ops.id]);
    expect(await transfers()).toBe(transfers0 + 2);
    expect(await audits()).toBe(audits0 + 2);

    // The same destination again: all or nothing — both are named, nothing is written.
    bar = await tickMovers(page);
    await bar.getByRole("button", { name: "Transfer…", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "Transfer 2 people" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Moves to").selectOption({ label: "Operations" });
    await dialog.getByRole("button", { name: "Record transfer", exact: true }).click();
    for (const m of [MOVER_A, MOVER_B]) {
      await expect(dialog.getByText(`${m.name} — Already works for this group`, { exact: true })).toBeVisible({ timeout: 15_000 });
    }
    await expect(dialog.getByText("Untick them and try again", { exact: true })).toBeVisible();
    expect(await transfers()).toBe(transfers0 + 2);
    expect(await audits()).toBe(audits0 + 2);
    expect((await db.employee.findMany({ where: { employeeNo: { in: movers } } })).map((e) => e.departmentId))
      .toEqual([ops.id, ops.id]);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toBeHidden();
  });
});

test.describe("the accountability forms page", () => {
  test("14. /employees/forms keeps the given order, skips an unknown id, refuses over the cap, and is empty with no ids", async ({ page }) => {
    const { a, b } = await moverIds();
    await login(page, IT);
    const sheets = page.locator("section").filter({ has: page.getByRole("heading", { name: /Equipment accountability form/ }) });

    // The order given (B before A), not the list's.
    await page.goto(`/employees/forms?ids=${b},${a}`);
    await expect(page.getByRole("button", { name: "Print 2 forms", exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(sheets).toHaveCount(2);
    expect((await sheets.locator("dd.font-mono").allInnerTexts()).map((t) => t.trim()))
      .toEqual([MOVER_B.employeeNo, MOVER_A.employeeNo]);

    // An id that matches nobody is skipped, and said so.
    await page.goto(`/employees/forms?ids=${a},nobody-by-this-id`);
    await expect(page.getByText("1 selected person could not be found and was skipped.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Print 1 form", exact: true })).toBeVisible();
    await expect(sheets).toHaveCount(1);

    // Over the cap: refused, never sliced.
    const tooMany = Array.from({ length: BULK_MAX + 1 }, (_, i) => `x${i}`).join(",");
    await page.goto(`/employees/forms?ids=${tooMany}`);
    await expect(page.getByText(`Pick no more than ${BULK_MAX} people to print at once`)).toBeVisible();
    await expect(sheets).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Print \d+ forms?$/ })).toHaveCount(0);

    // Nothing selected.
    await page.goto("/employees/forms");
    await expect(page.getByText("No one selected", { exact: true })).toBeVisible();
    await expect(sheets).toHaveCount(0);
  });
});

test.describe("axe", () => {
  test("15. both lists pass axe in light and dark, with and without the bulk bar", async ({ page }) => {
    test.setTimeout(240_000);
    await login(page, IT);
    for (const theme of ["light", "dark"] as const) {
      // The theme cookie the root layout reads (theme-toggle.tsx writes the same one).
      await page.context().addCookies([{ name: "br.theme", value: theme, url: new URL(page.url()).origin }]);
      for (const path of ["/inventory", "/employees"]) {
        await page.goto(path);
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await expect(page.locator("tbody tr").first()).toBeVisible();
        await expectNoSeriousAxe(page);

        const box = page.locator("tbody").getByRole("checkbox").first();
        await waitForHydration(box);
        await box.check();
        await expect(bulkBar(page)).toBeVisible();
        await expectNoSeriousAxe(page);
      }
    }
  });
});
