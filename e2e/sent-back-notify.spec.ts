import { test, expect, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { login } from "./fixtures/login";

/**
 * The quiet "Sent back" chip and the missing notifications (plan docs/superpowers/plans/2026-10-23-sent-back-chip-and-
 * notifications.md), end to end:
 *   1  Finance sends an IT asset back: IT's bell shows it; Inventory's chip "Sent back · 1" opens IT's Sent back view
 *      (selected there; a second click clears it). Purchasing, Finance and the viewer get no chip.
 *   2  IT marks it corrected: the chip is gone, and Finance's bell has "… to check again"
 *   3  Finance approves it: IT's bell has "{tag}: Finance accepted the correction"
 *   4  the admin's bell sums every team (3), its tabs hold one each, and each item names its team; /notifications
 *      reads All teams or one; the admin's Mark all read leaves IT's and Finance's unread counts as they were
 *   5  Finance approves a group of 4 corrected IT assets at once: IT gets one "4 corrections accepted by Finance"
 *   6  Finance approves a PO's last asset: Purchasing's bell has "{ref}: Finance approved all its assets"
 *   7  the chip counts by team, not class: an IT asset sent to Purchasing is Purchasing's, a Purchasing asset sent to
 *      IT is IT's; the admin sees one chip per team
 *   8  axe (moderate and above) on Inventory with the chip, and on the admin's open bell, light and dark
 *
 * Fixtures: field updates on seeded assets (BR-HS-0502, BR-HS-0501, BR-FN-0003), and rows this file creates — a
 * group of 4 corrected IT laptops (with the return-then-resubmit audit rows a correction leaves) and a one-laptop PO
 * waiting for Finance. A fresh seed has no notifications, so every bell count here is exact. The next file reseeds.
 */

const db = new PrismaClient();

const ADMIN = "admin@thebackroomop.com";
const IT = "it@thebackroomop.com";
const PURCHASING = "purchasing@thebackroomop.com";
const FINANCE = "finance@thebackroomop.com";
const VIEWER = "viewer@thebackroomop.com";

const TAG = "BR-HS-0502";
const GROUP_TAGS = ["BR-LT-7961", "BR-LT-7962", "BR-LT-7963", "BR-LT-7964"];
const PO_REF = "PO-0991";
const PO_TAG = "BR-LT-7991";

const users: Record<string, string> = {};
const ids = { asset: "", group: "", po: "", poAsset: "" };

test.beforeAll(async () => {
  execSync("npm run db:seed", { timeout: 120_000 });
  for (const email of [ADMIN, IT, PURCHASING, FINANCE]) users[email] = (await db.user.findUniqueOrThrow({ where: { email } })).id;
  await db.userPreference.deleteMany({ where: { key: "ui:prefs" } });
  expect(await db.notification.count(), "a fresh seed has no notifications").toBe(0);

  // The main asset: IT-checked, with Finance, nothing flagged.
  const main = await db.asset.update({
    where: { tag: TAG },
    data: {
      financeConfirmedAt: null, financeConfirmedById: null, financeReturnedAt: null, financeReturnedById: null,
      financeReturnedTo: null, financeReturnReason: null, financeReturnFields: [], financeResubmitNote: null,
      financeNotCapitalised: false,
    },
  });
  ids.asset = main.id;
  expect(main.cost, `${TAG} has a cost, so Finance's Approve is the plain one`).not.toBeNull();

  const laptop = await db.assetCategory.findFirstOrThrow({ where: { name: "Laptop", cls: "IT" } });
  const now = Date.now();

  // Case 5: a registration group of 4 IT laptops, each sent back to IT and resubmitted by IT — corrected.
  const group = await db.purchaseRecord.create({
    data: { cls: "IT", quantity: GROUP_TAGS.length, createdById: users[IT], unitCost: 52_000, invoiceRef: "SI-7960" },
  });
  ids.group = group.id;
  for (const [i, tag] of GROUP_TAGS.entries()) {
    const a = await db.asset.create({
      data: {
        tag, model: "Latitude 5450 (e2e group)", categoryId: laptop.id, cls: "IT", status: "SPARE",
        serial: `SN-SBN-796${i + 1}`, cost: 52_000, itVerifiedAt: new Date(now - 60 * 60_000), itVerifiedById: users[IT],
        purchaseRecordId: group.id, financeResubmitNote: "Fixed the serial",
      },
    });
    await db.auditEntry.create({
      data: {
        actorId: users[FINANCE], actorLabel: "L. Domingo", entityType: "asset", entityId: a.id, action: "finance.return",
        diff: { financeReturn: { from: null, to: { team: "IT", fields: ["serial"] } } }, source: "web",
        createdAt: new Date(now - 30 * 60_000),
      },
    });
    await db.auditEntry.create({
      data: {
        actorId: users[IT], actorLabel: "J. Sarmiento", entityType: "asset", entityId: a.id, action: "finance.resubmit",
        diff: { financeReturn: { from: "returned", to: null } }, source: "web", createdAt: new Date(now - 20 * 60_000),
      },
    });
  }

  // Case 6: a PO with one laptop line, registered, IT-checked, waiting for Finance — its last asset.
  const po = await db.purchaseOrder.create({
    data: {
      refNo: PO_REF, state: "READY", requestedById: users[PURCHASING], invoiceRef: "SI-0991",
      purchasedAt: new Date(now - 3 * 86_400_000),
      lines: { create: [{ description: "Laptop for the e2e PO", categoryId: laptop.id, qty: 1, unitPrice: 48_000 }] },
    },
    include: { lines: true },
  });
  ids.po = po.id;
  const record = await db.purchaseRecord.create({
    data: { cls: "IT", quantity: 1, createdById: users[IT], purchaseOrderId: po.id, unitCost: 48_000 },
  });
  const poAsset = await db.asset.create({
    data: {
      tag: PO_TAG, model: "Latitude 5450 (e2e PO)", categoryId: laptop.id, cls: "IT", status: "SPARE",
      serial: "SN-SBN-7991", cost: 48_000, invoiceRef: "SI-0991", itVerifiedAt: new Date(), itVerifiedById: users[IT],
      purchaseOrderId: po.id, purchaseOrderLineId: po.lines[0].id, purchaseRecordId: record.id,
    },
  });
  ids.poAsset = poAsset.id;
});

test.afterAll(async () => {
  await db.userPreference.deleteMany({ where: { key: "ui:prefs" } });
  await db.$disconnect();
});

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
/** As e2e/po-intake.spec.ts runs it: moderate and above count, and so does any promoted rule. */
async function axeProblems(page: Page, label: string): Promise<string[]> {
  await page.waitForTimeout(700);
  const results = await new AxeBuilder({ page }).analyze();
  return results.violations
    .filter((v) =>
      v.impact === "moderate" || v.impact === "serious" || v.impact === "critical" || PROMOTED_RULES.has(v.id))
    .map((v) => `${label}: ${v.id} (${v.impact}) ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

const toast = (page: Page, text: string | RegExp) => page.locator("[data-toast-id]").filter({ hasText: text });
const bell = (page: Page) => page.getByRole("button", { name: /^Notifications, \d+ unread$/ });
const bellPanel = (page: Page) => page.getByRole("dialog", { name: "Notifications" });
/** The chip row's own landmark: absent when there are no chips. */
const chips = (page: Page) => page.getByRole("navigation", { name: "Sent back", exact: true });
const chip = (page: Page, name: string | RegExp) =>
  chips(page).getByRole("link", typeof name === "string" ? { name, exact: true } : { name });
const row = (page: Page, tag: string) => page.getByRole("row", { name: new RegExp(tag) });

/** The bell's unread count, polled: it is read on every navigation, so a reload settles it. */
async function expectBell(page: Page, unread: number) {
  await expect(bell(page)).toHaveAccessibleName(`Notifications, ${unread} unread`, { timeout: 20_000 });
}

/** Opens the bell's panel (retried until the bell has hydrated). */
async function openBell(page: Page) {
  await waitForHydration(bell(page));
  await expect(async () => {
    if ((await bell(page).getAttribute("aria-expanded")) !== "true") await bell(page).click();
    await expect(bellPanel(page)).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  return bellPanel(page);
}

/** Picks a tab of the open panel and waits for its items. */
async function bellTab(panel: Locator, name: string) {
  await panel.getByRole("tab", { name, exact: true }).click();
  await expect(panel.getByRole("tab", { name, exact: true })).toHaveAttribute("aria-selected", "true");
  const body = panel.getByRole("tabpanel");
  await expect(body).not.toHaveAttribute("aria-busy", "true");
  return body;
}

/** No chip on Inventory: the default list and the IT list. */
async function expectNoChip(page: Page, who: string) {
  for (const path of ["/inventory", "/inventory?cls=IT"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(chips(page), `${who} on ${path}`).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^Sent back · \d/ }), `${who} on ${path}`).toHaveCount(0);
  }
}

// ── the round trip, and who hears what ─────────────────────────────────────────────────────────────────────────────

test.describe("a send-back and its correction, through everyone's bell", () => {
  test.describe.configure({ mode: "serial" });

  test("1 · Finance sends an IT asset back; IT's bell has it; the chip opens IT's Sent back view", async ({ page }) => {
    test.setTimeout(240_000);
    await login(page, FINANCE);
    await page.goto(`/finance/assets/${ids.asset}`);
    const review = page.getByRole("region", { name: "Review" });
    const sendBack = review.getByRole("button", { name: "Send back…" });
    await waitForHydration(sendBack);
    await sendBack.click();
    const dialog = page.getByRole("dialog", { name: `Send ${TAG} back` });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Cost", { exact: true }).check();
    await dialog.getByLabel("Send to").selectOption("IT");
    await dialog.getByLabel("Note for IT").fill("The cost is the box price");
    await dialog.getByRole("button", { name: "Send back to IT", exact: true }).click();
    await expect(toast(page, `Sent ${TAG} back to IT`)).toBeVisible({ timeout: 30_000 });

    await login(page, IT);
    await page.goto("/inventory");
    await expectBell(page, 1);
    const panel = await openBell(page);
    const sentBackTab = await bellTab(panel, "Sent back");
    await expect(sentBackTab.getByRole("link", { name: new RegExp(`${TAG} sent back by Finance: Cost`) })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();

    // the quiet chip, not a banner: no status role, and it opens IT's Sent back view
    await expect(page.getByRole("status").filter({ hasText: /need correction|sent them back/i })).toHaveCount(0);
    const c = chip(page, "Sent back · 1");
    await expect(c).toBeVisible();
    await expect(c).not.toHaveAttribute("aria-current", "page");
    await waitForHydration(c);
    await c.click();
    await page.waitForURL((url) => url.searchParams.get("reg") === "needs-correction" && url.searchParams.get("to") === "IT");
    await expect(row(page, TAG)).toBeVisible();
    await expect(chip(page, "Sent back · 1")).toHaveAttribute("aria-current", "page");
    // a second click clears the view
    await chip(page, "Sent back · 1").click();
    await page.waitForURL((url) => url.pathname === "/inventory" && !url.searchParams.has("reg"));
    await expect(chip(page, "Sent back · 1")).not.toHaveAttribute("aria-current", "page");

    // Purchasing never counts IT's send-back; Finance (who sent it) and the viewer (who can fix nothing) see no chip
    await login(page, PURCHASING);
    await expectNoChip(page, "Purchasing");
    await login(page, FINANCE);
    await expectNoChip(page, "Finance");
    await login(page, VIEWER);
    await page.goto("/inventory");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(chips(page)).toHaveCount(0);
  });

  test("2 · IT marks it corrected: the chip is gone, and Finance's bell has it to check again", async ({ page }) => {
    test.setTimeout(150_000);
    await login(page, IT);
    await page.goto("/inventory?reg=needs-correction");
    const mark = row(page, TAG).getByRole("button", { name: "Mark corrected…" });
    await waitForHydration(mark);
    await mark.click();
    const resubmit = page.getByRole("dialog", { name: `Mark ${TAG} corrected?` });
    await expect(resubmit).toBeVisible();
    await resubmit.getByLabel("Reply to Finance").fill("Cost is per unit now");
    await resubmit.getByRole("button", { name: "Send to Finance" }).click();
    await expect(page.getByText(`${TAG} sent back to Finance`)).toBeVisible({ timeout: 30_000 });

    await page.goto("/inventory");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(chips(page)).toHaveCount(0);

    await login(page, FINANCE);
    await page.goto("/finance/review");
    await expectBell(page, 1);
    const panel = await openBell(page);
    const toCheck = await bellTab(panel, "To check");
    await expect(toCheck.getByRole("link", { name: new RegExp(`${TAG} corrected by IT, to check again`) })).toBeVisible();
    await expect(toCheck).toContainText("Cost is per unit now");
  });

  test("3 · Finance approves it: IT's bell has Finance accepted the correction", async ({ page }) => {
    test.setTimeout(150_000);
    await login(page, FINANCE);
    await page.goto(`/finance/assets/${ids.asset}`);
    await expect(page.getByText("IT replied: “Cost is per unit now”")).toBeVisible();
    const approve = page.getByRole("region", { name: "Review" }).getByRole("button", { name: "Approve", exact: true });
    await waitForHydration(approve);
    await approve.click();
    await expect.poll(async () => (await db.asset.findUniqueOrThrow({ where: { id: ids.asset } })).financeConfirmedAt !== null,
      { timeout: 20_000 }).toBe(true);

    await login(page, IT);
    await page.goto("/inventory");
    await expectBell(page, 2);
    const panel = await openBell(page);
    const changed = await bellTab(panel, "Changed");
    const accepted = changed.getByRole("link", { name: new RegExp(`${TAG}: Finance accepted the correction`) });
    await expect(accepted).toBeVisible();
    await expect(accepted).toHaveAttribute("href", `/inventory/${ids.asset}`);
    // IT is not the actor's team, and nobody else heard of it
    expect(await db.notification.count({ where: { title: `${TAG}: Finance accepted the correction` } })).toBe(1);
  });

  test("4 · the admin's bell reads every team; the admin's Mark all read is the admin's own", async ({ page }) => {
    test.setTimeout(180_000);
    await login(page, ADMIN);
    await page.goto("/");
    await expectBell(page, 3);
    const panel = await openBell(page);
    const items = (body: Locator) => body.getByRole("listitem");

    const all = await bellTab(panel, "All");
    await expect(items(all)).toHaveCount(3);
    const expected: Array<[RegExp, string]> = [
      [new RegExp(`${TAG} sent back by Finance: Cost`), "IT"],
      [new RegExp(`${TAG} corrected by IT, to check again`), "Finance"],
      [new RegExp(`${TAG}: Finance accepted the correction`), "IT"],
    ];
    for (const [title, team] of expected) {
      const link = all.getByRole("link", { name: title });
      await expect(link).toBeVisible();
      await expect(link.getByText(team, { exact: true }), `${title} names ${team}`).toBeVisible();
    }
    // each tab holds its one
    for (const [tab, title] of [["Sent back", expected[0][0]], ["To check", expected[1][0]], ["Changed", expected[2][0]]] as const) {
      const body = await bellTab(panel, tab);
      await expect(items(body), `${tab} tab`).toHaveCount(1);
      await expect(body.getByRole("link", { name: title })).toBeVisible();
    }
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();

    // /notifications: All teams by default, or one team
    await page.goto("/notifications");
    const main = page.getByRole("main");
    await expect(page.getByLabel("Team", { exact: true })).toHaveValue("");
    for (const [title] of expected) await expect(main.getByRole("link", { name: title })).toBeVisible();
    await page.getByLabel("Team", { exact: true }).selectOption({ label: "IT" });
    await page.getByRole("button", { name: "Show", exact: true }).click();
    await page.waitForURL(/[?&]team=IT/);
    await expect(main.getByRole("link", { name: expected[0][0] })).toBeVisible();
    await expect(main.getByRole("link", { name: expected[2][0] })).toBeVisible();
    await expect(main.getByRole("link", { name: expected[1][0] })).toHaveCount(0);

    // Mark all read, across every team: the admin's own reads only
    await page.goto("/notifications");
    const markAll = page.getByRole("button", { name: "Mark all read" });
    await waitForHydration(markAll);
    await markAll.click();
    await expect(toast(page, "3 notifications marked read")).toBeVisible({ timeout: 20_000 });
    await page.reload();
    await expectBell(page, 0);
    expect(await db.notificationRead.count({ where: { userId: { not: users[ADMIN] } } })).toBe(0);

    await login(page, IT);
    await page.goto("/notifications");
    await expectBell(page, 2);
    await login(page, FINANCE);
    await page.goto("/notifications");
    await expectBell(page, 1);
  });

  test("5 · a group of 4 corrected assets approved: IT gets one '4 corrections accepted by Finance'", async ({ page }) => {
    test.setTimeout(150_000);
    await login(page, FINANCE);
    await page.goto(`/finance/review/${ids.group}`);
    const approve = page.getByRole("button", { name: "Approve 4", exact: true });
    await waitForHydration(approve);
    await approve.click();
    await expect.poll(async () => db.asset.count({ where: { tag: { in: GROUP_TAGS }, financeConfirmedAt: { not: null } } }),
      { timeout: 30_000 }).toBe(4);

    // one for the team, never one per asset
    const groupIds = (await db.asset.findMany({ where: { tag: { in: GROUP_TAGS } }, select: { id: true } })).map((a) => a.id);
    expect(await db.notification.count({ where: { entityType: "asset", entityId: { in: groupIds } } })).toBe(0);
    const collapsed = await db.notification.findMany({ where: { title: "4 corrections accepted by Finance" } });
    expect(collapsed.map((n) => [n.team, n.kind, n.href])).toEqual([["IT", "CHANGED", "/inventory"]]);

    await login(page, IT);
    await page.goto("/inventory");
    await expectBell(page, 3);
    const panel = await openBell(page);
    const changed = await bellTab(panel, "Changed");
    await expect(changed.getByRole("link", { name: /4 corrections accepted by Finance/ })).toBeVisible();
    for (const tag of GROUP_TAGS) await expect(changed.getByRole("link", { name: new RegExp(tag) })).toHaveCount(0);
  });

  test("6 · Finance approving a PO's last asset tells Purchasing", async ({ page }) => {
    test.setTimeout(150_000);
    await login(page, FINANCE);
    await page.goto(`/finance/assets/${ids.poAsset}`);
    const approve = page.getByRole("region", { name: "Review" }).getByRole("button", { name: "Approve", exact: true });
    await waitForHydration(approve);
    await approve.click();
    await expect.poll(async () => (await db.purchaseOrder.findUniqueOrThrow({ where: { id: ids.po } })).completedAt !== null,
      { timeout: 30_000 }).toBe(true);

    await login(page, PURCHASING);
    await page.goto("/purchases");
    await expectBell(page, 1);
    const panel = await openBell(page);
    const changed = await bellTab(panel, "Changed");
    const done = changed.getByRole("link", { name: new RegExp(`${PO_REF}: Finance approved all its assets`) });
    await expect(done).toBeVisible();
    await expect(done).toHaveAttribute("href", `/purchases/${ids.po}`);
  });
});

// ── the chip counts by team, not class ─────────────────────────────────────────────────────────────────────────────

test.describe("7 · the chip counts by the team an asset was sent to", () => {
  test("an IT asset sent to Purchasing is Purchasing's; a Purchasing asset sent to IT is IT's; the admin sees each", async ({ page }) => {
    test.setTimeout(240_000);
    const returned = { financeReturnedAt: new Date(), financeReturnedById: users[FINANCE], financeReturnFields: ["cost"], financeReturnReason: "e2e: by team" };
    await db.asset.update({ where: { tag: "BR-HS-0501" }, data: { ...returned, financeConfirmedAt: null, financeReturnedTo: "PURCHASING" } });
    await db.asset.update({ where: { tag: "BR-FN-0003" }, data: { ...returned, financeConfirmedAt: null, financeReturnedTo: "IT" } });

    await login(page, IT);
    await page.goto("/inventory");
    await expect(chip(page, "Sent back · 1")).toBeVisible();
    await page.goto("/inventory?reg=needs-correction&to=IT");
    await expect(row(page, "BR-FN-0003")).toBeVisible();
    await expect(row(page, "BR-HS-0501")).toHaveCount(0);

    await login(page, PURCHASING);
    for (const path of ["/inventory", "/inventory?cls=IT"]) {
      await page.goto(path);
      await expect(chip(page, "Sent back · 1"), path).toBeVisible();
    }
    await chip(page, "Sent back · 1").click();
    await page.waitForURL((url) => url.searchParams.get("to") === "PURCHASING");
    await expect(row(page, "BR-HS-0501")).toBeVisible();
    await expect(row(page, "BR-FN-0003")).toHaveCount(0);

    await login(page, ADMIN);
    await page.goto("/inventory");
    await expect(chips(page).getByRole("link")).toHaveCount(2);
    await expect(chip(page, /^Sent back · 1\s*· IT$/)).toBeVisible();
    await expect(chip(page, /^Sent back · 1\s*· Purchasing$/)).toBeVisible();
  });
});

// ── accessibility ───────────────────────────────────────────────────────────────────────────────────────────────────

test.describe("8 · accessibility", () => {
  test("axe on Inventory with the chip, and on the admin's open bell, light and dark", async ({ page }) => {
    test.setTimeout(240_000);
    // a send-back to IT, so IT's chip shows whatever ran before
    await db.asset.update({
      where: { tag: "BR-FN-0003" },
      data: {
        financeReturnedAt: new Date(), financeReturnedById: users[FINANCE], financeReturnedTo: "IT",
        financeReturnFields: ["cost"], financeReturnReason: "e2e: axe", financeConfirmedAt: null,
      },
    });
    const problems: string[] = [];

    await login(page, IT);
    for (const theme of ["light", "dark"] as const) {
      await setCookie(page, "br.theme", theme);
      await page.goto("/inventory");
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(chips(page).getByRole("link").first()).toBeVisible();
      problems.push(...(await axeProblems(page, `Inventory with the chip (${theme})`)));
    }

    await login(page, ADMIN);
    for (const theme of ["light", "dark"] as const) {
      await setCookie(page, "br.theme", theme);
      await page.goto("/");
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      const panel = await openBell(page);
      await expect(panel.getByRole("tabpanel")).not.toHaveAttribute("aria-busy", "true");
      problems.push(...(await axeProblems(page, `admin bell panel (${theme})`)));
      await page.keyboard.press("Escape");
      await expect(panel).toBeHidden();
    }
    expect(problems, "axe (moderate and above)").toEqual([]);
  });
});
