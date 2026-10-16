import { test, expect, type Locator, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { SEED_PASSWORD } from "../prisma/fixtures";
import { SIDE_TAB_KEY, sideBadges } from "../src/lib/side-card";
import { notYetCount } from "../src/lib/it-setup";

/**
 * Phase 39 — no long scrolls (spec §7.2).
 *   1 (§2.1) the profile's right column is one card with four tabs: EMP-0042's badges match the database; the
 *     tab row moves with ←/→ (wrapping) and Home/End; the remembered tab survives a reload; `?side=setup`
 *     overrides the memory.
 *   2 (§2.2) notes: a person with 1 note (no footer), then 4, then 25 (made via prisma). The card shows the 3
 *     newest, "3 newest of 25" and "View all 25 →"; the panel shows 20, then "Load 20 older" gives 25; the search
 *     and "Written by" narrow; `?notes=1` reopens it; Edit from a note's ⋯ menu saves. The page with 25 notes is
 *     within 40 px of its height with 4 (the card at full size: 3 notes and the footer), and the Notes tab panel
 *     itself within 2 px.
 *   4 (§3) the purchase conversation: a request with 12 messages shows the 5 newest and "Earlier messages (7) →";
 *     the panel shows all 12 oldest first, "Kind" and the search narrow; `?thread=1` reopens it. A second request
 *     with 31 messages pages 30, then "Load 30 more" gives 31. Both requests stay behind (NoteEntry is
 *     append-only and Restrict-linked); the next reseed truncates them.
 *   5 (§4.1) the stocktake sheet: 55 extra items in a test category (via prisma) under an all-categories stocktake
 *     page 50 at a time. A count typed on page 1 is in the database the moment "Next page" lands, and one typed
 *     before ticking "Only uncounted" likewise; Only uncounted then leaves both lines out and "{n} still to count"
 *     drops by two, with focus kept on the checkbox. "-2" blocks "Next page" with a message at the box; Enter on a
 *     count under Only uncounted moves focus to the next row before the counted one drops out. The search (focus
 *     kept, also on "No item matches.") and Category narrow. The review pages too, keeps its totals over every line, and
 *     "Only differences" narrows. The stocktake, the items and the category are deleted afterwards.
 *
 * Seed (prisma/seed.ts): J. Sarmiento is it@ (it_staff), System Admin is admin@. Bluepeak Telecom's base policy has
 * four required lines, so a fresh client hire's Equipment card is four tiles tall. Never reference a raw cuid.
 */

const db = new PrismaClient();

test.beforeAll(() => {
  execSync("npm run db:seed", { timeout: 120_000 });
});
test.afterAll(async () => {
  await db.$disconnect();
});

// Copied from e2e/clients-profile.spec.ts — house rule: never import helpers across spec files.
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
const ADMIN = "admin@thebackroomop.com";

const LABELS = { notes: "Notes", setup: "IT setup", form: "Form", transfers: "Transfers" } as const;

test.describe("Phase 39 — the profile side card and its notes", () => {
  test("1. one card, four tabs: EMP-0042's badges, keyboard switching, the remembered tab and ?side=setup", async ({ page }) => {
    test.setTimeout(90_000);
    const emp = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0042" } });
    const badges = sideBadges({
      notes: await db.employeeNote.count({ where: { employeeId: emp.id } }),
      notYet: notYetCount(emp),
      signed: (await db.acknowledgement.count({ where: { employeeId: emp.id } })) > 0,
      transfers: await db.employeeTransfer.count({ where: { employeeId: emp.id } }),
    });
    const tabName = (t: keyof typeof LABELS) => (badges[t] ? `${LABELS[t]} ${badges[t]!.text}` : LABELS[t]);
    const tablist = page.getByRole("tablist", { name: "About this person" });
    const tab = (t: keyof typeof LABELS) => tablist.getByRole("tab", { name: tabName(t), exact: true });

    await login(page, IT);
    await page.goto(`/employees/${emp.id}`);
    await waitForHydration(tab("notes"));

    // The badges, and Notes first (nothing remembered in a fresh context).
    for (const t of ["notes", "setup", "form", "transfers"] as const) await expect(tab(t)).toBeVisible();
    await expect(tablist.getByRole("tab")).toHaveCount(4);
    await expect(tab("notes")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tabpanel", { name: tabName("notes"), exact: true })).toBeVisible();

    // Roving focus: → moves and selects, ← wraps from the first to the last, Home and End jump.
    await tab("notes").focus();
    await page.keyboard.press("ArrowRight");
    await expect(tab("setup")).toBeFocused();
    await expect(tab("setup")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("combobox", { name: "Argus" })).toBeVisible();
    await page.keyboard.press("End");
    await expect(tab("transfers")).toBeFocused();
    await expect(tab("transfers")).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Home");
    await expect(tab("notes")).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(tab("transfers")).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(tab("form")).toBeFocused();
    await expect(tab("form")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("button", { name: "Print form", exact: true })).toBeVisible();
    // Only the chosen tab is in the Tab order.
    await expect(tab("form")).toHaveAttribute("tabindex", "0");
    await expect(tab("notes")).toHaveAttribute("tabindex", "-1");

    // The memory: Form survives a reload.
    expect(await page.evaluate((key) => window.localStorage.getItem(key), SIDE_TAB_KEY)).toBe("form");
    await page.reload();
    await waitForHydration(tab("form"));
    await expect(tab("form")).toHaveAttribute("aria-selected", "true", { timeout: 15_000 });
    await expect(tab("notes")).toHaveAttribute("aria-selected", "false");

    // A link's ?side=setup wins over the remembered Form.
    await page.goto(`/employees/${emp.id}?side=setup`);
    await waitForHydration(tab("setup"));
    await expect(tab("setup")).toHaveAttribute("aria-selected", "true", { timeout: 15_000 });
    await expect(page.getByRole("combobox", { name: "Argus" })).toBeVisible();
  });

  test("2. notes: 3 in the card, the panel pages 20 then 25, search and Written by narrow, ⋯ Edit saves, the page does not grow", async ({ page }) => {
    test.setTimeout(150_000);
    const stamp = Date.now();
    const it = await db.user.findUniqueOrThrow({ where: { email: IT } });
    const admin = await db.user.findUniqueOrThrow({ where: { email: ADMIN } });
    const dept = await db.department.findUniqueOrThrow({ where: { name: "Bluepeak Telecom" } });
    const name = `E2E Long notes ${stamp}`;
    const person = await db.employee.create({
      data: {
        employeeNo: `EMP-${String(stamp).slice(-6)}${Math.floor(Math.random() * 10)}`,
        name, title: "Agent", departmentId: dept.id, joinedAt: new Date(),
      },
    });
    const DAY = 86_400_000;
    const now = Date.now();

    // Both measurements at the desktop two-column layout, the one the spec's "about one screen" is about.
    await page.setViewportSize({ width: 1440, height: 900 });
    const tablist = page.getByRole("tablist", { name: "About this person" });
    const notesTab = (n: number) => tablist.getByRole("tab", { name: `Notes ${n}`, exact: true });
    const card = page.getByRole("tabpanel", { name: /^Notes \d+$/ });
    const pageHeight = () => page.evaluate(() => document.documentElement.scrollHeight);
    const cardHeight = () => card.evaluate((el) => el.getBoundingClientRect().height);
    // Short, same-length texts, so no note wraps differently from another and the two heights compare like for like.
    const tag = String(stamp).slice(-6);
    const text = (i: number) => (i % 5 === 0 ? `Needs a new charger, note ${i} ${tag}` : `Routine check, note ${i} ${tag}`);
    const addNotes = (from: number, to: number) =>
      db.employeeNote.createMany({
        data: Array.from({ length: to - from + 1 }, (_, k) => from + k).map((i) => ({
          employeeId: person.id,
          authorId: i % 6 === 0 ? admin.id : it.id,
          text: text(i),
          createdAt: new Date(now - i * DAY),
        })),
      });

    // One note: no footer, no View all.
    await db.employeeNote.create({
      data: { employeeId: person.id, authorId: it.id, text: `Oldest note ${stamp}`, createdAt: new Date(now - 40 * DAY) },
    });
    await login(page, IT);
    await page.goto(`/employees/${person.id}`);
    await waitForHydration(notesTab(1));
    await expect(card.getByRole("listitem")).toHaveCount(1);
    await expect(card.getByText(/newest of/)).toHaveCount(0);
    await expect(card.getByRole("button", { name: /^View all/ })).toHaveCount(0);

    // Four notes: the card at its full size (3 notes and the footer) — the height baseline. Notes i = 21..23 are
    // 21–23 days old, so the ones added next are all newer.
    await addNotes(21, 23);
    await page.reload();
    await waitForHydration(notesTab(4));
    await expect(card.getByRole("listitem")).toHaveCount(3);
    await expect(card.getByText("3 newest of 4", { exact: true })).toBeVisible();
    await expect(card.getByRole("button", { name: "View all 4 →", exact: true })).toBeVisible();
    const fourNotesPage = await pageHeight();
    const fourNotesCard = await cardHeight();

    // 21 more (25 in all), one a day back from today. Over the 24 dated notes admin wrote every 6th (4), every 5th
    // mentions a charger (5), and the newest is both.
    await addNotes(0, 20);
    await page.reload();
    await waitForHydration(notesTab(25));

    // The card: the 3 newest, the footer, and ⋯ only where this user may act (admin's newest note has none).
    const items = card.getByRole("listitem");
    await expect(items).toHaveCount(3);
    await expect(items.nth(0)).toContainText(text(0));
    await expect(items.nth(1)).toContainText(text(1));
    await expect(items.nth(2)).toContainText(text(2));
    await expect(card.getByText("3 newest of 25", { exact: true })).toBeVisible();
    const viewAll = card.getByRole("button", { name: "View all 25 →", exact: true });
    await expect(viewAll).toBeVisible();
    await expect(items.nth(0).getByRole("button", { name: "Note actions", exact: true })).toHaveCount(0);
    await expect(items.nth(1).getByRole("button", { name: "Note actions", exact: true })).toBeVisible();

    // The page does not grow with the log, and neither does the card.
    expect(Math.abs((await pageHeight()) - fourNotesPage)).toBeLessThanOrEqual(40);
    expect(Math.abs((await cardHeight()) - fourNotesCard)).toBeLessThanOrEqual(2);

    // The panel: 20, then Load 20 older gives 25, under Manila month headings.
    await viewAll.click();
    const panel = page.getByRole("dialog", { name: `Notes — ${name}`, exact: true });
    await expect(panel).toBeVisible();
    await expect(page).toHaveURL(/[?&]notes=1/);
    const rows = panel.getByRole("listitem");
    await expect(rows).toHaveCount(20, { timeout: 15_000 });
    await expect(panel.getByText("25 notes · newest first · showing 20", { exact: true })).toBeVisible();
    const month = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(now));
    await expect(panel.getByRole("heading", { name: month, exact: true })).toBeVisible();
    await panel.getByRole("button", { name: "Load 20 older", exact: true }).click();
    await expect(rows).toHaveCount(25, { timeout: 15_000 });
    await expect(panel.getByText("25 notes · newest first · showing 25", { exact: true })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Load 20 older", exact: true })).toHaveCount(0);
    await expect(rows.last()).toContainText(`Oldest note ${stamp}`);

    // The search narrows (case-insensitive), then "Written by" narrows, then both; nothing matching says so.
    const search = panel.getByLabel("Search the notes", { exact: true });
    await search.fill("CHARGER");
    await expect(panel.getByText("5 of 25 notes match", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(rows).toHaveCount(5);
    await search.fill("");
    await expect(panel.getByText("25 notes · newest first · showing 20", { exact: true })).toBeVisible({ timeout: 15_000 });
    const writtenBy = panel.getByRole("combobox", { name: "Written by", exact: true });
    await writtenBy.selectOption({ label: "System Admin" });
    await expect(panel.getByText("4 of 25 notes match", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(rows).toHaveCount(4);
    await search.fill("charger");
    await expect(panel.getByText("1 of 25 notes match", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(text(0));
    await search.fill(`no such words ${stamp}`);
    await expect(panel.getByText("No note matches.", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(rows).toHaveCount(0);

    // ?notes=1 reopens the panel after a refresh; Esc closes it, drops the parameter and returns focus.
    await page.reload();
    await expect(panel).toBeVisible({ timeout: 20_000 });
    await expect(rows).toHaveCount(20, { timeout: 15_000 });
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(page).not.toHaveURL(/[?&]notes=1/);
    await expect(viewAll).toBeFocused();

    // Edit from the ⋯ menu, inline in the card.
    const edited = `Charger arrived, note 1 ${stamp}`;
    await items.nth(1).getByRole("button", { name: "Note actions", exact: true }).click();
    await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
    const box = card.getByLabel("Edited text", { exact: true });
    await expect(box).toBeFocused();
    await box.fill(edited);
    await card.getByRole("button", { name: "Save", exact: true }).click();
    await expect(items.nth(1)).toContainText(edited, { timeout: 15_000 });
    await expect(items.nth(1)).toContainText("edited");
    const saved = await db.employeeNote.findFirstOrThrow({ where: { employeeId: person.id, text: edited } });
    expect(saved.editedAt).not.toBeNull();
  });
});

test.describe("Phase 39 — the purchase conversation", () => {
  test("4. a request with 12 messages shows the newest 5 and Earlier messages (7); the panel shows all 12 and Kind filters; 31 pages 30 then 31", async ({ page }) => {
    test.setTimeout(120_000);
    const stamp = Date.now();
    const tag = String(stamp).slice(-6);
    const it = await db.user.findUniqueOrThrow({ where: { email: IT } });
    const purchasing = await db.user.findUniqueOrThrow({ where: { email: "purchasing@thebackroomop.com" } });
    const dept = await db.department.findUniqueOrThrow({ where: { name: "Bluepeak Telecom" } });
    const DAY = 86_400_000;
    const now = Date.now();

    // NoteEntry is append-only (a database trigger) and a request that has notes cannot be deleted
    // (onDelete: Restrict), so these two requests stay behind; every spec file reseeds, which truncates them.
    const twelve = await db.purchaseRequest.create({
      data: {
        refNo: `PR-9${tag}`, state: "IT_REVIEWED", requestedById: purchasing.id, departmentId: dept.id,
        submittedAt: new Date(now - 13 * DAY), reviewedAt: new Date(now - 12 * DAY), reviewedById: it.id,
      },
    });
    // Oldest first: SUBMIT, IT_REVIEW, then ten comments (4 and 8 mention the invoice). One note a day, ending yesterday.
    const kindOf = (i: number) => (i === 0 ? "SUBMIT" : i === 1 ? "IT_REVIEW" : "COMMENT") as "SUBMIT" | "IT_REVIEW" | "COMMENT";
    const textOf = (i: number) =>
      i === 0 ? `Submitted for review ${tag}` : i === 1 ? `Specs confirmed ${tag}` : i % 4 === 0 ? `Comment ${i} about the invoice ${tag}` : `Comment ${i} ${tag}`;
    const dates = Array.from({ length: 12 }, (_, i) => new Date(now - (12 - i) * DAY));
    await db.noteEntry.createMany({
      data: dates.map((createdAt, i) => ({
        requestId: twelve.id, authorId: i % 2 === 0 ? purchasing.id : it.id, kind: kindOf(i), text: textOf(i), createdAt,
      })),
    });

    await login(page, IT);
    await page.goto(`/purchases/${twelve.id}`);
    const thread = page.locator("#thread").getByRole("listitem");
    const earlier = page.getByRole("button", { name: "Earlier messages (7) →", exact: true });
    await waitForHydration(earlier);

    // The page: the 5 newest, in time order, and the link to the other 7.
    await expect(thread).toHaveCount(5);
    await expect(thread.nth(0)).toContainText(`Comment 7 ${tag}`);
    await expect(thread.nth(4)).toContainText(`Comment 11 ${tag}`);
    await expect(page.getByLabel("Add a comment", { exact: true })).toBeVisible();

    // The panel: all 12 (under 30), oldest first, under Manila month headings.
    await earlier.click();
    const panel = page.getByRole("dialog", { name: `Conversation — ${twelve.refNo}`, exact: true });
    await expect(panel).toBeVisible();
    await expect(page).toHaveURL(/[?&]thread=1/);
    const rows = panel.getByRole("listitem");
    await expect(rows).toHaveCount(12);
    await expect(rows.first()).toContainText(`Submitted for review ${tag}`);
    await expect(rows.last()).toContainText(`Comment 11 ${tag}`);
    await expect(panel.getByText("12 messages · oldest first · showing 12", { exact: true })).toBeVisible();
    await expect(panel.getByRole("button", { name: /^Load \d+ more$/ })).toHaveCount(0);
    const monthFmt = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "Asia/Manila" });
    for (const m of new Set(dates.map((d) => monthFmt.format(d)))) {
      await expect(panel.getByRole("heading", { name: m, exact: true })).toBeVisible();
    }

    // Kind: Status changes (2), Comments (10), back to All; the search narrows within a kind; nothing matching says so.
    const kind = panel.getByRole("combobox", { name: "Kind", exact: true });
    await kind.selectOption({ label: "Status changes" });
    await expect(rows).toHaveCount(2);
    await expect(panel.getByText("2 of 12 messages match", { exact: true })).toBeVisible();
    await kind.selectOption({ label: "Comments" });
    await expect(rows).toHaveCount(10);
    await expect(panel.getByText("10 of 12 messages match", { exact: true })).toBeVisible();
    const search = panel.getByLabel("Search the conversation", { exact: true });
    await search.fill("INVOICE");
    await expect(rows).toHaveCount(2);
    await expect(panel.getByText("2 of 12 messages match", { exact: true })).toBeVisible();
    await kind.selectOption({ label: "Status changes" });
    await expect(rows).toHaveCount(0);
    await expect(panel.getByText("No message matches.", { exact: true })).toBeVisible();
    await search.fill("");
    await kind.selectOption({ label: "All" });
    await expect(rows).toHaveCount(12);

    // ?thread=1 reopens the panel after a refresh; Esc closes it, drops the parameter and returns focus.
    await page.reload();
    await expect(panel).toBeVisible({ timeout: 20_000 });
    await expect(rows).toHaveCount(12);
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(page).not.toHaveURL(/[?&]thread=1/);
    await expect(earlier).toBeFocused();

    // 31 messages: the panel shows 30, then "Load 30 more" gives 31 and the button goes.
    const long = await db.purchaseRequest.create({
      data: { refNo: `PR-8${tag}`, state: "DRAFT", requestedById: purchasing.id, departmentId: dept.id },
    });
    await db.noteEntry.createMany({
      data: Array.from({ length: 31 }, (_, i) => ({
        requestId: long.id, authorId: purchasing.id, kind: "COMMENT" as const, text: `Long thread ${i} ${tag}`,
        createdAt: new Date(now - (31 - i) * 3_600_000),
      })),
    });
    await page.goto(`/purchases/${long.id}`);
    const earlierLong = page.getByRole("button", { name: "Earlier messages (26) →", exact: true });
    await waitForHydration(earlierLong);
    await expect(page.locator("#thread").getByRole("listitem")).toHaveCount(5);
    await earlierLong.click();
    const longPanel = page.getByRole("dialog", { name: `Conversation — ${long.refNo}`, exact: true });
    await expect(longPanel).toBeVisible();
    const longRows = longPanel.getByRole("listitem");
    await expect(longRows).toHaveCount(30);
    await expect(longPanel.getByText("31 messages · oldest first · showing 30", { exact: true })).toBeVisible();
    await longPanel.getByRole("button", { name: "Load 30 more", exact: true }).click();
    await expect(longRows).toHaveCount(31);
    await expect(longPanel.getByRole("button", { name: "Load 30 more", exact: true })).toHaveCount(0);
    await expect(longRows.last()).toContainText(`Long thread 30 ${tag}`);
    // Focus moved to the first message the button revealed, not to the page behind the drawer.
    await expect(longRows.last()).toBeFocused();
  });
});

test.describe("Phase 39 — the stocktake sheet", () => {
  test("5. an all-categories stocktake over 60+ items pages 50; typed counts are saved before navigating; Only uncounted, search and Category narrow; the review pages with Only differences", async ({ page }) => {
    test.setTimeout(150_000);
    const tag = String(Date.now()).slice(-6);
    const cat = await db.stockCategory.create({ data: { name: `Bulk ${tag}`, prefix: `B${tag}` } });
    await db.stockItem.createMany({
      data: Array.from({ length: 55 }, (_, i) => ({
        code: `ZZ-${tag}-${String(i + 1).padStart(4, "0")}`, name: `Bulk item ${i + 1} ${tag}`, unit: "pc", categoryId: cat.id,
      })),
    });
    try {
      await login(page, "purchasing@thebackroomop.com");
      await page.goto("/stock/stocktakes/new");
      const scope = page.getByLabel("Scope");
      await waitForHydration(scope);
      await scope.selectOption({ label: "All categories" });
      await page.getByRole("button", { name: "Open stocktake" }).click();
      await page.waitForURL(/\/stock\/stocktakes\/(?!new)[^/?]+$/, { timeout: 20_000 });
      const st = await db.stocktake.findFirstOrThrow({ where: { state: "OPEN", categoryId: null }, orderBy: { openedAt: "desc" } });

      // The app's own order (item code), read the same way.
      const lines = await db.stocktakeLine.findMany({
        where: { stocktakeId: st.id }, orderBy: { item: { code: "asc" } },
        select: { id: true, itemId: true, bookQty: true, item: { select: { code: true, categoryId: true } } },
      });
      const total = lines.length;
      expect(total).toBeGreaterThan(50);
      const code = (i: number) => lines[i].item.code;
      const counted = (i: number) => page.getByRole("spinbutton", { name: `Counted ${code(i)}`, exact: true });
      const inputs = page.getByRole("spinbutton", { name: /^Counted / });
      const pager = page.getByRole("navigation", { name: "Pagination" });

      // Page 1: 50 lines, the whole stocktake still to count, and a page 2.
      await waitForHydration(counted(0));
      await expect(inputs).toHaveCount(50);
      await expect(page.getByText(`${total} still to count`, { exact: true })).toBeVisible();
      await expect(page.getByText(`0/${total} counted`, { exact: true })).toBeVisible();
      await expect(pager.getByRole("link", { name: "2", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Category", exact: true })).toBeVisible();

      // A count typed on page 1, then straight to "Next page" (no blur first): it is saved before the page changes.
      await counted(0).fill("7");
      await pager.getByRole("link", { name: "Next page", exact: true }).click();
      await expect(page).toHaveURL(/[?&]page=2(&|$)/);
      expect((await db.stocktakeLine.findUniqueOrThrow({ where: { id: lines[0].id } })).countedQty).toBe(7);
      await expect(inputs).toHaveCount(total - 50);
      await expect(counted(total - 1)).toBeVisible();
      await expect(counted(0)).toHaveCount(0);

      // Back on page 1 the count is there. Another typed count, then "Only uncounted": saved before the filter applies.
      await pager.getByRole("link", { name: "Previous page", exact: true }).click();
      await expect(counted(0)).toHaveValue("7");
      await waitForHydration(counted(1));
      await counted(1).fill("3");
      await page.getByRole("checkbox", { name: "Only uncounted", exact: true }).click();
      await expect(page).toHaveURL(/[?&]uncounted=1/);
      expect((await db.stocktakeLine.findUniqueOrThrow({ where: { id: lines[1].id } })).countedQty).toBe(3);
      await expect(counted(0)).toHaveCount(0);
      await expect(counted(1)).toHaveCount(0);
      await expect(counted(2)).toBeVisible();
      await expect(page.getByText(`${total - 2} still to count`, { exact: true })).toBeVisible();
      await expect(page.getByText(`2/${total} counted`, { exact: true })).toBeVisible();
      await expect(page.getByRole("checkbox", { name: "Only uncounted", exact: true })).toBeChecked();
      // The toolbar is not remounted by the navigation: focus stays on the control just used.
      await expect(page.getByRole("checkbox", { name: "Only uncounted", exact: true })).toBeFocused();

      // Something that is not a count blocks the page change, with the message at the box and focus on it.
      await counted(2).fill("-2");
      await pager.getByRole("link", { name: "Next page", exact: true }).click();
      await expect(page.getByText("A whole number, zero or more", { exact: true })).toBeVisible();
      await expect(counted(2)).toBeFocused();
      await expect(page).not.toHaveURL(/[?&]page=2(&|$)/);

      // Enter under Only uncounted moves focus to the next row before the counted row drops out.
      await counted(2).fill("5");
      await counted(2).press("Enter");
      await expect(counted(3)).toBeFocused();
      await expect(counted(2)).toHaveCount(0);
      await expect(counted(3)).toBeFocused();
      expect((await db.stocktakeLine.findUniqueOrThrow({ where: { id: lines[2].id } })).countedQty).toBe(5);
      await expect(page.getByText(`${total - 3} still to count`, { exact: true })).toBeVisible();

      // The search (code or name) narrows, keeping Only uncounted.
      const search = page.getByRole("searchbox", { name: "Search the stocktake", exact: true });
      await waitForHydration(search);
      await search.fill(`bulk item 55 ${tag}`);
      await search.press("Enter");
      await expect(page).toHaveURL(/[?&]q=/);
      await expect(inputs).toHaveCount(1);
      await expect(search).toBeFocused();
      await expect(page.getByRole("spinbutton", { name: `Counted ZZ-${tag}-0055`, exact: true })).toBeVisible();
      await search.fill("no such item anywhere");
      await search.press("Enter");
      await expect(page.getByText("No item matches.", { exact: true })).toBeVisible();
      await expect(search).toBeFocused();

      // Category narrows to that category's lines.
      await page.goto(`/stock/stocktakes/${st.id}`);
      const categoryBtn = page.getByRole("button", { name: "Category", exact: true });
      await waitForHydration(categoryBtn);
      await categoryBtn.click();
      const categoryDialog = page.getByRole("dialog", { name: "Filter by Category" });
      await categoryDialog.locator("label", { hasText: "Pantry" }).click();
      await categoryDialog.getByRole("button", { name: "Apply", exact: true }).click();
      await expect(page).toHaveURL(/[?&]cat=/);
      const pantry = await db.stockCategory.findUniqueOrThrow({ where: { name: "Pantry" } });
      await expect(inputs).toHaveCount(lines.filter((l) => l.item.categoryId === pantry.id).length);
      await expect(pager).toHaveCount(0);

      // The review pages the same way; its totals stay over every line; Only differences narrows.
      const sums = await db.stockMovement.groupBy({
        by: ["itemId"], where: { itemId: { in: lines.map((l) => l.itemId) } }, _sum: { quantity: true },
      });
      const now = new Map(sums.map((x) => [x.itemId, x._sum.quantity ?? 0]));
      const countedQty = new Map([[lines[0].id, 7], [lines[1].id, 3], [lines[2].id, 5]]);
      const withDiff = lines.filter((l) => countedQty.has(l.id) && countedQty.get(l.id) !== (now.get(l.itemId) ?? 0)).length;
      const moved = lines.filter((l) => (now.get(l.itemId) ?? 0) !== l.bookQty).length;
      await page.goto(`/stock/stocktakes/${st.id}?view=review`);
      const summary = page.getByText(/items counted/);
      await expect(summary).toBeVisible({ timeout: 20_000 });
      expect((await summary.innerText()).replace(/\s+/g, " ").trim()).toBe(
        `3 items counted · ${withDiff} with a difference · ${total - 3} not counted · ${moved} moved since opening`,
      );
      const reviewRows = page.getByRole("table").getByRole("row");
      await expect(reviewRows).toHaveCount(51);
      await expect(pager.getByRole("link", { name: "2", exact: true })).toBeVisible();
      const onlyDiff = page.getByRole("checkbox", { name: "Only differences", exact: true });
      await waitForHydration(onlyDiff);
      await onlyDiff.click();
      await expect(page).toHaveURL(/[?&]diff=1/);
      await expect(page).toHaveURL(/[?&]view=review/);
      if (withDiff > 0) await expect(reviewRows).toHaveCount(withDiff + 1);
      else await expect(page.getByText("No item matches.", { exact: true })).toBeVisible();
      await expect(pager).toHaveCount(0);
      expect((await summary.innerText()).replace(/\s+/g, " ").trim()).toContain(`${total - 3} not counted`);
    } finally {
      // Every stocktake holding a line on these items (found by the lines, so a run that failed before the id was
      // read still cleans up) goes first: its lines go with it (Cascade) and they Restrict the items. Nothing was
      // posted, so the items have no movements.
      await db.stocktake.deleteMany({ where: { lines: { some: { item: { categoryId: cat.id } } } } });
      await db.stockItem.deleteMany({ where: { categoryId: cat.id } });
      await db.stockCategory.delete({ where: { id: cat.id } });
    }
  });
});
