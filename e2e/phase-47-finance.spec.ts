import { test, expect, type Locator, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import { SEED_PASSWORD } from "../prisma/fixtures";
import { asOfMonth, monthLabel } from "@/lib/depreciation";
import { fmtMoneyExact } from "@/lib/format";

/**
 * Phase 47 (spec docs/superpowers/specs/2026-10-21-finance-assets-and-shell-design.md): Finance's Assets list and
 * asset page, the shared notes and attachments, and the shell fixes.
 *   list     a category tile scopes the money cards, the status tiles, the toolbar count and the table (pressing it
 *            again clears it); Purchasing has no Waiting for IT tab; the Life filter; the Life and Tag sorts; the
 *            category grid never scrolls sideways (1440 / 1000 / 375)
 *   asset    year tabs, All years and a year link; a 120-month Building numbers 11 years; Finance posts, replies,
 *            resolves and reopens a note (focus back each time); IT posts on the Inventory record and it shows on
 *            Finance; PDF and PNG attachments upload, list, filter and preview (the inline route); the Documents tab
 *            groups them; the Financial history shows the notes with their source and Details, filters by person and
 *            exports a CSV; the left panel stacks above the tabs at 375 px with no sideways scroll
 *   shell    Disposal shows the Cris at Work scene (words cycle, theme follows, reduced motion holds on reading, fits
 *            375 px, the sidebar stays clickable); "CRIS" in the sidebar, the rail and the tab title; collapse animates and
 *            is instant under reduced motion; person A's dark theme never reaches person B on the same browser;
 *            Cris's chat is gone after Sign out and back in (the messages stay for the usage counts)
 *   axe      both Finance pages (every asset tab), Disposal, and the Inventory record's Notes, Attachments and
 *            Documents, light and dark — its own describe
 *
 * Fixtures (after the reseed): the Laptop category gets 36 months / 10 % and Building 120 months / 0 %; four seeded
 * assets are approved straight in the DB (no audit): BR-LT-0148 (Oct 2024, mid-life), BR-LT-0166 (Aug 2023, fully
 * depreciated), BR-LT-0210 (Oct 2024 with a 28-month override, 6 months or less left) and BR-BL-0001 (Aug 2018, a
 * Building). Everything is put back in afterAll; notes are deleted replies first (AssetNote's foreign keys restrict).
 */

const db = new PrismaClient();

const IT = "it@thebackroomop.com";
const FINANCE = "finance@thebackroomop.com";
const ADMIN = "admin@thebackroomop.com";

const MID = "BR-LT-0148";
const FULL = "BR-LT-0166";
const SOON = "BR-LT-0210";
const BUILDING = "BR-BL-0001";
const FIXTURES = [MID, FULL, SOON, BUILDING];
const AXE_ASSET = FULL;

const PDF = path.join(__dirname, "fixtures", "delivery-receipt.pdf");
/** A 1×1 PNG. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

const ids: Record<string, string> = {};
const users: Record<string, string> = {};
let categoryIds: { laptop: string; building: string; monitor: string };

test.beforeAll(async () => {
  execSync("npm run db:seed", { timeout: 120_000 });
  for (const email of [IT, FINANCE, ADMIN]) users[email] = (await db.user.findUniqueOrThrow({ where: { email } })).id;
  const [laptop, building, monitor] = await Promise.all(
    ["Laptop", "Building", "Monitor"].map((name) => db.assetCategory.findUniqueOrThrow({ where: { name } })),
  );
  categoryIds = { laptop: laptop.id, building: building.id, monitor: monitor.id };
  await db.assetCategory.update({ where: { id: laptop.id }, data: { depreciationLifeMonths: 36, depreciationSalvagePercent: 10 } });
  await db.assetCategory.update({ where: { id: building.id }, data: { depreciationLifeMonths: 120, depreciationSalvagePercent: 0 } });
  const confirmed = { financeConfirmedAt: new Date(Date.now() - 100 * 86_400_000), financeConfirmedById: users[FINANCE] };
  for (const tag of FIXTURES) {
    const a = await db.asset.update({
      where: { tag },
      data: { ...confirmed, ...(tag === SOON ? { depreciationLifeMonths: 28, depreciationSalvage: 0, depreciationNote: "e2e short life" } : {}) },
    });
    ids[tag] = a.id;
  }
});

test.afterAll(async () => {
  const assetIds = Object.values(ids);
  await db.assetNote.deleteMany({ where: { assetId: { in: assetIds }, parentId: { not: null } } });
  await db.assetNote.deleteMany({ where: { assetId: { in: assetIds } } });
  await db.assetDocument.deleteMany({ where: { assetId: { in: assetIds }, kind: { startsWith: "attachment:" } } });
  await db.asset.updateMany({
    where: { id: { in: assetIds } },
    data: { financeConfirmedAt: null, financeConfirmedById: null },
  });
  await db.asset.update({ where: { tag: SOON }, data: { depreciationLifeMonths: null, depreciationSalvage: null, depreciationNote: null } });
  await db.assetCategory.updateMany({
    where: { id: { in: [categoryIds.laptop, categoryIds.building] } },
    data: { depreciationLifeMonths: null, depreciationSalvagePercent: null },
  });
  await db.userPreference.deleteMany({ where: { key: "ui:prefs" } });
  await db.$disconnect();
});

// Settings follow the person (spec §5.4): a theme or collapse saved by one case would be restored on the next case's
// sign-in, so every case starts from each person's defaults.
test.beforeEach(async () => {
  await db.userPreference.deleteMany({ where: { key: "ui:prefs" } });
});

// Copied from e2e/phase-46-home.spec.ts — house rule: never import helpers across spec files.
async function login(page: Page, email: string) {
  await page.goto("/logout");
  await page.getByRole("link", { name: /^Log in/ }).click();
  await page.locator('[data-login-ready="true"]').waitFor();
  await page.getByLabel("Work email", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Password", { exact: true }).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  // Spec §5.4: the first page after a sign-in rewrites the settings cookies (UiPrefsSync → restoreUiPrefs, stamping
  // br.uid) and refreshes; wait for it, so nothing seeded or clicked next races that refresh.
  await expect
    .poll(async () => (await page.context().cookies()).find((c) => c.name === "br.uid")?.value, { timeout: 30_000 })
    .toBe(users[email]);
}
async function waitForHydration(target: Locator) {
  const el = target.first();
  await el.waitFor({ state: "attached", timeout: 20_000 });
  await expect(async () => {
    expect(await el.evaluate((node) => Object.keys(node).some((k) => k.startsWith("__reactFiber$")))).toBe(true);
  }).toPass({ timeout: 20_000 });
}
async function setCookie(page: Page, name: string, value: string) {
  await page.context().addCookies([{ name, value, url: new URL(page.url()).origin }]);
}

const PROMOTED_RULES = new Set<string>(["empty-table-header", "page-has-heading-one", "heading-order", "landmark-unique"]);

/**
 * As e2e/phase-46-home.spec.ts runs it — moderate and above count, and so does any promoted rule — but returned, so
 * one run lists every page's problems.
 */
async function axeProblems(page: Page, label: string): Promise<string[]> {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(700);
  const results = await new AxeBuilder({ page }).analyze();
  return results.violations
    .filter((v) =>
      v.impact === "moderate" || v.impact === "serious" || v.impact === "critical" || PROMOTED_RULES.has(v.id))
    .map((v) => `${label}: ${v.id} (${v.impact}) ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

const noSidewaysScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

// ── the list ───────────────────────────────────────────────────────────────────────────────────────────────────

const main = (page: Page) => page.getByRole("main");
const categoryNav = (page: Page) => page.getByRole("navigation", { name: "Filter by category" });
const statusNav = (page: Page) => page.getByRole("navigation", { name: "Filter by status" });
const finTabs = (page: Page) => page.getByRole("navigation", { name: "Finance state" });
const shownLine = (page: Page) => page.locator('p[aria-live="polite"]').filter({ hasText: /assets? shown/ });
const totals = (page: Page) => page.getByRole("region", { name: "Money totals" });
const bodyTags = (page: Page) =>
  page.locator("tbody tr").evaluateAll((trs) => trs.map((tr) => tr.querySelector("td a")?.textContent?.trim() ?? ""));
const rowOf = (page: Page, tag: string) => page.locator("tbody tr").filter({ has: page.getByRole("link", { name: tag, exact: true }) });

test.describe("Finance → Assets, the list", () => {
  test("a category tile scopes the money cards, the status tiles, the count and the table; pressed again it clears", async ({ page }) => {
    await login(page, FINANCE);
    await page.goto("/finance/assets");
    await expect(page).toHaveTitle("Assets · CRIS");
    await expect(categoryNav(page).getByRole("link", { name: /^All categories\b/ })).toHaveAttribute("aria-current", "true");

    const monitor = categoryNav(page).getByRole("link", { name: /^Monitor\b/ });
    await monitor.click();
    await expect(page).toHaveURL((u) => u.searchParams.get("category") === categoryIds.monitor, { timeout: 15_000 });
    await expect(monitor).toHaveAttribute("aria-current", "true");

    // the seed's four monitors: two spare, one deployed, one defective
    await expect(shownLine(page)).toContainText(/^4 assets shown/);
    await expect(totals(page)).toContainText("4 assets with a cost");
    expect(await page.locator("tbody tr").count()).toBe(4);
    const categories = await page.locator("tbody tr").evaluateAll((trs) => trs.map((tr) => tr.querySelectorAll("td")[1]?.textContent?.trim()));
    expect(new Set(categories)).toEqual(new Set(["Monitor"]));
    await expect(statusNav(page).getByRole("link", { name: /^In stock\b/ })).toContainText("2");
    await expect(statusNav(page).getByRole("link", { name: /^Deployed\b/ })).toContainText("1");
    await expect(statusNav(page).getByRole("link", { name: /^In repair\b/ })).toContainText("1");
    // the At cost card and the totals row agree: ₱8,000 + ₱9,500 + ₱12,000 + ₱12,000
    const atCost = fmtMoneyExact(41_500);
    await expect(totals(page)).toContainText(atCost);
    await expect(page.locator("tfoot")).toContainText(atCost);
    // the active-filter chip names the category
    await expect(main(page).getByRole("link", { name: "Clear all", exact: true })).toBeVisible();

    await monitor.click();
    await expect(page).toHaveURL((u) => !u.searchParams.has("category"), { timeout: 15_000 });
    await expect(categoryNav(page).getByRole("link", { name: /^All categories\b/ })).toHaveAttribute("aria-current", "true");
  });

  test("Purchasing has no Waiting for IT tab; IT does", async ({ page }) => {
    await login(page, FINANCE);
    await page.goto("/finance/assets");
    await expect(finTabs(page).getByRole("link", { name: /^Waiting for IT\b/ })).toBeVisible();
    await page.goto("/finance/assets?cls=PURCHASING");
    await expect(finTabs(page).getByRole("link", { name: /^To review\b/ })).toBeVisible();
    await expect(finTabs(page).getByRole("link", { name: /^Waiting for IT\b/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: BUILDING, exact: true })).toBeVisible();
  });

  test("the Life filter and the Life and Tag sorts", async ({ page }) => {
    await login(page, FINANCE);
    await page.goto("/finance/assets");
    const life = page.getByLabel("Life", { exact: true });
    await waitForHydration(life);

    await life.selectOption({ label: "Fully depreciated" });
    await expect(page).toHaveURL(/life=full/, { timeout: 15_000 });
    await expect.poll(() => bodyTags(page)).toEqual([FULL]);
    await expect(rowOf(page, FULL).locator("[data-life]")).toHaveAttribute("data-life", "full");

    await page.getByLabel("Life", { exact: true }).selectOption({ label: "6 months or less left" });
    await expect(page).toHaveURL(/life=soon/, { timeout: 15_000 });
    await expect.poll(() => bodyTags(page)).toEqual([SOON]);
    await expect(rowOf(page, SOON).locator("[data-life]")).toHaveAttribute("data-life", "soon");

    await page.getByLabel("Life", { exact: true }).selectOption({ label: "Not depreciating yet" });
    await expect(page).toHaveURL(/life=notstarted/, { timeout: 15_000 });
    await expect(page.locator("tbody tr").first()).toBeVisible();
    for (const tag of [MID, FULL, SOON]) await expect(rowOf(page, tag)).toHaveCount(0);
    const stages = await page.locator("tbody tr [data-life]").evaluateAll((els) => els.map((e) => e.getAttribute("data-life")));
    expect(stages.length).toBeGreaterThan(0);
    expect(new Set(stages)).toEqual(new Set(["notstarted"]));

    // Sort: life used, most first — the three depreciating laptops lead, fullest first
    await page.goto("/finance/assets");
    const sort = page.getByLabel("Sort", { exact: true });
    await waitForHydration(sort);
    await sort.selectOption({ label: "Life used, most first" });
    await expect(page).toHaveURL(/sort=life/, { timeout: 15_000 });
    await expect.poll(async () => (await bodyTags(page)).slice(0, 3)).toEqual([FULL, SOON, MID]);

    await page.getByLabel("Sort", { exact: true }).selectOption({ label: "Tag" });
    await expect(page).toHaveURL(/sort=tag/, { timeout: 15_000 });
    await expect(async () => {
      const tags = await bodyTags(page);
      expect(tags.length).toBeGreaterThan(1);
      expect(tags).toEqual([...tags].sort((a, b) => a.localeCompare(b)));
    }).toPass({ timeout: 15_000 });
  });

  test("the category grid wraps — 6, 4 and 2 columns — and never scrolls sideways", async ({ page }) => {
    await login(page, FINANCE);
    for (const [width, cols] of [[1440, 6], [1000, 4], [375, 2]] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/finance/assets");
      const grid = categoryNav(page);
      await expect(grid).toBeVisible();
      // IT's seeded categories with assets: Laptop, Monitor, Headset, Keyboard, Other — six tiles with All
      await expect(grid.getByRole("link")).toHaveCount(6);
      const columns = await grid.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
      expect(columns, `columns at ${width}px`).toBe(cols);
      expect(await grid.evaluate((el) => el.scrollWidth <= el.clientWidth), `the grid at ${width}px`).toBe(true);
      expect(await noSidewaysScroll(page), `the page at ${width}px`).toBe(true);
    }
  });
});

// ── the asset page ─────────────────────────────────────────────────────────────────────────────────────────────

const assetTabs = (page: Page) => page.getByRole("navigation", { name: "Asset sections" });
const years = (page: Page) => page.getByRole("navigation", { name: "Years of the life" });
const notesList = (page: Page) => page.getByRole("list", { name: "Notes" });
const noteBy = (page: Page, who: string) => notesList(page).getByRole("article", { name: new RegExp(`^Note by ${who}`) });

test.describe.serial("Finance → one asset", () => {
  test("ledger: year tabs, All years one row per year, a year link opens its months; a Building has 11 years", async ({ page }) => {
    await login(page, FINANCE);
    await page.goto(`/finance/assets/${ids[MID]}`);
    await expect(page.getByRole("heading", { name: MID, level: 1 })).toBeVisible();
    await expect(page).toHaveTitle(`${MID} · CRIS`);
    await expect(assetTabs(page).getByRole("link", { name: /^Depreciation ledger/ })).toContainText("36 mo");

    // Oct 2024 + 36 months: 2024 (3), 2025, 2026, 2027 (9), and All years; this year is open
    const asOf = asOfMonth(new Date());
    const thisYear = String(Math.floor(asOf / 12));
    await expect(years(page).getByRole("link")).toHaveText([/^2024/, /^2025/, /^2026/, /^2027/, "All years"]);
    await expect(years(page).getByRole("link", { name: new RegExp(`^${thisYear}`) })).toHaveAttribute("aria-current", "true");
    await expect(years(page).getByRole("link", { name: /^2024/ })).toContainText("3 mo");
    await expect(main(page).getByText("Opening book value", { exact: true })).toBeVisible();
    const months = page.getByRole("table", { name: `Depreciation by month, ${thisYear}` });
    await expect(months.getByRole("row", { name: new RegExp(`^${monthLabel(asOf)}`) })).toContainText("This month");

    await years(page).getByRole("link", { name: "All years", exact: true }).click();
    await expect(page).toHaveURL(/year=all/, { timeout: 15_000 });
    const byYear = page.getByRole("table", { name: "Depreciation by year" });
    await expect(byYear.locator("tbody tr")).toHaveCount(4);
    await byYear.getByRole("link", { name: "2027", exact: true }).click();
    await expect(page).toHaveURL(/year=2027/, { timeout: 15_000 });
    await expect(page.getByRole("table", { name: "Depreciation by month, 2027" }).locator("tbody tr")).toHaveCount(9);
    // the Purchase, Cost breakdown and Depreciation cards under the ledger
    for (const h of ["Purchase", "Cost breakdown", "Depreciation"]) {
      await expect(main(page).getByRole("heading", { name: h, exact: true })).toBeVisible();
    }

    // Review Focus #2: a 120-month life from Aug 2018 is 11 calendar years, and All years is 11 rows
    await page.goto(`/finance/assets/${ids[BUILDING]}?year=all`);
    await expect(years(page).getByRole("link")).toHaveCount(12);
    await expect(page.getByRole("table", { name: "Depreciation by year" }).locator("tbody tr")).toHaveCount(11);
  });

  test("notes: Finance posts, replies, resolves and reopens — focus comes back each time", async ({ page }) => {
    await login(page, FINANCE);
    await page.goto(`/finance/assets/${ids[MID]}?tab=notes`);
    await expect(main(page).getByText("No notes yet", { exact: true })).toBeVisible();
    const box = page.getByRole("textbox", { name: "Add a note" });
    await waitForHydration(box);
    await expect(page.getByRole("button", { name: "Post", exact: true })).toBeDisabled();
    await box.fill("e2e: invoice total looks short by the delivery fee");
    await page.getByRole("button", { name: "Post", exact: true }).click();
    const note = noteBy(page, "L. Domingo");
    await expect(note).toContainText("invoice total looks short by the delivery fee", { timeout: 20_000 });
    await expect(note).toContainText("Finance");
    await expect(box).toHaveValue("");
    await expect(box).toBeFocused();
    await expect(assetTabs(page).getByRole("link", { name: /^Notes/ })).toContainText("1");

    const reply = note.getByRole("textbox", { name: "Reply to L. Domingo" });
    await reply.fill("e2e: checked with the supplier — fee billed separately");
    await note.getByRole("button", { name: "Reply", exact: true }).click();
    await expect(note.getByRole("list", { name: "Replies" })).toContainText("fee billed separately", { timeout: 20_000 });
    await expect(note.getByRole("textbox", { name: "Reply to L. Domingo" })).toBeFocused();

    await note.getByRole("button", { name: "Mark resolved", exact: true }).click();
    const resolved = noteBy(page, "L. Domingo");
    await expect(resolved).toHaveAttribute("data-resolved", "true", { timeout: 20_000 });
    await expect(resolved.getByText("Resolved", { exact: true })).toBeVisible();
    await expect(resolved.getByRole("textbox")).toHaveCount(0);
    await expect(resolved.getByRole("button", { name: "Reopen", exact: true })).toBeFocused();

    await resolved.getByRole("button", { name: "Reopen", exact: true }).click();
    await expect(noteBy(page, "L. Domingo")).toHaveAttribute("data-resolved", "false", { timeout: 20_000 });
    await expect(noteBy(page, "L. Domingo").getByRole("button", { name: "Mark resolved", exact: true })).toBeFocused();

    expect(await db.assetNote.count({ where: { assetId: ids[MID] } })).toBe(2);
    const audit = await db.auditEntry.findMany({ where: { entityId: ids[MID], action: { startsWith: "note." } }, select: { action: true, source: true } });
    expect(audit.map((a) => a.action).sort()).toEqual(["note.posted", "note.reopened", "note.replied", "note.resolved"]);
    expect(new Set(audit.map((a) => a.source))).toEqual(new Set(["web"]));
  });

  test("IT posts on the Inventory record's Notes tab, and Finance sees it", async ({ page }) => {
    await login(page, IT);
    await page.goto(`/inventory/${ids[MID]}/notes`);
    await expect(page).toHaveTitle(`Notes · ${MID} · CRIS`);
    await expect(page.getByRole("navigation", { name: "Record sections" }).getByRole("link", { name: /^Notes/ })).toContainText("1");
    // the shared thread Finance started is here too
    await expect(noteBy(page, "L. Domingo")).toBeVisible();
    const box = page.getByRole("textbox", { name: "Add a note" });
    await waitForHydration(box);
    await box.fill("e2e: IT swapped the charger under warranty");
    await page.getByRole("button", { name: "Post", exact: true }).click();
    await expect(noteBy(page, "J. Sarmiento")).toContainText("swapped the charger", { timeout: 20_000 });

    await login(page, FINANCE);
    await page.goto(`/finance/assets/${ids[MID]}?tab=notes`);
    const itNote = noteBy(page, "J. Sarmiento");
    await expect(itNote).toContainText("swapped the charger");
    await expect(itNote).toContainText("IT");
    // newest first
    await expect(notesList(page).getByRole("article").first()).toHaveAccessibleName(/^Note by J\. Sarmiento/);
  });

  test("attachments: a PDF and a PNG upload, list, filter and preview inline; the record's Documents groups them", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, FINANCE);
    await page.goto(`/finance/assets/${ids[MID]}?tab=files`);
    await expect(main(page).getByText("No attachments yet", { exact: true })).toBeVisible();
    const upload = page.getByRole("region", { name: "Upload an attachment" });
    const kind = upload.getByLabel("Kind", { exact: true });
    await waitForHydration(kind);

    // a phone photo over the 4 MB cap is refused in the browser, in the server's words; nothing is staged or sent
    await kind.selectOption({ label: "Photo" });
    await upload.getByLabel("Attachment file").setInputFiles({ name: "IMG_2041.jpg", mimeType: "image/jpeg", buffer: Buffer.alloc(4_000_001) });
    await expect(upload.getByRole("alert")).toContainText("Too big — the cap is 4 MB");
    await expect(upload.getByRole("button", { name: "Upload", exact: true })).toHaveCount(0);

    await kind.selectOption({ label: "Quotation" });
    await upload.getByLabel("Attachment file").setInputFiles(PDF);
    await upload.getByRole("button", { name: "Upload", exact: true }).click();
    await expect(page.getByText("Attachment uploaded — audit entry written")).toBeVisible({ timeout: 20_000 });
    const list = page.getByRole("list", { name: "Attachments" });
    await expect(list).toContainText("delivery-receipt.pdf", { timeout: 20_000 });
    await expect(upload.getByRole("button", { name: "Choose file", exact: true })).toBeFocused();

    await upload.getByLabel("Kind", { exact: true }).selectOption({ label: "Photo" });
    await upload.getByLabel("Attachment file").setInputFiles({ name: "e2e-photo.png", mimeType: "image/png", buffer: PNG });
    await upload.getByRole("button", { name: "Upload", exact: true }).click();
    await expect(list).toContainText("e2e-photo.png", { timeout: 20_000 });
    await expect(assetTabs(page).getByRole("link", { name: /^Attachments/ })).toContainText("2");

    const rows = await db.assetDocument.findMany({ where: { assetId: ids[MID], kind: { startsWith: "attachment:" } }, select: { kind: true, size: true, fileName: true } });
    expect(rows.map((r) => r.kind).sort()).toEqual(["attachment:photo", "attachment:quotation"]);
    expect(rows.find((r) => r.fileName === "e2e-photo.png")?.size).toBe(PNG.length);
    expect(rows.find((r) => r.fileName === "delivery-receipt.pdf")?.size).toBe(readFileSync(PDF).length);

    // the PDF previews in a titled frame from the inline route
    await list.getByRole("link", { name: /delivery-receipt\.pdf/ }).click();
    const frame = page.locator('iframe[title="Preview of delivery-receipt.pdf"]');
    await expect(frame).toBeVisible({ timeout: 15_000 });
    const src = (await frame.getAttribute("src"))!;
    expect(src).toContain("inline=1");
    const inline = await page.request.get(src);
    expect(inline.status()).toBe(200);
    expect(inline.headers()["content-disposition"]).toMatch(/^inline;/);
    expect(inline.headers()["content-type"]).toContain("application/pdf");

    // the PNG previews as an image that loads
    await list.getByRole("link", { name: /e2e-photo\.png/ }).click();
    const img = page.getByRole("img", { name: "e2e-photo.png", exact: true });
    await expect(img).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(1);

    // the kind filter
    await page.getByRole("navigation", { name: "Attachment kind" }).getByRole("link", { name: /^Photo/ }).click();
    await expect(page).toHaveURL(/ak=photo/, { timeout: 15_000 });
    await expect(list.getByRole("link")).toHaveCount(1);
    await expect(list).toContainText("e2e-photo.png");

    // the Inventory record's Documents tab lists them under Attachments
    await login(page, IT);
    await page.goto(`/inventory/${ids[MID]}/documents`);
    await expect(page.getByRole("heading", { name: "Attachments", level: 2 })).toBeVisible();
    const grouped = page.getByRole("list", { name: "Attachments" });
    await expect(grouped).toContainText("delivery-receipt.pdf");
    await expect(grouped).toContainText("e2e-photo.png");
    await expect(grouped).toContainText("Quotation");
  });

  test("history: the notes with their source and Details; the person filter; Export log downloads a CSV", async ({ page }) => {
    await login(page, FINANCE);
    await page.goto(`/finance/assets/${ids[MID]}?tab=history&hk=notes`);
    await expect(page.getByRole("navigation", { name: "Kind" }).getByRole("link", { name: /^Notes/ })).toHaveAttribute("aria-current", "true");
    await expect(main(page).getByText("Entries are written automatically and can't be edited or deleted.")).toBeVisible();
    const history = page.getByRole("list", { name: "Financial history" });
    await expect(history.getByRole("article", { name: /^L\. Domingo added a note/ })).toBeVisible();
    await expect(history.getByRole("article", { name: /^L\. Domingo replied to a note/ })).toBeVisible();
    await expect(history.getByRole("article", { name: /^L\. Domingo marked a note resolved/ })).toBeVisible();
    await expect(history.getByRole("article", { name: /^L\. Domingo reopened a note/ })).toBeVisible();
    const itEntry = history.getByRole("article", { name: /^J\. Sarmiento added a note/ });
    await expect(itEntry).toContainText("(IT)");
    await expect(itEntry).toContainText("Web app");

    const details = itEntry.getByRole("button", { name: "Details", exact: true });
    await waitForHydration(details);
    await details.click();
    await expect(details).toHaveAttribute("aria-expanded", "true");
    await expect(itEntry).toContainText(/AUD-\d{8}-[A-Z0-9]{6}/);
    await expect(itEntry).toContainText("Done through");
    await expect(itEntry).toContainText(IT);

    const person = page.getByRole("combobox", { name: "Person" });
    await waitForHydration(person);
    await person.selectOption({ label: "J. Sarmiento" });
    await expect(page).toHaveURL((u) => u.searchParams.get("hw") === users[IT], { timeout: 15_000 });
    await expect(history.getByRole("article")).toHaveCount(1);
    await expect(page.getByRole("navigation", { name: "History pages" })).toContainText("1–1 of 1");

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "Export log", exact: true }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(new RegExp(`^asset-${MID}-history-.*\\.csv$`));
    const csv = readFileSync((await download.path())!, "utf8");
    expect(csv).toContain("Reference,Exact time,Who,Role,Kind,What");
    expect(csv).toContain("J. Sarmiento");
    expect(csv).not.toContain("L. Domingo");
  });

  test("at 375 px the left panel stacks above the tabs and nothing scrolls sideways", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await login(page, FINANCE);
    for (const tab of ["ledger", "notes", "files", "history"]) {
      await page.goto(`/finance/assets/${ids[MID]}?tab=${tab}`);
      const panel = page.getByRole("complementary", { name: "Asset summary" });
      await expect(panel).toBeVisible();
      const p = (await panel.boundingBox())!;
      const t = (await assetTabs(page).boundingBox())!;
      expect(p.y + p.height, `${tab}: the panel above the tabs`).toBeLessThanOrEqual(t.y + 1);
      expect(await noSidewaysScroll(page), `${tab}: no sideways scroll`).toBe(true);
    }
    // the phone top bar carries the compact CRIS mark, not the old BR logo
    const bar = page.locator("header", { has: page.getByRole("button", { name: "Open menu" }) });
    await expect(bar.getByText("CRIS", { exact: true })).toBeVisible();
    await expect(bar.getByText("BR", { exact: true })).toHaveCount(0);
  });
});

// ── the shell ──────────────────────────────────────────────────────────────────────────────────────────────────

const sidebarOf = (page: Page) => page.getByRole("complementary", { name: "Primary" });

test.describe("the shell", () => {
  test("Disposal shows Cris at Work: the words cycle, the theme follows, reduced motion holds on reading, the sidebar stays clickable, no sideways scroll at 375 px", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, FINANCE);
    await page.goto("/finance/assets");
    await sidebarOf(page).getByRole("link", { name: "Disposal", exact: true }).click();
    await expect(page).toHaveURL(/\/finance\/disposal$/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Disposal", level: 1 })).toBeVisible();
    await expect(main(page).getByRole("heading", { name: "Currently working on it", level: 2 })).toBeVisible();
    await expect(main(page).getByText("Recording disposals and their value will come here.", { exact: true })).toBeVisible();
    await expect(main(page).getByRole("img", { name: /^Cris, the gold orb, at her desk/ })).toBeVisible();
    await expect(main(page).getByText("Still in development", { exact: true })).toHaveCount(0);
    await expect(page).toHaveTitle("Disposal · CRIS");

    // the phase cycle runs (a new task every 6 s); the line is plain text, not a live region
    const scene = main(page).locator(".caw");
    await waitForHydration(scene);
    const doing = scene.locator("p.caw-doing");
    const lines = [
      "Cris is coding the new screens.", "Cris is debugging a stubborn error.", "Cris is reading up on the rules.",
      "Cris is taking a quick coffee break.", "Cris is waiting for her Claude limit to reset.",
    ];
    const first = (await doing.textContent()) ?? "";
    expect(lines).toContain(first);
    expect(await doing.getAttribute("aria-live")).toBeNull();
    await expect(doing).not.toHaveText(first, { timeout: 10_000 });
    expect(lines).toContain((await doing.textContent()) ?? "");

    // the theme follows <html data-theme> live
    await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
    await expect(scene).toHaveAttribute("data-theme", "dark");
    await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
    await expect(scene).toHaveAttribute("data-theme", "light");

    // reduced motion: one calm phase, reading
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    await waitForHydration(scene);
    await expect(doing).toHaveText("Cris is reading up on the rules.");
    await expect(scene.locator(".caw-stage")).toHaveClass(/caw-ph-reading/);
    await page.emulateMedia({ reducedMotion: null });

    // at 375 px the scene shrinks to fit and nothing scrolls sideways
    await page.setViewportSize({ width: 375, height: 812 });
    await page.reload();
    await expect(main(page).getByRole("heading", { name: "Currently working on it", level: 2 })).toBeVisible();
    expect(await noSidewaysScroll(page)).toBe(true);
    const box = await main(page).getByRole("img", { name: /^Cris, the gold orb/ }).boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 375).toBe(true);
    await page.setViewportSize({ width: 1280, height: 900 });

    // the scene is only the page's body: the sidebar still works from here
    await page.reload();
    await waitForHydration(sidebarOf(page).getByRole("link", { name: "Depreciation", exact: true }));
    await sidebarOf(page).getByRole("link", { name: "Depreciation", exact: true }).click();
    await expect(page).toHaveURL(/\/finance\/depreciation$/, { timeout: 15_000 });

    await login(page, IT);
    await expect(sidebarOf(page).getByRole("link", { name: "Disposal", exact: true })).toHaveCount(0);
    await page.goto("/finance/disposal");
    expect(new URL(page.url()).pathname.startsWith("/finance")).toBe(false);
  });

  test("the sidebar and the rail say CRIS, with no BR mark; the collapse animates, and is instant under reduced motion", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page, FINANCE);
    await page.goto("/finance/assets");
    const sidebar = sidebarOf(page);
    await expect(sidebar.getByText("CRIS", { exact: true })).toBeVisible();
    await expect(sidebar.getByText("Backroom IT")).toHaveCount(0);
    await expect(sidebar.getByText("BR", { exact: true })).toHaveCount(0);

    const shell = page.locator("[data-sidebar]");
    await expect(shell).toHaveAttribute("data-sidebar", "full");
    await expect(shell).not.toHaveAttribute("data-sidebar-anim", /.*/);
    // record every data-sidebar-anim value the shell takes, and the panel's transition while it animates
    const watch = () =>
      page.evaluate(() => {
        const w = window as unknown as { __anim: Array<{ anim: string | null; transition: string }> };
        w.__anim = [];
        const el = document.querySelector("[data-sidebar]")!;
        new MutationObserver(() => {
          const panel = document.querySelector(".sidebar-panel");
          w.__anim.push({ anim: el.getAttribute("data-sidebar-anim"), transition: panel ? getComputedStyle(panel).transitionProperty : "" });
        }).observe(el, { attributes: true, attributeFilter: ["data-sidebar-anim"] });
      });
    const seen = () => page.evaluate(() => (window as unknown as { __anim: Array<{ anim: string | null; transition: string }> }).__anim);

    const collapse = sidebar.getByRole("button", { name: "Collapse sidebar", exact: true });
    await waitForHydration(collapse);
    await watch();
    await collapse.click();
    await expect(shell).toHaveAttribute("data-sidebar", "rail");
    await expect(shell).not.toHaveAttribute("data-sidebar-anim", /.*/, { timeout: 5_000 });
    const anims = await seen();
    expect(anims.map((a) => a.anim)).toEqual(expect.arrayContaining(["hide", "show"]));
    expect(anims.find((a) => a.anim === "hide")?.transition).toContain("width");
    // the rail's mark is the app name too
    await expect(sidebar.getByText("CRIS", { exact: true })).toBeVisible();

    await page.emulateMedia({ reducedMotion: "reduce" });
    await watch();
    await sidebar.getByRole("button", { name: "Expand sidebar", exact: true }).click();
    await expect(shell).toHaveAttribute("data-sidebar", "full");
    await page.waitForTimeout(800);
    expect((await seen()).filter((a) => a.anim !== null)).toEqual([]);
    await expect(shell).not.toHaveAttribute("data-sidebar-anim", /.*/);
  });

  test("person A's dark theme stays theirs: B signs in on the same browser and gets light; A gets dark back", async ({ page }) => {
    const theme = async () => (await page.context().cookies()).find((c) => c.name === "br.theme")?.value;
    await login(page, FINANCE);
    await page.goto("/finance/assets");
    const toggle = page.getByRole("button", { name: "Switch to dark theme", exact: true });
    await waitForHydration(toggle);
    await toggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect
      .poll(async () => ((await db.userPreference.findUnique({ where: { userId_key: { userId: users[FINANCE], key: "ui:prefs" } } }))?.value as { theme?: string } | undefined)?.theme)
      .toBe("dark");
    expect(await theme()).toBe("dark");

    // B (IT, no saved settings) on the same browser: the cookies are rewritten to B's defaults
    await login(page, IT);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light", { timeout: 20_000 });
    expect(await theme()).toBe("light");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    // A again: their own dark comes back
    await login(page, FINANCE);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark", { timeout: 20_000 });
    expect(await theme()).toBe("dark");
  });

  test("Cris's chat is gone after Sign out and back in; its messages stay for the usage counts", async ({ page }) => {
    test.setTimeout(120_000);
    await db.crisConversation.deleteMany({ where: { userId: users[IT] } });
    await db.rateEvent.deleteMany({ where: { userId: users[IT] } });
    const box = () => page.getByRole("dialog", { name: "Chat with Cris" });
    const openBox = async () => {
      const mascot = page.getByRole("button", { name: /^Chat with Cris/ });
      await waitForHydration(mascot);
      await mascot.click();
      await expect(box()).toBeVisible();
    };

    await login(page, IT);
    await page.goto("/");
    await openBox();
    const field = box().getByRole("textbox", { name: "Your message" });
    await field.fill("Check Marites Bautista's items");
    await field.press("Enter");
    await expect(box().getByRole("log")).toContainText("Marites Bautista has 4 items:", { timeout: 30_000 });
    // the chat survives a reload: what follows is the sign-out's doing
    await page.reload();
    await openBox();
    await expect(box().getByRole("log")).toContainText("Marites Bautista has 4 items:");
    await page.keyboard.press("Escape");

    const messages0 = await db.crisMessage.count({ where: { conversation: { userId: users[IT] } } });
    expect(messages0).toBeGreaterThan(0);
    const account = sidebarOf(page).getByRole("button", { name: "Account menu", exact: true });
    await waitForHydration(account);
    await account.click();
    await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
    await page.waitForURL((u) => u.pathname.startsWith("/login"), { timeout: 20_000 });

    await login(page, IT);
    await page.goto("/");
    await openBox();
    await expect(box()).toContainText("what do you need?");
    await expect(box().getByRole("log")).not.toContainText("Marites Bautista has 4 items:");
    const convs = await db.crisConversation.findMany({ where: { userId: users[IT] }, select: { clearedAt: true } });
    expect(convs.length).toBeGreaterThan(0);
    expect(convs.every((c) => c.clearedAt !== null)).toBe(true);
    expect(await db.crisMessage.count({ where: { conversation: { userId: users[IT] } } })).toBe(messages0);
    await db.crisConversation.deleteMany({ where: { userId: users[IT] } });
  });
});

// ── axe (its own describe) ─────────────────────────────────────────────────────────────────────────────────────

test.describe("axe — the Finance pages, Disposal and the record's Notes, Attachments and Documents, light and dark", () => {
  test("every page and tab passes axe in light and dark", async ({ page }) => {
    test.setTimeout(420_000);
    const id = ids[AXE_ASSET];
    // a thread with a reply and a resolved one, and one attachment row, so the tabs render their lists
    const thread = await db.assetNote.create({ data: { assetId: id, authorId: users[FINANCE], authorLabel: "L. Domingo", body: "e2e axe: open thread" } });
    await db.assetNote.create({ data: { assetId: id, parentId: thread.id, authorId: users[IT], authorLabel: "J. Sarmiento", body: "e2e axe: a reply" } });
    await db.assetNote.create({
      data: { assetId: id, authorId: users[IT], authorLabel: "J. Sarmiento", body: "e2e axe: resolved thread", resolvedAt: new Date(), resolvedById: users[FINANCE] },
    });
    await db.assetDocument.create({
      data: { assetId: id, kind: "attachment:other", fileName: "e2e-axe.pdf", path: "e2e/missing-e2e-axe.pdf", checksum: "0", size: 1234, uploadedById: users[FINANCE] },
    });

    const finance = [
      "/finance/assets", "/finance/assets?cls=PURCHASING", "/finance/disposal",
      `/finance/assets/${id}`, `/finance/assets/${id}?year=all`, `/finance/assets/${id}?tab=notes`,
      `/finance/assets/${id}?tab=files`, `/finance/assets/${id}?tab=history`,
    ];
    const record = [`/inventory/${id}/notes`, `/inventory/${id}/attachments`, `/inventory/${id}/documents`];
    const problems: string[] = [];
    for (const [email, paths] of [[FINANCE, finance], [IT, record]] as const) {
      await login(page, email);
      for (const theme of ["light", "dark"] as const) {
        await setCookie(page, "br.theme", theme);
        for (const p of paths) {
          // Disposal's scene cross-fades its words every 6 s; axe would read a mid-fade line as low contrast. Under
          // reduced motion it holds still (the same colours), so that page is checked that way.
          await page.emulateMedia({ reducedMotion: p === "/finance/disposal" ? "reduce" : null });
          await page.goto(p);
          await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
          await expect(main(page)).toBeVisible();
          problems.push(...(await axeProblems(page, `${p} (${theme})`)));
        }
      }
    }
    expect(problems, "axe (moderate and above)").toEqual([]);
  });
});
