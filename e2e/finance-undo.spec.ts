import { test, expect, type Locator, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import { SEED_PASSWORD } from "../prisma/fixtures";
import { depStartMonth, monthLabel } from "@/lib/depreciation";
import { fmtDayMonthYear, fmtMoneyExact } from "@/lib/format";

/**
 * Phase 47 follow-up (spec docs/superpowers/specs/2026-10-21-finance-sort-undo-notify-design.md): Finance sorting,
 * Undo and clearer notifications, plus the owner's additions the same day.
 *   sort      Date approved newest / oldest first with the "Approved 17 Oct 2026" line (rows with no approval last, in
 *             tag order); Date added shows "Added …"
 *   undo      Approve → the page moves to the next asset → Undo in the toast → back on the asset in To review (its
 *             history says "undid the approval"); Approve, navigate away, come back, Undo in the banner; the banner
 *             ends at its deadline (the page's clock run forward); a send-back's Undo refused after IT resubmitted
 *             (an error toast that stays); Send back → Undo; a settings change → Undo; admin Reopen with a reason
 *             (focus lands on the review box); axe on the asset page with the banner, light and dark
 *   sign-in   every sign-in lands on Home; a `next` link still wins
 *   search    Employees: "E" filters as you type, E-names first, focus and caret kept; Inventory: a pasted exact tag
 *             only filters, Enter opens it, Back returns to the list with the search kept
 *   employees Sort "Recently joined" with the "Joined 3 Mar 2025" line, newest first
 *
 * Fixtures: the Laptop category gets 36 months / 10 % for the file. Each case snapshots the review fields of the
 * seeded assets it uses and restores them in `finally`; audit rows are only ever added (the next file reseeds). Two
 * E-named employees are created for the search case and deleted in afterAll.
 */

const db = new PrismaClient();

const IT = "it@thebackroomop.com";
const FINANCE = "finance@thebackroomop.com";
const ADMIN = "admin@thebackroomop.com";

const users: Record<string, string> = {};
type Category = Awaited<ReturnType<typeof db.assetCategory.findFirstOrThrow>>;
let laptopCategory: { id: string; life: Category["depreciationLifeMonths"]; salvage: Category["depreciationSalvagePercent"] };
const createdEmployees: string[] = [];

test.beforeAll(async () => {
  execSync("npm run db:seed", { timeout: 120_000 });
  for (const email of [IT, FINANCE, ADMIN]) users[email] = (await db.user.findUniqueOrThrow({ where: { email } })).id;
  const laptop = await db.assetCategory.findFirstOrThrow({ where: { name: "Laptop", cls: "IT" } });
  laptopCategory = { id: laptop.id, life: laptop.depreciationLifeMonths, salvage: laptop.depreciationSalvagePercent };
  await db.assetCategory.update({ where: { id: laptop.id }, data: { depreciationLifeMonths: 36, depreciationSalvagePercent: 10 } });
});

test.afterAll(async () => {
  await db.assetCategory.update({
    where: { id: laptopCategory.id },
    data: { depreciationLifeMonths: laptopCategory.life, depreciationSalvagePercent: laptopCategory.salvage },
  });
  if (createdEmployees.length) await db.employee.deleteMany({ where: { id: { in: createdEmployees } } });
  await db.userPreference.deleteMany({ where: { key: "ui:prefs" } });
  await db.$disconnect();
});

// Settings follow the person (Phase 47 §5.4): a theme saved by one case would come back on the next case's sign-in.
test.beforeEach(async () => {
  await db.userPreference.deleteMany({ where: { key: "ui:prefs" } });
});

// Copied from e2e/phase-47-finance.spec.ts — house rule: never import helpers across spec files.
async function login(page: Page, email: string) {
  await page.goto("/logout");
  await page.getByRole("link", { name: /^Log in/ }).click();
  await page.locator('[data-login-ready="true"]').waitFor();
  await page.getByLabel("Work email", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Password", { exact: true }).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  // Phase 47 §5.4: the first page after a sign-in rewrites the settings cookies and refreshes; wait for it.
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
/** Opens a menu (retried until its island has hydrated) and returns the open menu. */
async function openMenu(page: Page, trigger: Locator) {
  const menu = page.getByRole("menu");
  await expect(async () => {
    if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click();
    await expect(menu).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  return menu;
}
async function setCookie(page: Page, name: string, value: string) {
  await page.context().addCookies([{ name, value, url: new URL(page.url()).origin }]);
}

const PROMOTED_RULES = new Set<string>(["empty-table-header", "page-has-heading-one", "heading-order", "landmark-unique"]);
/** As e2e/phase-47-finance.spec.ts runs it: moderate and above count, and so does any promoted rule. */
async function axeProblems(page: Page, label: string): Promise<string[]> {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(700);
  const results = await new AxeBuilder({ page }).analyze();
  return results.violations
    .filter((v) =>
      v.impact === "moderate" || v.impact === "serious" || v.impact === "critical" || PROMOTED_RULES.has(v.id))
    .map((v) => `${label}: ${v.id} (${v.impact}) ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

// ── fixtures ──────────────────────────────────────────────────────────────────────────────────────────────────

const SNAP = {
  financeConfirmedAt: true, financeConfirmedById: true, financeReturnedAt: true, financeReturnedById: true,
  financeReturnReason: true, financeReturnFields: true, financeResubmitNote: true, financeNotCapitalised: true,
  depreciationLifeMonths: true, depreciationSalvage: true, depreciationNote: true,
} as const;

async function snap(tag: string) {
  return db.asset.findUniqueOrThrow({ where: { tag }, select: { id: true, purchasedAt: true, ...SNAP } });
}
async function restore(s: Awaited<ReturnType<typeof snap>>) {
  const { id, purchasedAt: _p, ...data } = s;
  void _p;
  await db.asset.update({ where: { id }, data });
}
/** "IT-checked, with Finance, nothing flagged, no override" — plus any extras (an approval straight in the DB). */
async function reset(tag: string, extra: Record<string, unknown> = {}) {
  await db.asset.update({
    where: { tag },
    data: {
      financeConfirmedAt: null, financeConfirmedById: null, financeReturnedAt: null, financeReturnedById: null,
      financeReturnReason: null, financeReturnFields: [], financeResubmitNote: null, financeNotCapitalised: false,
      depreciationLifeMonths: null, depreciationSalvage: null, depreciationNote: null,
      ...extra,
    },
  });
}
const approvedBy = (email: string, daysAgo = 100) => ({
  financeConfirmedAt: new Date(Date.now() - daysAgo * 86_400_000), financeConfirmedById: users[email],
});
const auditCount = (entityId: string, action: string) => db.auditEntry.count({ where: { entityId, action } });
const asset = (id: string) => db.asset.findUniqueOrThrow({ where: { id } });

const toast = (page: Page, text: string | RegExp) => page.locator("[data-toast-id]").filter({ hasText: text });
const banner = (page: Page) => page.locator("[data-undo-banner]");
const review = (page: Page) => page.getByRole("region", { name: "Review" });
const assetHref = (id: string) => `/finance/assets/${id}`;

/** Opens the Finance asset page and approves it from the review box. */
async function approveOnPage(page: Page, id: string) {
  await page.goto(assetHref(id));
  const approve = review(page).getByRole("button", { name: "Approve", exact: true });
  await waitForHydration(approve);
  await approve.click();
}

// ── sorting ───────────────────────────────────────────────────────────────────────────────────────────────────

test.describe("Finance → Assets: the date sorts and the date line", () => {
  test("Date approved, newest and oldest first: approved rows by date with an Approved line; the rest last in tag order; Date added shows Added", async ({ page }) => {
    // the search "BR-LT-01" matches five laptops (all start with it, so one starts-with group in the list's sort)
    const approved = { "BR-LT-0148": 5, "BR-LT-0166": 15, "BR-LT-0181": 25 } as const;
    const unapproved = ["BR-LT-0118", "BR-LT-0122"];
    const snaps = await Promise.all([...Object.keys(approved), ...unapproved].map(snap));
    try {
      for (const [tag, days] of Object.entries(approved)) await reset(tag, approvedBy(FINANCE, days));
      for (const tag of unapproved) await reset(tag);
      const at = Object.fromEntries(
        await Promise.all(Object.keys(approved).map(async (tag) => [tag, (await db.asset.findUniqueOrThrow({ where: { tag } })).financeConfirmedAt!] as const)),
      );

      await login(page, FINANCE);
      await page.goto("/finance/assets?q=BR-LT-01");
      const sort = page.getByLabel("Sort", { exact: true });
      await waitForHydration(sort);
      await sort.selectOption({ label: "Date approved, newest first" });
      await expect(page).toHaveURL((u) => u.searchParams.get("sort") === "approved", { timeout: 15_000 });
      const tags = () => page.locator("tbody tr").evaluateAll((trs) => trs.map((tr) => tr.querySelector("td a")?.textContent?.trim() ?? ""));
      await expect.poll(tags).toEqual(["BR-LT-0148", "BR-LT-0166", "BR-LT-0181", ...unapproved]);
      for (const tag of Object.keys(approved)) {
        const row = page.locator("tbody tr").filter({ has: page.getByRole("link", { name: tag, exact: true }) });
        await expect(row.locator("[data-date-line]")).toHaveText(`Approved ${fmtDayMonthYear(at[tag])}`);
      }
      // no approval, no line
      for (const tag of unapproved) {
        const row = page.locator("tbody tr").filter({ has: page.getByRole("link", { name: tag, exact: true }) });
        await expect(row.locator("[data-date-line]")).toHaveCount(0);
      }

      await sort.selectOption({ label: "Date approved, oldest first" });
      await expect(page).toHaveURL((u) => u.searchParams.get("sort") === "approved-asc", { timeout: 15_000 });
      // nulls stay last in both directions, still in tag order
      await expect.poll(tags).toEqual(["BR-LT-0181", "BR-LT-0166", "BR-LT-0148", ...unapproved]);

      await sort.selectOption({ label: "Date added, newest first" });
      await expect(page).toHaveURL((u) => u.searchParams.get("sort") === "added", { timeout: 15_000 });
      const lines = page.locator("tbody tr [data-date-line]");
      await expect(lines).toHaveCount(5);
      await expect(lines.first()).toHaveText(/^Added \d{1,2} \w+ \d{4}$/);
    } finally {
      for (const s of snaps) await restore(s);
    }
  });
});

// ── undo ──────────────────────────────────────────────────────────────────────────────────────────────────────

test.describe("Finance review: Undo, the banner and admin Reopen", () => {
  test("Approve moves to the next asset; the toast's Undo brings the asset back to To review and opens it", async ({ page }) => {
    const tag = "BR-LT-0027";
    const s = await snap(tag);
    try {
      await reset(tag);
      const undone0 = await auditCount(s.id, "finance.confirm.undone");
      const start = depStartMonth({ purchasedAt: s.purchasedAt, financeConfirmedAt: new Date() })!;
      const [month, year] = monthLabel(start).split(" ");

      await login(page, FINANCE);
      await approveOnPage(page, s.id);
      const t = toast(page, `Approved ${tag}`);
      await expect(t).toBeVisible();
      // ₱55,000, 36 months, 10 % salvage: ₱1,375.00 a month from the purchase month
      await expect(t).toContainText(`Depreciation starts ${month.slice(0, 3)} ${year} · ${fmtMoneyExact(1375)} a month`);
      await expect(t).toContainText(/Next: BR-\S+ · \d+ left to review/);
      await expect(t.getByRole("button", { name: `Open ${tag}`, exact: true })).toBeVisible();
      // the page moved on to the next asset to review
      await page.waitForURL((u) => u.pathname.startsWith("/finance/assets/") && u.pathname !== assetHref(s.id), { timeout: 20_000 });
      await expect.poll(async () => (await asset(s.id)).financeConfirmedAt !== null).toBe(true);

      // two Undo buttons may be on screen elsewhere; this one is the toast's
      await t.getByRole("button", { name: "Undo", exact: true }).click();
      await expect(toast(page, `Undid the approval of ${tag}`)).toBeVisible({ timeout: 15_000 });
      await page.waitForURL((u) => u.pathname === assetHref(s.id), { timeout: 20_000 });
      await expect(review(page).getByRole("button", { name: "Approve", exact: true })).toBeVisible();
      await expect(banner(page)).toHaveCount(0);
      const after = await asset(s.id);
      expect(after.financeConfirmedAt).toBeNull();
      expect(after.financeConfirmedById).toBeNull();
      expect(await auditCount(s.id, "finance.confirm.undone")).toBe(undone0 + 1);

      // the Financial history keeps both lines
      await page.goto(`${assetHref(s.id)}?tab=history`);
      await expect(page.getByRole("main")).toContainText("undid the approval");
      await expect(page.getByRole("main")).toContainText("approved");
    } finally {
      await restore(s);
    }
  });

  test("Approve, go elsewhere, come back: the banner's Undo puts it back in To review", async ({ page }) => {
    const tag = "BR-LT-0031";
    const s = await snap(tag);
    try {
      await reset(tag);
      await login(page, FINANCE);
      await approveOnPage(page, s.id);
      await expect(toast(page, `Approved ${tag}`)).toBeVisible();
      await page.waitForURL((u) => u.pathname !== assetHref(s.id), { timeout: 20_000 });

      await page.goto("/finance/assets");
      await page.goto(assetHref(s.id));
      const b = banner(page);
      await expect(b).toBeVisible();
      await expect(b).toContainText(/You approved this at \d{1,2}:\d{2}/);
      await expect(b).toContainText(/\(1[45] min left\)/);
      // a real button, and the banner is not a live region
      await expect(b).not.toHaveAttribute("aria-live", /.+/);
      const undo = b.getByRole("button", { name: "Undo", exact: true });
      await waitForHydration(undo);
      await undo.click();
      await expect(toast(page, `Undid the approval of ${tag}`)).toBeVisible({ timeout: 15_000 });
      await expect(review(page).getByRole("button", { name: "Approve", exact: true })).toBeVisible({ timeout: 20_000 });
      await expect(banner(page)).toHaveCount(0);
      expect((await asset(s.id)).financeConfirmedAt).toBeNull();
    } finally {
      await restore(s);
    }
  });

  test("the banner goes at the end of the 15 minutes (the page's clock run forward)", async ({ page }) => {
    const tag = "BR-LT-0060";
    const s = await snap(tag);
    try {
      await reset(tag);
      await login(page, FINANCE);
      await approveOnPage(page, s.id);
      await expect(toast(page, `Approved ${tag}`)).toBeVisible();
      await page.waitForURL((u) => u.pathname !== assetHref(s.id), { timeout: 20_000 });

      // the banner's countdown runs on the page's own clock from the server's time left: run it past the deadline
      await page.clock.install();
      await page.goto(assetHref(s.id));
      await expect(banner(page)).toBeVisible();
      await page.clock.fastForward("14:00");
      await expect(banner(page)).toBeVisible();
      await expect(banner(page)).toContainText(/\([12] min left\)/);
      await page.clock.fastForward("01:30");
      await expect(banner(page)).toHaveCount(0);
    } finally {
      await restore(s);
    }
  });

  test("a send-back's Undo is refused once IT has resubmitted: an error toast that stays, nothing changed", async ({ page, browser }) => {
    const tag = "BR-LT-0075";
    const s = await snap(tag);
    const itContext = await browser.newContext();
    try {
      await reset(tag);
      await login(page, FINANCE);
      await page.goto(assetHref(s.id));
      const sendBack = review(page).getByRole("button", { name: "Send back to IT…" });
      await waitForHydration(sendBack);
      await sendBack.click();
      const dialog = page.getByRole("dialog", { name: `Send ${tag} back to IT` });
      await dialog.getByLabel("Cost", { exact: true }).check();
      await dialog.getByRole("button", { name: "Send back", exact: true }).click();
      await expect(toast(page, `Sent ${tag} back to IT`)).toContainText("Flagged: Cost");
      await expect(banner(page)).toContainText(/You sent this back at \d{1,2}:\d{2}/, { timeout: 20_000 });
      const undone0 = await auditCount(s.id, "asset.return.undone");

      // IT corrects it and sends it to Finance (another browser, so Finance's page stays as it was)
      const it = await itContext.newPage();
      await login(it, IT);
      await it.goto(`/inventory/${s.id}`);
      const mark = it.getByRole("button", { name: /^Mark corrected/ });
      await waitForHydration(mark);
      await mark.click();
      const resubmit = it.getByRole("dialog", { name: `Mark ${tag} corrected?` });
      await resubmit.getByLabel("Reply to Finance").fill("e2e: cost fixed");
      await resubmit.getByRole("button", { name: "Send to Finance" }).click();
      await expect(it.getByText(`${tag} sent back to Finance`)).toBeVisible();
      await expect.poll(async () => (await asset(s.id)).financeReturnedAt).toBeNull();

      // Finance's banner is only a hint: the server refuses, with the reason
      await banner(page).getByRole("button", { name: "Undo", exact: true }).click();
      const refused = page.locator('[data-toast-id][role="alert"]').filter({ hasText: "Can't undo:" });
      await expect(refused).toBeVisible({ timeout: 15_000 });
      await expect(refused).toContainText(/ at \d{1,2}:\d{2}\./);
      // an error stays until dismissed (an action toast would be gone after 10 s)
      await page.waitForTimeout(11_000);
      await expect(refused).toBeVisible();
      await refused.getByRole("button", { name: "Dismiss" }).click();
      await expect(refused).toHaveCount(0);

      expect(await auditCount(s.id, "asset.return.undone")).toBe(undone0);
      const after = await asset(s.id);
      expect(after.financeReturnedAt).toBeNull();
      expect(after.financeResubmitNote).toBe("e2e: cost fixed");
      await page.reload();
      await expect(banner(page)).toHaveCount(0);
      await expect(page.getByText("IT replied: “e2e: cost fixed”")).toBeVisible();
    } finally {
      await itContext.close();
      await restore(s);
    }
  });

  test("Send back, then Undo in the toast: back in To review with nothing flagged", async ({ page }) => {
    const tag = "BR-LT-0090";
    const s = await snap(tag);
    try {
      await reset(tag);
      const undone0 = await auditCount(s.id, "asset.return.undone");
      await login(page, FINANCE);
      await page.goto(assetHref(s.id));
      const sendBack = review(page).getByRole("button", { name: "Send back to IT…" });
      await waitForHydration(sendBack);
      await sendBack.click();
      const dialog = page.getByRole("dialog", { name: `Send ${tag} back to IT` });
      await dialog.getByLabel("Cost", { exact: true }).check();
      await dialog.getByLabel("Note for IT").fill("e2e: wrong PO");
      await dialog.getByRole("button", { name: "Send back", exact: true }).click();
      const t = toast(page, `Sent ${tag} back to IT`);
      await expect(t).toContainText("Flagged: Cost");
      await expect.poll(async () => (await asset(s.id)).financeReturnedAt !== null).toBe(true);

      await t.getByRole("button", { name: "Undo", exact: true }).click();
      await expect(toast(page, `Undid the send-back of ${tag}`)).toBeVisible({ timeout: 15_000 });
      await expect(review(page).getByRole("button", { name: "Approve", exact: true })).toBeVisible({ timeout: 20_000 });
      const after = await asset(s.id);
      expect(after.financeReturnedAt).toBeNull();
      expect(after.financeReturnFields).toEqual([]);
      expect(after.financeReturnReason).toBeNull();
      expect(await auditCount(s.id, "asset.return.undone")).toBe(undone0 + 1);
    } finally {
      await restore(s);
    }
  });

  test("a depreciation settings change, then Undo: back to the category policy; Finance has no Reopen review", async ({ page }) => {
    const tag = "BR-LT-0201";
    const s = await snap(tag);
    try {
      await reset(tag, approvedBy(FINANCE));
      const undone0 = await auditCount(s.id, "depreciation.override.undone");
      await login(page, FINANCE);
      await page.goto(`/finance/assets?fin=approved&q=${tag}`);
      const trigger = page.getByRole("button", { name: `Actions for ${tag}` });
      await waitForHydration(trigger);
      const menu = await openMenu(page, trigger);
      await menu.getByRole("menuitem", { name: "Depreciation for this asset…" }).click();
      const dialog = page.getByRole("dialog", { name: `Depreciation for ${tag}` });
      await dialog.getByLabel("Years", { exact: true }).fill("4");
      await dialog.getByLabel("Months", { exact: true }).fill("0");
      await dialog.getByLabel("Salvage (₱)").fill("0");
      await dialog.getByLabel("Reason").fill("e2e: longer life");
      await dialog.getByRole("button", { name: "Save", exact: true }).click();
      const t = toast(page, `Saved ${tag}'s depreciation settings`);
      await expect(t).toContainText(`48 months, ${fmtMoneyExact(0)} salvage`);
      await expect.poll(async () => (await asset(s.id)).depreciationLifeMonths).toBe(48);

      await t.getByRole("button", { name: "Undo", exact: true }).click();
      await expect(toast(page, `Undid the depreciation settings change of ${tag}`)).toBeVisible({ timeout: 15_000 });
      // not on the asset's page yet: Undo opens it
      await page.waitForURL((u) => u.pathname === assetHref(s.id), { timeout: 20_000 });
      const after = await asset(s.id);
      expect(after.depreciationLifeMonths).toBeNull();
      expect(after.depreciationSalvage).toBeNull();
      expect(after.depreciationNote).toBeNull();
      expect(await auditCount(s.id, "depreciation.override.undone")).toBe(undone0 + 1);
      // Reopen review is the admin's alone
      await expect(page.getByRole("button", { name: "Reopen review" })).toHaveCount(0);
    } finally {
      await restore(s);
    }
  });

  test("an admin reopens an approved review with a reason; focus lands on the review box", async ({ page }) => {
    const tag = "BR-LT-0210";
    const s = await snap(tag);
    try {
      await reset(tag, approvedBy(FINANCE));
      const reopened0 = await auditCount(s.id, "finance.confirm.reopened");
      await login(page, ADMIN);
      await page.goto(assetHref(s.id));
      const open = page.getByRole("button", { name: "Reopen review", exact: true });
      await waitForHydration(open);
      await open.click();
      const dialog = page.getByRole("dialog", { name: `Reopen ${tag}'s review` });
      await expect(dialog).toBeVisible();
      const confirm = dialog.getByRole("button", { name: "Reopen review", exact: true });
      // too short: refused on the page, nothing written
      await dialog.getByLabel(/^Reason/).fill("abc");
      await confirm.click();
      await expect(dialog).toContainText("Give a reason of 5 to 300 characters");
      expect((await asset(s.id)).financeConfirmedAt).not.toBeNull();

      await dialog.getByLabel(/^Reason/).fill("e2e: approved the wrong unit");
      await confirm.click();
      await expect(toast(page, `Reopened ${tag}'s review`)).toContainText("It is back in To review");
      await expect(dialog).toBeHidden();
      // the Reopen button goes with the approval; the review box that replaces it takes focus
      await expect(review(page)).toBeVisible({ timeout: 20_000 });
      await expect(review(page)).toBeFocused({ timeout: 10_000 });
      await expect(page.getByRole("button", { name: "Reopen review", exact: true })).toHaveCount(0);
      const after = await asset(s.id);
      expect(after.financeConfirmedAt).toBeNull();
      expect(after.financeConfirmedById).toBeNull();
      expect(await auditCount(s.id, "finance.confirm.reopened")).toBe(reopened0 + 1);
    } finally {
      await restore(s);
    }
  });
});

test.describe("axe — the Finance asset page with the Undo banner, light and dark", () => {
  test("the asset page with the banner passes axe in light and dark", async ({ page }) => {
    test.setTimeout(180_000);
    const tag = "BR-HS-0510";
    const s = await snap(tag);
    try {
      await reset(tag);
      await login(page, FINANCE);
      await approveOnPage(page, s.id);
      await expect(toast(page, `Approved ${tag}`)).toBeVisible();
      await page.waitForURL((u) => u.pathname !== assetHref(s.id), { timeout: 20_000 });
      const problems: string[] = [];
      for (const theme of ["light", "dark"] as const) {
        await setCookie(page, "br.theme", theme);
        await page.goto(assetHref(s.id));
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await expect(banner(page)).toBeVisible();
        problems.push(...(await axeProblems(page, `${assetHref("[id]")} with the banner (${theme})`)));
      }
      expect(problems, "axe (moderate and above)").toEqual([]);
    } finally {
      await restore(s);
    }
  });
});

// ── sign-in lands on Home ─────────────────────────────────────────────────────────────────────────────────────

test.describe("sign-in lands on Home", () => {
  test("a sign-in lands on Home; a `next` link the person came from still wins", async ({ page, browser }) => {
    await login(page, FINANCE);
    expect(new URL(page.url()).pathname).toBe("/");

    const { id } = await db.asset.findUniqueOrThrow({ where: { tag: "BR-LT-0148" } });
    const context = await browser.newContext();
    const fresh = await context.newPage();
    try {
      await fresh.goto(assetHref(id));
      await expect(fresh).toHaveURL(/\/login\?next=/);
      await fresh.getByRole("link", { name: /^Log in/ }).click();
      await fresh.locator('[data-login-ready="true"]').waitFor();
      await fresh.getByLabel("Work email", { exact: true }).fill(FINANCE);
      await fresh.getByRole("button", { name: "Continue", exact: true }).click();
      await fresh.getByLabel("Password", { exact: true }).fill(SEED_PASSWORD);
      await fresh.getByRole("button", { name: "Log in", exact: true }).click();
      await expect(fresh).toHaveURL((u) => u.pathname === assetHref(id), { timeout: 30_000 });
    } finally {
      await context.close();
    }
  });
});

// ── search as you type ────────────────────────────────────────────────────────────────────────────────────────

test.describe("search as you type", () => {
  test("Employees: \"E\" filters without Enter, E-names first; focus and the caret stay in the box", async ({ page }) => {
    const dept = await db.department.findUniqueOrThrow({ where: { name: "Bluepeak Telecom" } });
    const stamp = Date.now() % 100_000;
    for (const [i, name] of ["Elena Live", "Emil Live"].entries()) {
      const e = await db.employee.create({
        data: { employeeNo: `EMP-L${stamp}${i}`, name: `${name} ${stamp}`, title: "Agent", departmentId: dept.id, joinedAt: new Date("2020-01-15T04:00:00Z") },
      });
      createdEmployees.push(e.id);
    }

    await login(page, IT);
    await page.goto("/employees");
    const search = page.getByRole("searchbox", { name: "Search employees" });
    await waitForHydration(search);
    await search.click();
    await search.pressSequentially("E");
    // no Enter: the search goes out on its own after the pause
    await expect(page).toHaveURL((u) => u.searchParams.get("q") === "E", { timeout: 15_000 });
    const names = page.locator("tbody tr");
    await expect(names.nth(0)).toContainText(`Elena Live ${stamp}`);
    await expect(names.nth(1)).toContainText(`Emil Live ${stamp}`);
    await expect(search).toBeFocused();
    expect(await search.evaluate((el: HTMLInputElement) => [el.value, el.selectionStart])).toEqual(["E", 1]);

    await search.pressSequentially("l");
    await expect(page).toHaveURL((u) => u.searchParams.get("q") === "El", { timeout: 15_000 });
    await expect(names.nth(0)).toContainText(`Elena Live ${stamp}`);
    await expect(search).toBeFocused();
    expect(await search.evaluate((el: HTMLInputElement) => [el.value, el.selectionStart])).toEqual(["El", 2]);
  });

  test("Inventory: a pasted exact tag only filters; Enter opens it; Back returns to the list with the search", async ({ page }) => {
    const tag = "BR-HS-0501";
    const { id } = await db.asset.findUniqueOrThrow({ where: { tag } });
    await login(page, IT);
    await page.goto("/inventory");
    const search = page.getByRole("searchbox", { name: "Search assets" });
    await waitForHydration(search);
    await search.fill(tag);
    await expect(page).toHaveURL((u) => u.pathname === "/inventory" && u.searchParams.get("q") === tag, { timeout: 15_000 });
    await expect(page.getByRole("main").getByRole("link", { name: tag, exact: true })).toBeVisible();
    // well past the pause: still the list, never the record
    await page.waitForTimeout(1_500);
    expect(new URL(page.url()).pathname).toBe("/inventory");
    await expect(search).toBeFocused();

    await search.press("Enter");
    await page.waitForURL((u) => u.pathname === `/inventory/${id}`, { timeout: 20_000 });
    await expect(page.getByRole("heading", { name: tag })).toBeVisible({ timeout: 20_000 });
    await page.goBack();
    await expect(page).toHaveURL((u) => u.pathname === "/inventory" && u.searchParams.get("q") === tag, { timeout: 20_000 });
    await expect(page.getByRole("searchbox", { name: "Search assets" })).toHaveValue(tag);
  });
});

// ── Employees: sort by joined ─────────────────────────────────────────────────────────────────────────────────

test.describe("Employees: the Sort select", () => {
  test("Recently joined: newest first, each with its Joined line; Name A–Z hides the line", async ({ page }) => {
    await login(page, IT);
    await page.goto("/employees");
    const sort = page.getByLabel("Sort", { exact: true });
    await waitForHydration(sort);
    await sort.selectOption({ label: "Recently joined" });
    await expect(page).toHaveURL((u) => u.searchParams.get("sort") === "-joinedAt", { timeout: 15_000 });

    const joined = () =>
      page.locator("tbody tr").evaluateAll((trs) => trs.map((tr) => (tr as HTMLElement).innerText.match(/Joined (\d{1,2} \S+ \d{4})/)?.[1] ?? null));
    await expect.poll(async () => (await joined()).length).toBeGreaterThan(2);
    const lines = await joined();
    expect(lines.every((l) => l !== null)).toBe(true);
    const times = lines.map((l) => Date.parse(l!.replace("Sept", "Sep")));
    expect(times.every((t) => !Number.isNaN(t))).toBe(true);
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeLessThanOrEqual(times[i - 1]);
    // the newest joiner first, with the date in Manila time
    const newest = await db.employee.findFirstOrThrow({ where: { offboardingAt: null }, orderBy: { joinedAt: "desc" } });
    await expect(page.locator("tbody tr").first()).toContainText(newest.name);
    await expect(page.locator("tbody tr").first()).toContainText(`Joined ${fmtDayMonthYear(newest.joinedAt)}`);

    await sort.selectOption({ label: "Name A–Z" });
    await expect(page).toHaveURL((u) => (u.searchParams.get("sort") ?? "name") === "name", { timeout: 15_000 });
    await expect.poll(async () => (await joined()).filter((l) => l !== null).length).toBe(0);
  });
});
