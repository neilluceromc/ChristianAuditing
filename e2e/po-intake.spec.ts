import { test, expect, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { execSync } from "node:child_process";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { SEED_PASSWORD } from "../prisma/fixtures";
import { login } from "./fixtures/login";

/**
 * Purchase orders and the three-team intake (spec docs/superpowers/specs/2026-10-21-purchase-orders-intake-design.md),
 * end to end on one mixed PO that this file creates:
 *   1  Purchasing saves a mixed PO (5 laptops + 2 office chairs); IT's bell shows 1
 *   2  IT sends it back over the unit price; Purchasing's bell rings and its Sent back tab lists it
 *   3  Purchasing corrects the price with a reply; it is With IT again
 *   4  IT registers 3 of the 5 laptops; the line reads "3 of 5 registered"; Finance's bell rings
 *   5  Finance opens the group, holds one laptop back to IT and approves 2 ("Approved 2 from PO-… · 1 held back");
 *      Undo restores all three
 *   6  Finance fixes the SI number with a reason; Purchasing's bell has it under Changed, and the asset's Financial
 *      history reads the change and the reason
 *   7  Purchasing registers the chairs line of the same PO, and can't reach /inventory/register
 *   8  a legacy PO with no SI number: Approve is refused with the message
 *   9  the notifications page: Mark all read for one IT person; a second IT person still has unread
 *   10 axe (moderate and above) on the PO page, the group review page and the open bell panel, light and dark; at
 *      375 px the top bar with the bell doesn't scroll sideways
 *
 * Fixtures: a second IT account (it2@, the seeded password) for case 9, and for case 8 a legacy PO with no SI number
 * and one laptop registered from it, waiting for Finance — all created here; the next file reseeds.
 */

const db = new PrismaClient();

const IT = "it@thebackroomop.com";
const IT2 = "it2-po-intake@thebackroomop.com";
const PURCHASING = "purchasing@thebackroomop.com";
const FINANCE = "finance@thebackroomop.com";

const LAPTOP_TAGS = ["BR-LT-7701", "BR-LT-7702", "BR-LT-7703"];
const CHAIR_TAGS = ["BR-FN-7701", "BR-FN-7702"];
const LEGACY_REF = "PO-0990";
const LEGACY_TAG = "BR-LT-7790";

const users: Record<string, string> = {};
/** The mixed PO this file creates in case 1. */
const po = { id: "", refNo: "" };

test.beforeAll(async () => {
  execSync("npm run db:seed", { timeout: 120_000 });
  const hash = await bcrypt.hash(SEED_PASSWORD, 10);
  await db.user.create({ data: { email: IT2, name: "R. Pascual", role: "it_staff", passwordHash: hash } });
  for (const email of [IT, IT2, PURCHASING, FINANCE]) users[email] = (await db.user.findUniqueOrThrow({ where: { email } })).id;
  await db.userPreference.deleteMany({ where: { key: "ui:prefs" } });
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
/** As e2e/phase-47-finance.spec.ts runs it: moderate and above count, and so does any promoted rule. */
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
const noSidewaysScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

/** The bell's unread count, polled: it is read on every navigation and every 60 s, so a reload settles it. */
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

const lineCard = (page: Page, name: RegExp) => page.getByRole("region", { name });

/** Fills one line card of the PO register form: how many arrived, the type (if asked), the model, tags and serials. */
async function registerLine(card: Locator, o: { count: number; type: string; model: string; tags: string[]; serials?: string[] }) {
  await card.getByLabel("How many arrived now").fill(String(o.count));
  const model = card.getByRole("combobox", { name: "Model", exact: true });
  await expect(model).toBeVisible();
  const type = card.getByRole("combobox", { name: "Type", exact: true });
  if (await type.count()) await type.selectOption({ label: o.type });
  // Ruling R11 (registration.spec.ts): the Model field is a combobox; find it by role
  await model.fill(o.model);
  for (const [i, tag] of o.tags.entries()) {
    await card.getByLabel(`Tag ${i + 1}`, { exact: true }).fill(tag);
    if (o.serials) await card.getByLabel(`Serial ${i + 1}`, { exact: true }).fill(o.serials[i]);
  }
}

// ── the intake, end to end ──────────────────────────────────────────────────────────────────────────────────────────

test.describe("the three-team intake on one mixed PO", () => {
  test.describe.configure({ mode: "serial" });

  test("1 · Purchasing saves a mixed PO; IT's bell shows 1", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, PURCHASING);
    await page.goto("/purchases/new");
    const form = page.getByRole("main");
    await waitForHydration(form.getByRole("button", { name: "Save", exact: true }));

    await form.getByLabel("Supplier").selectOption({ label: "TechServe PH" });
    await form.getByLabel("SI number").fill("SI-77001");
    await form.getByLabel("Purchase date").fill("2026-10-20");
    await form.getByLabel("Line 1 description").fill("Laptops for the new analysts");
    await form.getByLabel("Line 1 category").selectOption({ label: "Laptop" });
    await form.getByLabel("Line 1 quantity").fill("5");
    await form.getByLabel("Line 1 unit price").fill("5200");
    await form.getByRole("button", { name: "Add line" }).click();
    await form.getByLabel("Line 2 description").fill("Office chairs");
    await form.getByLabel("Line 2 category").selectOption({ label: "Furniture" });
    await form.getByLabel("Line 2 quantity").fill("2");
    await form.getByLabel("Line 2 unit price").fill("8500");
    await form.getByRole("button", { name: "Save", exact: true }).click();

    await page.waitForURL(/\/purchases\/(?!new)[^/]+$/, { timeout: 30_000 });
    po.id = new URL(page.url()).pathname.split("/").pop()!;
    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toHaveText(/^PO-\d{4}$/);
    po.refNo = (await heading.textContent())!.trim();
    await expect(page.locator("main header").first()).toContainText("With IT");

    // a fresh seed has no notifications: this save is IT's first, and it is one for the whole PO
    await login(page, IT);
    await page.goto("/purchases");
    await expectBell(page, 1);
    const panel = await openBell(page);
    await expect(panel.getByRole("link", { name: new RegExp(po.refNo) })).toBeVisible();
  });

  test("2 · IT sends it back; Purchasing's bell rings and its Sent back tab lists it", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, IT);
    await page.goto(`/purchases/${po.id}`);
    const sendBack = page.getByRole("button", { name: "Send back to Purchasing" });
    await waitForHydration(sendBack);
    await sendBack.click();
    const dialog = page.getByRole("dialog", { name: `Send ${po.refNo} back to Purchasing` });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Unit price").check();
    await dialog.getByLabel("Note for Purchasing").fill("Price is per box of 10, not per laptop");
    await dialog.getByRole("button", { name: "Send back", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator("main header").first()).toContainText("Sent back to Purchasing");

    await login(page, PURCHASING);
    await page.goto("/purchases");
    await expectBell(page, 1);
    const panel = await openBell(page);
    await panel.getByRole("tab", { name: "Sent back" }).click();
    await expect(panel.getByRole("link", { name: new RegExp(po.refNo) })).toBeVisible();
    await expect(panel).toContainText("Price is per box of 10, not per laptop");

    await page.goto("/purchases?state=SENT_BACK");
    await expect(page.getByRole("main").getByRole("row", { name: new RegExp(po.refNo) })).toBeVisible();
  });

  test("3 · Purchasing corrects it with a reply; it is back With IT", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, PURCHASING);
    await page.goto(`/purchases/${po.id}`);
    await page.getByRole("link", { name: "Fix and reply" }).click();
    await page.waitForURL(new RegExp(`/purchases/${po.id}/edit$`));
    const save = page.getByRole("button", { name: "Save", exact: true });
    await waitForHydration(save);
    // the flagged field is said in words, not colour alone
    await expect(page.getByRole("main")).toContainText("Flagged: Unit price");
    await page.getByLabel("Line 1 unit price").fill("52000");
    await page.getByLabel("What did you fix?").fill("Unit price is per laptop now: 52,000 each");
    await save.click();
    await page.waitForURL(new RegExp(`/purchases/${po.id}$`), { timeout: 30_000 });
    await expect(page.locator("main header").first()).toContainText("With IT");
    await expect(page.locator("#thread")).toContainText("Unit price is per laptop now: 52,000 each");

    await page.goto("/purchases?state=SENT_BACK");
    await expect(page.getByRole("main").getByRole("row", { name: new RegExp(po.refNo) })).toHaveCount(0);
  });

  test("4 · IT registers 3 of 5 laptops; the line reads 3 of 5 registered; Finance's bell rings", async ({ page }) => {
    test.setTimeout(150_000);
    await login(page, IT);
    await page.goto(`/purchases/${po.id}`);
    await page.getByRole("link", { name: "Register", exact: true }).click();
    await page.waitForURL(new RegExp(`/purchases/${po.id}/register$`));
    const laptops = lineCard(page, /^Line 01 · Laptops/);
    await waitForHydration(laptops.getByLabel("How many arrived now"));
    // the chairs are Purchasing's to register, not IT's
    await expect(lineCard(page, /^Line 02 · Office chairs/)).toContainText("not yours to register here");
    await registerLine(laptops, {
      count: 3, type: "Standard", model: "Latitude 5450", tags: LAPTOP_TAGS,
      serials: ["SN-PO-7701", "SN-PO-7702", "SN-PO-7703"],
    });
    await page.getByRole("button", { name: "Register 3 assets" }).click();
    await expect(toast(page, `Registered 3 from ${po.refNo}`)).toBeVisible({ timeout: 30_000 });
    await page.waitForURL(/\/inventory\/labels/);

    await page.goto(`/purchases/${po.id}`);
    await expect(page.locator("#unit-1")).toContainText("3 of 5 registered");

    await login(page, FINANCE);
    await page.goto("/finance/review");
    await expectBell(page, 1);
    await expect(page.getByRole("main").getByRole("link", { name: po.refNo })).toBeVisible();
  });

  test("5 · Finance holds one back to IT and approves 2; Undo restores all three", async ({ page }) => {
    test.setTimeout(150_000);
    await login(page, FINANCE);
    await page.goto("/finance/review");
    await page.getByRole("main").getByRole("link", { name: po.refNo }).click();
    await page.waitForURL(/\/finance\/review\/[^/]+$/);
    const held = LAPTOP_TAGS[2];
    const row = page.getByRole("row", { name: new RegExp(held) });
    await waitForHydration(row.getByRole("button", { name: "Hold back…" }));
    await row.getByRole("button", { name: "Hold back…" }).click();
    const dialog = page.getByRole("dialog", { name: `Hold back ${held}` });
    await dialog.getByLabel("Serial number").check();
    await expect(dialog.getByLabel("Send to")).toHaveValue("IT");
    await dialog.getByLabel("Note for IT").fill("Serial on the box doesn't match the sticker");
    await dialog.getByRole("button", { name: "Hold back for IT" }).click();
    await expect(row).toContainText("Held back → IT: Serial number");

    await page.getByRole("button", { name: "Approve 2", exact: true }).click();
    const done = toast(page, `Approved 2 from ${po.refNo} · 1 held back`);
    await expect(done).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => db.asset.count({ where: { tag: { in: LAPTOP_TAGS }, financeConfirmedAt: { not: null } } })).toBe(2);
    await expect.poll(async () => db.asset.count({ where: { tag: held, financeReturnedTo: "IT" } })).toBe(1);

    await done.getByRole("button", { name: "Undo" }).click();
    await expect.poll(async () => db.asset.count({
      where: { tag: { in: LAPTOP_TAGS }, financeConfirmedAt: null, financeReturnedAt: null },
    }), { timeout: 20_000 }).toBe(3);
    await page.reload();
    await expect(page.getByRole("button", { name: "Approve 3", exact: true })).toBeVisible();
  });

  test("6 · Finance fixes the SI number with a reason; Purchasing sees Changed; the history has the sentence and reason", async ({ page }) => {
    test.setTimeout(150_000);
    await login(page, FINANCE);
    await page.goto("/finance/review");
    await page.getByRole("main").getByRole("link", { name: po.refNo }).click();
    await page.waitForURL(/\/finance\/review\/[^/]+$/);
    const fix = page.getByRole("button", { name: "Fix money details" });
    await waitForHydration(fix);
    await fix.click();
    const dialog = page.getByRole("dialog", { name: `Fix money details on ${po.refNo}` });
    await dialog.getByLabel("SI number").fill("SI-77010");
    await dialog.getByRole("textbox", { name: "Reason" }).fill("Typo on the receipt: it reads 77010");
    await dialog.getByRole("button", { name: "Save fix" }).click();
    await expect(toast(page, `${po.refNo}: fixed the detail and told Purchasing`)).toBeVisible({ timeout: 30_000 });

    await login(page, PURCHASING);
    await page.goto("/purchases");
    const panel = await openBell(page);
    await panel.getByRole("tab", { name: "Changed" }).click();
    await expect(panel.getByRole("link", { name: new RegExp(po.refNo) })).toBeVisible();
    await expect(panel).toContainText("Typo on the receipt: it reads 77010");

    const asset = await db.asset.findUniqueOrThrow({ where: { tag: LAPTOP_TAGS[0] } });
    expect(asset.invoiceRef).toBe("SI-77010");
    await login(page, FINANCE);
    await page.goto(`/finance/assets/${asset.id}?tab=history`);
    const main = page.getByRole("main");
    await expect(main).toContainText("SI number from SI-77001 to SI-77010");
    await expect(main).toContainText("Typo on the receipt: it reads 77010");
  });

  test("7 · Purchasing registers the chairs on the same PO, and can't reach /inventory/register", async ({ page }) => {
    test.setTimeout(150_000);
    await login(page, PURCHASING);
    await page.goto(`/purchases/${po.id}/register`);
    const chairs = lineCard(page, /^Line 02 · Office chairs/);
    await waitForHydration(chairs.getByLabel("How many arrived now"));
    await expect(lineCard(page, /^Line 01 · Laptops/)).toContainText("not yours to register here");
    await registerLine(chairs, { count: 2, type: "Chair", model: "Ergo mesh chair", tags: CHAIR_TAGS });
    await page.getByRole("button", { name: "Register 2 assets" }).click();
    await expect(toast(page, `Registered 2 from ${po.refNo}`)).toBeVisible({ timeout: 30_000 });
    await page.waitForURL(/\/inventory\/labels/);

    await page.goto(`/purchases/${po.id}`);
    await expect(page.locator("#unit-2")).toContainText("2 of 2 registered");
    expect(await db.asset.count({ where: { tag: { in: CHAIR_TAGS }, purchaseOrderId: po.id, cls: "PURCHASING" } })).toBe(2);

    // Purchasing registers only from a PO (spec §4 way 3): the direct Register page sends it to its landing page
    await page.goto("/inventory/register");
    await expect(page).not.toHaveURL(/\/inventory\/register/);
  });

  test("9 · Mark all read on the notifications page is for this person only", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, IT);
    await page.goto("/notifications");
    const markAll = page.getByRole("button", { name: "Mark all read" });
    await waitForHydration(markAll);
    await markAll.click();
    await expect(toast(page, /notifications? marked read/)).toBeVisible({ timeout: 20_000 });
    await page.reload();
    await expectBell(page, 0);
    await expect(page.getByRole("main").getByText("Unread:")).toHaveCount(0);

    await login(page, IT2);
    await page.goto("/notifications");
    await expect(bell(page)).not.toHaveAccessibleName("Notifications, 0 unread");
    await expect(page.getByRole("main").getByText("Unread:").first()).toBeAttached();
  });
});

// ── a legacy PO with no SI number ───────────────────────────────────────────────────────────────────────────────────

test.describe("8 · a legacy PO with no SI number", () => {
  test("Finance's Approve is refused with the message", async ({ page }) => {
    test.setTimeout(120_000);
    const laptop = await db.assetCategory.findFirstOrThrow({ where: { name: "Laptop", cls: "IT" } });
    const legacy = await db.purchaseOrder.create({
      data: {
        refNo: LEGACY_REF, state: "READY", requestedById: users[PURCHASING],
        lines: { create: [{ description: "Laptop (before purchase orders)", categoryId: laptop.id, qty: 1, unitPrice: 48_000 }] },
      },
      include: { lines: true },
    });
    const record = await db.purchaseRecord.create({
      data: { cls: "IT", quantity: 1, createdById: users[IT], purchaseOrderId: legacy.id, unitCost: 48_000 },
    });
    await db.asset.create({
      data: {
        tag: LEGACY_TAG, model: "Latitude 5420 (legacy e2e)", categoryId: laptop.id, cls: "IT", status: "SPARE",
        serial: "SN-PO-7790", cost: 48_000, itVerifiedAt: new Date(), itVerifiedById: users[IT],
        purchaseOrderId: legacy.id, purchaseOrderLineId: legacy.lines[0].id, purchaseRecordId: record.id,
      },
    });

    await login(page, FINANCE);
    await page.goto(`/finance/review/${record.id}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(LEGACY_REF);
    const approve = page.getByRole("button", { name: "Approve 1", exact: true });
    await expect(approve).toBeDisabled();
    // why it can't be approved is part of the page: a status, never an alert that interrupts on every visit
    await expect(page.getByRole("status").filter({ hasText: "No SI number yet. Add it before approving." })).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "No SI number yet" })).toHaveCount(0);

    // the PO page says so too — as a status, not an alert that interrupts on every visit
    await page.goto(`/purchases/${legacy.id}`);
    const note = page.getByRole("status").filter({ hasText: "No SI number yet. Finance can't approve until it's added." });
    await expect(note).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "No SI number yet" })).toHaveCount(0);
    expect(await db.asset.count({ where: { tag: LEGACY_TAG, financeConfirmedAt: { not: null } } })).toBe(0);
  });
});

// ── accessibility ───────────────────────────────────────────────────────────────────────────────────────────────────

test.describe("10 · accessibility", () => {
  test("axe on the PO page, the group review page and the open bell panel, light and dark", async ({ page }) => {
    test.setTimeout(240_000);
    // the seeded sent-back PO (IT's note "Price is per box, not per unit") and the seeded non-IT PO of 4 chairs
    const sentBack = await db.purchaseOrder.findFirstOrThrow({ where: { sentBackNote: "Price is per box, not per unit" } });
    const ready = await db.purchaseOrder.findUniqueOrThrow({ where: { refNo: "PO-0203" } });
    const group = await db.purchaseRecord.findFirst({ where: { assets: { some: { financeConfirmedAt: null, financeReturnedAt: null } } } });
    const problems: string[] = [];

    await login(page, FINANCE);
    for (const theme of ["light", "dark"] as const) {
      await setCookie(page, "br.theme", theme);
      await page.goto(`/purchases/${sentBack.id}`);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(page.getByRole("main")).toContainText("Price is per box, not per unit");
      problems.push(...(await axeProblems(page, `PO page, sent back (${theme})`)));
      await page.goto(`/purchases/${ready.id}`);
      problems.push(...(await axeProblems(page, `PO page, ready (${theme})`)));
      if (group) {
        await page.goto(`/finance/review/${group.id}`);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        problems.push(...(await axeProblems(page, `group review (${theme})`)));
      }
    }

    await login(page, PURCHASING);
    for (const theme of ["light", "dark"] as const) {
      await setCookie(page, "br.theme", theme);
      await page.goto("/purchases");
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      const panel = await openBell(page);
      await expect(panel.getByRole("tabpanel")).not.toHaveAttribute("aria-busy", "true");
      problems.push(...(await axeProblems(page, `bell panel (${theme})`)));
      await page.keyboard.press("Escape");
      await expect(panel).toBeHidden();
    }
    expect(group, "a registration group waiting for Finance").not.toBeNull();
    expect(problems, "axe (moderate and above)").toEqual([]);
  });

  test("opening the bell moves focus to its selected tab; Escape returns it to the bell", async ({ page }) => {
    await login(page, PURCHASING);
    await page.goto("/purchases");
    const panel = await openBell(page);
    await expect(panel.getByRole("tab", { name: "All" })).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(panel.getByRole("tab", { name: "Changed" })).toBeFocused();
    await expect(panel.getByRole("tab", { name: "Changed" })).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(bell(page)).toBeFocused();
  });

  test("at 375 px the top bar with the bell fits and nothing scrolls sideways", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 375, height: 812 });
    await login(page, PURCHASING);
    const ready = await db.purchaseOrder.findUniqueOrThrow({ where: { refNo: "PO-0203" } });
    // (the /purchases list itself is left out: its five state tabs are wider than a phone, as the old six were)
    for (const path of ["/", "/notifications", `/purchases/${ready.id}`]) {
      await page.goto(path);
      const bar = page.locator("header", { has: page.getByRole("button", { name: "Open menu" }) });
      await expect(bell(page)).toBeVisible();
      const b = (await bell(page).boundingBox())!;
      expect(b.x + b.width, `${path}: the bell on screen`).toBeLessThanOrEqual(375);
      expect(await bar.evaluate((el) => el.scrollWidth <= el.clientWidth), `${path}: the bar doesn't overflow`).toBe(true);
      expect(await noSidewaysScroll(page), `${path}: no sideways scroll`).toBe(true);
    }
    // the open panel spans the phone's width under the bar, inside the screen
    const panel = await openBell(page);
    const p = (await panel.boundingBox())!;
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.x + p.width).toBeLessThanOrEqual(375);
    expect(await noSidewaysScroll(page)).toBe(true);
  });
});
