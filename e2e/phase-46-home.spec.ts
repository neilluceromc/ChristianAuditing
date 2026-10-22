import { test, expect, type Locator, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import { addDays, dayFromISO } from "@/lib/deadlines";
import { localDateISO } from "@/lib/format";
import { login } from "./fixtures/login";

/**
 * Phase 46 (spec docs/superpowers/specs/2026-10-20-home-overview-sidebar-design.md §5): the Overview Home in every
 * workspace, and one sidebar.
 *   home       per workspace user (it@, purchasing@, finance@, admin@ with br.dept=admin): six KPI tiles in order;
 *              every linked tile's value equals the count its page shows (followed by clicking the tile), unlinked
 *              tiles are plain cards; "Needs you" lists urgent items first and every item links; the trend's hover
 *              shows a tooltip and "Show table" shows the table
 *   history    a fresh database reads "collecting history"; two it.spare snapshots a week apart draw the sparkline
 *              and the "vs last week" change (rows inserted and deleted here)
 *   views      the new Finance, Purchasing and Admin views count what their filtered pages list
 *   sidebar    collapse (button and `[`, remembered by the br.sidebar cookie), rail badges, hover flyouts and Esc,
 *              click-to-open a non-current link's views (kept across a reload), and /inventory's sticky toolbar and
 *              head still pinning with the rail on
 *   axe        each Home in light and dark, and the rail with a flyout open — its own describe, run alone
 *
 * Elements are found by the Overview's own data attributes (src/components/home/overview/*): `[data-kpis]` holds the
 * tiles, each `[data-kpi="<key>"]` (an `<a>` when linked, a `<div>` when not) with `[data-kpi-value]` (a compacted
 * money value carries the exact amount in its `title`) and `[data-delta]`; `[data-needs-you] > li[data-tone]` are the
 * Needs you items; `[data-chart]` / `[data-tooltip]` / `[data-chart-table]` are the trend.
 *
 * The seed truncates MetricSnapshot (prisma/seed.ts), so beforeAll starts from no history. A `worker:once` in an
 * earlier spec, or a running worker, still writes today's rows, so the history test sets aside the rows for its own
 * keys, runs on a clean slate, and puts them back. Fixtures are made and removed inside the test that needs them.
 * Never a raw cuid.
 */

const db = new PrismaClient();

const IT = "it@thebackroomop.com";
const PURCHASING = "purchasing@thebackroomop.com";
const FINANCE = "finance@thebackroomop.com";
const ADMIN = "admin@thebackroomop.com";

test.beforeAll(async () => {
  execSync("npm run db:seed", { timeout: 120_000 });
  await db.metricSnapshot.deleteMany({});
});
test.afterAll(async () => {
  await db.$disconnect();
});
// Phase 47 (spec §5.4): settings follow the person — a collapse saved by one case (UserPreference ui:prefs) would be
// restored on the next case's sign-in, so every case starts from each person's defaults.
test.beforeEach(async () => {
  await db.userPreference.deleteMany({ where: { key: "ui:prefs" } });
});

async function waitForHydration(target: Locator) {
  const el = target.first();
  await el.waitFor({ state: "attached", timeout: 20_000 });
  await expect(async () => {
    expect(await el.evaluate((node) => Object.keys(node).some((k) => k.startsWith("__reactFiber$")))).toBe(true);
  }).toPass({ timeout: 20_000 });
}

/** A cookie the app reads, on the current origin at path "/" (axe-sweep.spec.ts explains why the path matters). */
async function setCookie(page: Page, name: string, value: string) {
  await page.context().addCookies([{ name, value, url: new URL(page.url()).origin }]);
}

const sidebarOf = (page: Page) => page.getByRole("complementary", { name: "Primary" });
const navOf = (page: Page) => sidebarOf(page).getByRole("navigation", { name: "Workspace" });
const scrollY = (page: Page) => page.evaluate(() => window.scrollY);
const num = (s: string) => Number(s.replace(/[₱,\s]/g, ""));

// ── axe, as e2e/phase-42-sidebar.spec.ts runs it (copied — house rule) ─────────────────────────────────────────

const PROMOTED_RULES = new Set<string>(["empty-table-header", "page-has-heading-one", "heading-order", "landmark-unique"]);

/** Moderate and above fail, and so does any promoted rule; the pointer is settled first. */
async function expectAxeClean(page: Page, label: string) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(700);
  const results = await new AxeBuilder({ page }).analyze();
  const bad = results.violations
    .filter((v) =>
      v.impact === "moderate" || v.impact === "serious" || v.impact === "critical" || PROMOTED_RULES.has(v.id))
    .map((v) => `${v.id} (${v.impact}) ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
  expect(bad, `axe (moderate and above) on ${label}`).toEqual([]);
}

// ── the Overview ────────────────────────────────────────────────────────────────────────────────────────────────

const tilesOf = (page: Page) => page.locator("[data-kpis] > [data-kpi]");
const tileOf = (page: Page, key: string) => page.locator(`[data-kpis] > [data-kpi="${key}"]`);
const needsPanel = (page: Page) =>
  page.getByRole("main").locator("section").filter({ has: page.getByRole("heading", { name: "Needs you", level: 2 }) });
const needsItems = (page: Page) => page.locator("[data-needs-you] > li");
const chartPanel = (page: Page) => page.getByRole("main").locator("section").filter({ has: page.locator("[data-chart]") });

/** A tile's value as a number: the exact amount (`title`) when the shown one is compacted, else its text. */
async function tileValue(tile: Locator): Promise<number> {
  const value = tile.locator("[data-kpi-value]");
  await expect(value).toBeVisible({ timeout: 30_000 });
  const exact = await value.getAttribute("title");
  return num(exact ?? (await value.innerText()));
}

/**
 * The count the current page shows for its filter: each list's own count line, its active tab's count, or its row
 * total when it has no count line (a small, one-page list); 0 when it shows its empty state.
 */
async function pageCount(page: Page): Promise<number> {
  const main = page.getByRole("main");
  const path = new URL(page.url()).pathname;
  /** The number `re` captures from `line`, or 0 when `empty` shows instead. */
  async function read(line: Locator, re: RegExp, empty?: Locator): Promise<number> {
    const either = empty ? line.or(empty) : line;
    await expect(either.first()).toBeVisible({ timeout: 30_000 });
    if (empty && (await empty.count()) > 0 && (await line.count()) === 0) return 0;
    const m = re.exec((await line.first().innerText()).trim());
    expect(m, `${path}: a count in "${await line.first().innerText()}"`).not.toBeNull();
    return num(m![1]);
  }
  /** Body rows, or 0 when `empty` shows instead. */
  async function rows(empty: Locator): Promise<number> {
    const body = main.locator("tbody tr");
    await expect(body.first().or(empty)).toBeVisible({ timeout: 30_000 });
    return (await empty.count()) > 0 ? 0 : body.count();
  }
  switch (path) {
    case "/inventory":
      // the toolbar's count line: "N assets · N need(s) attention" (phase-45-lists.spec.ts)
      return read(page.locator('p[aria-live="polite"]').filter({ hasText: /\d[\d,]* assets?\b/ }), /^([\d,]+) assets?/);
    case "/employees":
      return read(page.locator('p[aria-live="polite"]').filter({ hasText: /\d[\d,]* (people|person)\b/ }), /^([\d,]+) (people|person)\b/);
    case "/approvals":
      return read(main.getByText(/\d[\d,]* in this tab/), /([\d,]+) in this tab/, main.getByText("The queue is clear", { exact: true }));
    case "/purchases":
      // migration 38: the list's count line reads "N purchase orders"
      return read(main.getByText(/^\d[\d,]* purchase orders?$/), /^([\d,]+) purchase orders?$/);
    case "/finance/review":
      // Task 6: "N groups · N assets waiting", or "Nothing to review"
      return read(main.getByText(/^\d[\d,]* groups? · /), /^([\d,]+) groups? · /, main.getByText("Nothing to review", { exact: true }));
    case "/stock":
      return read(main.getByText(/^\d[\d,]* items · /), /^([\d,]+) items · /);
    case "/stock/reports/expiry":
      // the active tab reads "Expiring (N)"
      return read(main.getByRole("navigation", { name: "Expiry status" }).locator('[aria-current="page"]'), /\(([\d,]+)\)$/);
    case "/finance/assets":
      // Phase 47 (spec §3 item 5): the toolbar's "N assets shown · ₱… book value" — the whole filter, every page
      return read(page.locator('p[aria-live="polite"]').filter({ hasText: /\d[\d,]* assets? shown\b/ }), /^([\d,]+) assets? shown\b/);
    case "/admin/webhooks/deliveries":
      return read(main.getByText(/· \d[\d,]* attempts$/), /· ([\d,]+) attempts$/, main.getByText("Nothing in this tab", { exact: true }));
    case "/admin/users":
      return rows(main.getByText(/^No (disabled|active) accounts$/));
    case "/purchases/suppliers":
      return rows(main.getByText("No vendors match", { exact: true }));
    case "/admin/flags": {
      const switches = main.getByRole("switch");
      const empty = main.getByText("No unavailable flags", { exact: true });
      await expect(switches.first().or(empty)).toBeVisible({ timeout: 30_000 });
      return (await empty.count()) > 0 ? 0 : switches.count();
    }
    default:
      throw new Error(`No count reader for ${path}`);
  }
}

/** Clicks a linked tile on Home and waits for its page: returns the tile's value and its href. */
async function followTile(page: Page, key: string): Promise<{ value: number; text: string; href: string }> {
  await page.goto("/");
  const tile = page.locator(`a[data-kpi="${key}"]`);
  await expect(tile, key).toBeVisible({ timeout: 30_000 });
  const value = await tileValue(tile);
  const text = await tile.innerText();
  const href = (await tile.getAttribute("href"))!;
  const want = new URL(href, page.url());
  await tile.click();
  await expect(page).toHaveURL((u) => u.pathname === want.pathname && u.search === want.search, { timeout: 30_000 });
  return { value, text, href };
}

interface Workspace {
  name: string;
  email: string;
  /** br.dept, for admin's Admin workspace (admin lands on IT by default) */
  dept?: string;
  /** the six tiles in order, and whether each is a link */
  tiles: [key: string, linked: boolean][];
  /** "See all →" */
  needsHref: string;
  /** a series the tooltip names, and the table's row count */
  series: string;
  points: number;
}

const WORKSPACES: Workspace[] = [
  {
    name: "IT", email: IT, needsHref: "/inventory/work", series: "Assigned", points: 12,
    tiles: [["it.spare", true], ["it.deployed", true], ["it.defective", true], ["it.missing", true], ["it.attention", true], ["approvals.open", true]],
  },
  {
    name: "Purchasing", email: PURCHASING, needsHref: "/purchases", series: "Created", points: 12,
    tiles: [
      ["pr.submitted", true], ["pr.itReviewed", true], ["spend.month", false],
      ["stock.low", true], ["stock.expiringLots", true], ["stock.stocktakesOverdue", false],
    ],
  },
  {
    // Purchase orders (Task 6): Finance's queue is To review, registration groups
    name: "Finance", email: FINANCE, needsHref: "/finance/review", series: "Capitalized", points: 12,
    tiles: [
      ["fin.waitingC", false], ["fin.waitingCount", true], ["approved.month", false],
      ["capitalized.month", false], ["fin.bookC", false], ["fin.toConfirm", true],
    ],
  },
  {
    name: "Admin", email: ADMIN, dept: "admin", needsHref: "/admin/webhooks", series: "Purchasing", points: 14,
    tiles: [
      ["admin.activeUsers", true], ["admin.deadDeliveries", true], ["direct.week", false],
      ["flags.on", false], ["approvals.open", true], ["admin.disabled", true],
    ],
  },
];

async function openHome(page: Page, ws: Pick<Workspace, "email" | "dept">) {
  await login(page, ws.email);
  if (ws.dept) await setCookie(page, "br.dept", ws.dept);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: /^Hello, / })).toBeVisible({ timeout: 30_000 });
  await expect(tilesOf(page)).toHaveCount(6, { timeout: 30_000 });
}

const TONE_RANK: Record<string, number> = { bad: 0, warn: 1, info: 2 };

test.describe("the Overview Home, per workspace", () => {
  for (const ws of WORKSPACES) {
    test(`${ws.name}: six tiles whose numbers equal their pages, Needs you links, the trend's tooltip and table`, async ({ page }) => {
      test.setTimeout(240_000);
      await openHome(page, ws);

      // 1. The six tiles, in order; a linked tile is a link, an unlinked one a plain card (spec §3.2 ruling).
      expect(await tilesOf(page).evaluateAll((els) => els.map((e) => e.getAttribute("data-kpi")))).toEqual(ws.tiles.map(([k]) => k));
      for (const [key, linked] of ws.tiles) {
        await expect(page.locator(`a[data-kpi="${key}"]`), `${key} is ${linked ? "" : "not "}a link`).toHaveCount(linked ? 1 : 0);
        await expect(page.locator(`div[data-kpi="${key}"]`), `${key} is ${linked ? "not " : ""}a card`).toHaveCount(linked ? 0 : 1);
      }
      // The KPI row leads the Overview.
      await expect(page.locator("[data-overview] > *").first()).toHaveAttribute("data-kpis", "");

      // 2. Needs you: at most 6 items, urgent first, each with one link into the app; "See all" to the full queue.
      const panel = needsPanel(page);
      await expect(panel).toBeVisible();
      await expect(panel.getByRole("link", { name: /^See all/ })).toHaveAttribute("href", ws.needsHref);
      const items = needsItems(page);
      const n = await items.count();
      expect(n, `${ws.name}: the seed gives Needs you something`).toBeGreaterThan(0);
      expect(n).toBeLessThanOrEqual(6);
      const tones = await items.evaluateAll((els) => els.map((e) => e.getAttribute("data-tone") ?? ""));
      const ranks = tones.map((t) => TONE_RANK[t]);
      expect(ranks, `${ws.name}: urgent, then needs attention, then to do`).toEqual([...ranks].sort((a, b) => a - b));
      const urgent = tones.filter((t) => t === "bad").length;
      if (urgent > 0) await expect(panel).toContainText(`${urgent} urgent`);
      for (let i = 0; i < n; i++) {
        const links = items.nth(i).getByRole("link");
        await expect(links).toHaveCount(1);
        await expect(links).toHaveAttribute("href", /^\/[^/]/);
      }

      // 3. The trend: hover draws the crosshair and a tooltip naming the series; Show table swaps in the table.
      const chart = chartPanel(page);
      const toggle = chart.locator("button[aria-controls]");
      await waitForHydration(toggle);
      await expect(toggle).toHaveText("Show table");
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(chart.locator("[data-tooltip]")).toHaveCount(0);
      await chart.locator("[data-chart] svg > rect").hover();
      await expect(chart.locator("[data-tooltip]")).toBeVisible();
      await expect(chart.locator("[data-tooltip]")).toContainText(ws.series);
      await expect(chart.locator("[data-crosshair]")).toHaveCount(1);
      await page.mouse.move(0, 0);
      await expect(chart.locator("[data-tooltip]")).toHaveCount(0);

      await expect(chart.locator("[data-chart-table]")).toBeHidden();
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await expect(toggle).toHaveText("Show chart");
      await expect(chart.locator("[data-chart-table]")).toBeVisible();
      await expect(chart.locator("[data-chart-table] tbody tr")).toHaveCount(ws.points);
      await expect(chart.locator("[data-chart-table] thead th").nth(1)).toBeVisible();
      await expect(chart.locator("[data-chart]")).toBeHidden();

      // 4. Every linked tile's value is its page's count (spec anti-goal: a Home number that disagrees with its page).
      for (const [key, linked] of ws.tiles) {
        if (!linked) continue;
        const { value, text } = await followTile(page, key);
        if (key === "fin.toConfirm") {
          // Ruling: the tile sums both classes ("N IT · N Purchasing") and opens the IT view; each class's view
          // counts its own share.
          const m = /(\d+) IT · (\d+) Purchasing/.exec(text);
          expect(m, `fin.toConfirm's hint in "${text}"`).not.toBeNull();
          const [it, purchasing] = [Number(m![1]), Number(m![2])];
          expect(value).toBe(it + purchasing);
          expect(await pageCount(page), "To confirm · IT").toBe(it);
          await page.goto("/finance/assets?cls=PURCHASING&fin=with-finance");
          expect(await pageCount(page), "To confirm · Purchasing").toBe(purchasing);
        } else {
          expect(await pageCount(page), `${ws.name} tile ${key} (${value}) against ${page.url()}`).toBe(value);
        }
      }

      // 5. A Needs you item's link opens its page.
      await page.goto("/");
      const first = needsItems(page).first().getByRole("link");
      await expect(first).toBeVisible({ timeout: 30_000 });
      const target = new URL((await first.getAttribute("href"))!, page.url());
      await first.click();
      await expect(page).toHaveURL((u) => u.pathname === target.pathname, { timeout: 30_000 });
    });
  }
});

// ── history ─────────────────────────────────────────────────────────────────────────────────────────────────────

const IT_KEYS = ["it.spare", "it.deployed", "it.defective", "it.missing", "it.attention", "approvals.open"];

test.describe("history behind the numbers", () => {
  test("a fresh database reads collecting history; two snapshots a week apart draw the sparkline and the change", async ({ page }) => {
    test.setTimeout(90_000);
    const today = localDateISO();
    // `worker:once` (other specs) or a running worker may already have written today's rows, or earlier days, for
    // these keys: set them aside, run on a clean slate, put them back (cleanup touches only these keys).
    const before = await db.metricSnapshot.findMany({ where: { key: { in: IT_KEYS } } });
    await db.metricSnapshot.deleteMany({ where: { key: { in: IT_KEYS } } });
    try {
      await openHome(page, { email: IT });
      // Spec §2.4: no made-up history — every snapshot tile says so, and draws no sparkline.
      for (const key of IT_KEYS) {
        const delta = tileOf(page, key).locator("[data-delta]");
        await expect(delta, key).toHaveAttribute("data-delta", "none");
        await expect(delta, key).toHaveText("collecting history");
        await expect(tileOf(page, key).locator("[data-sparkline]"), key).toHaveCount(0);
      }

      const spare = tileOf(page, "it.spare");
      const live = await tileValue(spare);
      // A week ago there were 2 more spares, so the change reads "▼ 2 vs last week" (it.spare: up is neither good nor bad).
      await db.metricSnapshot.createMany({
        data: [
          { day: dayFromISO(addDays(today, -7)), key: "it.spare", value: BigInt(live + 2) },
          { day: dayFromISO(today), key: "it.spare", value: BigInt(live) },
        ],
      });
      await page.reload();
      await expect(spare.locator("[data-sparkline]")).toBeVisible({ timeout: 30_000 });
      const delta = spare.locator("[data-delta]");
      await expect(delta).not.toHaveAttribute("data-delta", "none");
      await expect(delta).toHaveText(/2 vs last week$/);
      // the arrow is drawn, the direction is read as a word
      await expect(delta.locator(".sr-only")).toHaveText(/^down\s*$/);
      // the other tiles have no history yet
      await expect(tileOf(page, "it.deployed").locator("[data-delta]")).toHaveText("collecting history");
    } finally {
      await db.metricSnapshot.deleteMany({ where: { key: { in: IT_KEYS } } });
      if (before.length > 0) await db.metricSnapshot.createMany({ data: before, skipDuplicates: true });
    }
  });
});

// ── the new views ───────────────────────────────────────────────────────────────────────────────────────────────

/** A view's count from its badge (aria-labelled), 0 when it shows none. */
async function viewCount(view: Locator): Promise<number> {
  await expect(view).toBeVisible({ timeout: 30_000 });
  const badge = view.locator("span[aria-label]");
  return (await badge.count()) > 0 ? num(await badge.innerText()) : 0;
}

/** Clicks the view on the current page and compares its count with what the filtered page lists. */
async function expectViewMatchesPage(page: Page, name: RegExp, href: string) {
  const view = navOf(page).getByRole("link", { name });
  await expect(view).toHaveAttribute("href", href);
  const n = await viewCount(view);
  const want = new URL(href, page.url());
  await view.click();
  await expect(page).toHaveURL((u) => u.pathname === want.pathname && u.search === want.search, { timeout: 30_000 });
  await expect(view).toHaveAttribute("aria-current", "page");
  expect(await pageCount(page), `${name} (${n})`).toBe(n);
  return n;
}

test.describe("the new views count what their pages list", () => {
  test("Finance: To confirm · IT and To confirm · Purchasing", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, FINANCE);
    await page.goto("/finance/assets");
    await expectViewMatchesPage(page, /^To confirm · IT\b/, "/finance/assets?fin=with-finance");
    await expectViewMatchesPage(page, /^To confirm · Purchasing\b/, "/finance/assets?cls=PURCHASING&fin=with-finance");
  });

  test("Purchasing: Below reorder and Renewing soon", async ({ page }) => {
    test.setTimeout(120_000);
    const today = localDateISO();
    // The seed has no contract ending within 30 days: one fixture supplier does.
    const vendor = await db.vendor.create({
      data: {
        name: "P46 Renewing Supplier", contractStatus: "ACTIVE",
        contractStart: dayFromISO(addDays(today, -300)), contractEnd: dayFromISO(addDays(today, 10)),
      },
    });
    try {
      await login(page, PURCHASING);
      await page.goto("/stock");
      await expectViewMatchesPage(page, /^Below reorder\b/, "/stock?low=1");
      await page.goto("/purchases/suppliers");
      const n = await expectViewMatchesPage(page, /^Renewing soon\b/, "/purchases/suppliers?renewing=30");
      expect(n, "the fixture supplier renews within 30 days").toBeGreaterThan(0);
      await expect(page.getByRole("main").getByRole("row", { name: /P46 Renewing Supplier/ })).toBeVisible();
    } finally {
      await db.vendor.delete({ where: { id: vendor.id } });
    }
  });

  test("Admin: Disabled, Failed deliveries and Unavailable", async ({ page }) => {
    test.setTimeout(120_000);
    // The seed disables no account: one fixture account is disabled (no password, so it can never sign in).
    const user = await db.user.create({
      data: { email: "p46-disabled@thebackroomop.com", name: "P46 Disabled", role: "viewer", disabled: true },
    });
    try {
      await login(page, ADMIN);
      await setCookie(page, "br.dept", "admin");
      await page.goto("/admin/users");
      const disabled = await expectViewMatchesPage(page, /^Disabled\b/, "/admin/users?disabled=1");
      expect(disabled, "the fixture account").toBeGreaterThan(0);
      await page.goto("/admin/webhooks");
      const dead = await expectViewMatchesPage(page, /^Failed deliveries\b/, "/admin/webhooks/deliveries?state=DEAD");
      expect(dead, "the seed's dead-lettered deliveries").toBeGreaterThan(0);
      await page.goto("/admin/flags");
      const unavailable = await expectViewMatchesPage(page, /^Unavailable\b/, "/admin/flags?state=unavailable");
      expect(unavailable, "this build's unavailable flag").toBeGreaterThan(0);
    } finally {
      await db.user.delete({ where: { id: user.id } });
    }
  });
});

// ── the sidebar ─────────────────────────────────────────────────────────────────────────────────────────────────

/** The sidebar's inset panel: 236 px wide, 72 px as the rail. */
const panelWidth = async (page: Page) => (await sidebarOf(page).locator(":scope > div").first().boundingBox())!.width;
const sidebarCookie = async (page: Page) =>
  (await page.context().cookies()).find((c) => c.name === "br.sidebar")?.value;

test.describe("the sidebar: collapse, flyouts, click to open", () => {
  test("the button and [ toggle the rail; it survives a reload; badges show as pills; a flyout lists views; Esc closes it", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page, IT);
    await page.goto("/inventory");
    const sidebar = sidebarOf(page);
    const shell = page.locator("[data-sidebar]");
    await expect(shell).toHaveAttribute("data-sidebar", "full");
    expect(await panelWidth(page)).toBeGreaterThan(200);

    // The button.
    const collapse = sidebar.getByRole("button", { name: "Collapse sidebar" });
    await waitForHydration(collapse);
    await expect(collapse).toHaveAttribute("aria-keyshortcuts", "[");
    await collapse.click();
    await expect(shell).toHaveAttribute("data-sidebar", "rail");
    await expect.poll(() => panelWidth(page)).toBeLessThan(80);
    await expect(sidebar.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
    expect(await sidebarCookie(page)).toBe("rail");

    // Remembered: the server paints the rail on a reload.
    await page.reload();
    await expect(shell).toHaveAttribute("data-sidebar", "rail");
    expect(await panelWidth(page)).toBeLessThan(80);
    const nav = navOf(page);
    // Icons with names, no visible labels; the current link is marked.
    await expect(nav.getByRole("link", { name: "Inventory", exact: true })).toHaveAttribute("aria-current", "true");
    await expect(nav.getByText("Employees", { exact: true })).toBeHidden();

    // Badges become corner pills: the worklist's count, and red for approvals past SLA (APR-2040 in the seed).
    const worklist = nav.getByRole("link", { name: /^Worklist, \d+ waiting on the worklist$/ });
    await expect(worklist.locator('[data-rail-pill="count"]')).toHaveText(/^(\d+|99\+)$/);
    const approvals = nav.getByRole("link", { name: /^Approvals, .*past SLA/ });
    await expect(approvals.locator('[data-rail-pill="fault"]')).toBeVisible();

    // Hover opens the flyout with the link's views (and their counts) as links; Esc while hovering closes it.
    const employees = nav.getByRole("link", { name: "Employees", exact: true });
    const flyout = nav.getByRole("list", { name: "Employees views" });
    await expect(flyout).toBeHidden();
    await waitForHydration(employees);
    await employees.hover();
    await expect(flyout).toBeVisible();
    await expect(flyout.getByRole("link", { name: "Everyone", exact: true })).toHaveAttribute("href", "/employees");
    await expect(flyout.getByRole("link", { name: "Client staff", exact: true })).toHaveAttribute("href", "/employees?kind=CLIENT");
    await expect(flyout.getByRole("link", { name: /^Leaving\b/ })).toHaveAttribute("href", "/employees?employment=OFFBOARDING");
    await page.keyboard.press("Escape");
    await expect(flyout).toBeHidden();
    // The pointer leaves and comes back: the flyout shows again.
    await page.mouse.move(700, 450);
    await employees.hover();
    await expect(flyout).toBeVisible();
    // The current link's flyout carries its counted views.
    await page.mouse.move(700, 450);
    await nav.getByRole("link", { name: "Inventory", exact: true }).hover();
    await expect(nav.getByRole("list", { name: "Inventory views" }).getByRole("link", { name: /^Spare \d+ spare$/ })).toBeVisible();
    await page.mouse.move(700, 450);

    // The [ key, outside a field, toggles both ways.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("[");
    await expect(shell).toHaveAttribute("data-sidebar", "full");
    await expect(sidebar.getByRole("button", { name: "Collapse sidebar" })).toBeVisible();
    expect(await sidebarCookie(page)).toBe("full");
    await page.keyboard.press("[");
    await expect(shell).toHaveAttribute("data-sidebar", "rail");
    expect(await sidebarCookie(page)).toBe("rail");

    // …and is just a character in the search box.
    const search = page.getByRole("searchbox", { name: "Search assets" });
    await search.focus();
    await page.keyboard.press("[");
    await expect(search).toHaveValue("[");
    await expect(shell).toHaveAttribute("data-sidebar", "rail");
  });

  test("click to open: a non-current link's toggle opens its views, and a reload keeps them open", async ({ page }) => {
    test.setTimeout(90_000);
    await login(page, IT);
    await page.goto("/inventory");
    const nav = navOf(page);
    // The current link opens by itself; its toggle is a button beside the link, never inside it.
    await expect(nav.getByRole("button", { name: "Inventory views" })).toHaveAttribute("aria-expanded", "true");
    await expect(nav.locator("a button")).toHaveCount(0);

    const toggle = nav.getByRole("button", { name: "Employees views" });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(nav.locator('a[href="/employees?kind=CLIENT"]')).toHaveCount(0);
    await waitForHydration(toggle);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const views: [label: string, href: string][] = [
      ["Everyone", "/employees"], ["Client staff", "/employees?kind=CLIENT"],
      ["Leaving", "/employees?employment=OFFBOARDING"], ["Policy gaps", "/employees?gaps=1"],
    ];
    for (const [label, href] of views) {
      await expect(nav.getByRole("link", { name: new RegExp(`^${label}\\b`) }), label).toHaveAttribute("href", href);
    }
    // It opened without navigating, and the current link stays open.
    expect(new URL(page.url()).pathname).toBe("/inventory");
    await expect(nav.getByRole("button", { name: "Inventory views" })).toHaveAttribute("aria-expanded", "true");

    // Remembered for the session (sessionStorage, read after mount).
    await page.reload();
    await expect(nav.getByRole("button", { name: "Employees views" })).toHaveAttribute("aria-expanded", "true", { timeout: 20_000 });
    await expect(nav.getByRole("link", { name: "Client staff", exact: true })).toHaveAttribute("href", "/employees?kind=CLIENT");

    // And it closes again.
    const again = nav.getByRole("button", { name: "Employees views" });
    await waitForHydration(again);
    await again.click();
    await expect(again).toHaveAttribute("aria-expanded", "false");
    await expect(nav.locator('a[href="/employees?kind=CLIENT"]')).toHaveCount(0);
  });

  test("with the rail on, /inventory's sticky toolbar and head still pin after a scroll", async ({ page }) => {
    test.setTimeout(180_000);
    // Enough rows to scroll 1,400 px at per=100 (as phase-45-lists.spec.ts's fixtures).
    const laptop = await db.assetCategory.findFirstOrThrow({ where: { name: "Laptop", cls: "IT" } });
    const now = new Date();
    await db.asset.createMany({
      data: Array.from({ length: 100 }, (_, i) => ({
        tag: `BR-PG-${String(i + 1).padStart(4, "0")}`,
        model: "P46 Sticky Unit",
        categoryId: laptop.id,
        cls: "IT" as const,
        status: "SPARE" as const,
        itVerifiedAt: now,
      })),
    });
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await login(page, IT);
      await setCookie(page, "br.sidebar", "rail");
      const url = "/inventory?per=100";
      await page.goto(url);
      await expect(page.locator("[data-sidebar]")).toHaveAttribute("data-sidebar", "rail");
      await expect(page.locator("tbody tr")).toHaveCount(100, { timeout: 30_000 });
      const list = page.locator("[data-sticky-list]");
      const toolbar = page.locator("[data-sticky-list] > div").filter({ has: page.getByRole("searchbox") });
      await expect
        .poll(() => list.evaluate((el) => (el as HTMLElement).style.getPropertyValue("--list-sticky-top")), { timeout: 20_000 })
        .not.toBe("");
      await expect(toolbar).not.toHaveAttribute("data-stuck", /.*/);

      await page.evaluate(() => window.scrollTo(0, 1400));
      await expect(toolbar).toHaveAttribute("data-stuck", "true");
      await expect(async () => {
        const bar = (await toolbar.boundingBox())!;
        const head = (await page.locator("thead").boundingBox())!;
        expect(bar.y, "the toolbar's top").toBeGreaterThanOrEqual(-0.5);
        expect(bar.y, "the toolbar's top").toBeLessThanOrEqual(1);
        expect(Math.abs(head.y - (bar.y + bar.height)), "the head right under the toolbar").toBeLessThanOrEqual(1);
      }).toPass({ timeout: 10_000 });
      const footer = (await page.getByText(/^Rows [\d,]+–[\d,]+ of [\d,]+$/).locator("..").boundingBox())!;
      expect(Math.abs(footer.y + footer.height - 900), "footer bottom at the window's bottom").toBeLessThanOrEqual(1);
      expect(await scrollY(page)).toBeGreaterThanOrEqual(1400);
      // The rail stays put beside it.
      await expect(sidebarOf(page)).toBeInViewport();
    } finally {
      await db.asset.deleteMany({ where: { tag: { startsWith: "BR-PG-" }, model: "P46 Sticky Unit" } });
    }
  });
});

// ── axe (its own describe: the controller runs it alone) ────────────────────────────────────────────────────────

test.describe("axe — every Home in light and dark, and the rail", () => {
  test("each workspace's Home passes axe in light and dark", async ({ page }) => {
    test.setTimeout(300_000);
    for (const ws of WORKSPACES) {
      await login(page, ws.email);
      if (ws.dept) await setCookie(page, "br.dept", ws.dept);
      for (const theme of ["light", "dark"] as const) {
        await setCookie(page, "br.theme", theme);
        await page.goto("/");
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await expect(tilesOf(page)).toHaveCount(6, { timeout: 30_000 });
        await expect(tileOf(page, ws.tiles[0][0])).toBeVisible();
        await expectAxeClean(page, `Home (${ws.name}, ${theme})`);
      }
    }
  });

  test("the rail passes axe in light and dark, with a flyout open from the keyboard", async ({ page }) => {
    test.setTimeout(180_000);
    await login(page, IT);
    await setCookie(page, "br.sidebar", "rail");
    for (const theme of ["light", "dark"] as const) {
      await setCookie(page, "br.theme", theme);
      await page.goto("/inventory");
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(page.locator("[data-sidebar]")).toHaveAttribute("data-sidebar", "rail");
      await expectAxeClean(page, `/inventory rail (${theme})`);

      const inventory = navOf(page).getByRole("link", { name: "Inventory", exact: true });
      await waitForHydration(inventory);
      await inventory.focus();
      await expect(navOf(page).getByRole("list", { name: "Inventory views" })).toBeVisible();
      await expectAxeClean(page, `/inventory rail with the Inventory flyout (${theme})`);
    }
  });
});
