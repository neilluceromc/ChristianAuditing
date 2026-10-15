import { test, expect, type Locator, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import { readSheet } from "read-excel-file/node";
import { SEED_PASSWORD } from "../prisma/fixtures";

/**
 * Phase 36 — staff type their own tags, the Type is always asked, the Laptop types are
 * Standard / High-performance / MacBook, the holder pickers and the Assigned filter search
 * people, and the Schedule opens by category. Ten cases, each independent:
 *   1   one unit: a new model, an empty Type that the status line asks for, a lower-case tag
 *       stored upper-case, the label, the scan card
 *   2   a known model leaves the Type empty and required
 *   3   a batch of 3: pasted tags, an in-batch repeat, a tag already registered, an empty tag,
 *       then a clean batch lands
 *   4   a tag with a space is refused with the rule
 *   5   the data fix: Laptop types, BR-LT-0201 is a MacBook, the Finance policy's laptop slot is Standard
 *   6   axe on Register with the Type select and a tag box
 *   7   the people picker: Recent, "EMP-00" lists at most 10, a name finds a person, the page
 *       carries no idle employee's name
 *   8   the Assigned filter: a holder, Unassigned, the chip's x
 *   9   the Schedule: category rows and a Total, a drill-down, back, the export keeps asset rows
 *   10  axe on the Assigned popover and on the Schedule summary
 *
 * Tags are 20 characters at most and unique per run.
 */

const db = new PrismaClient();

const IT = "it@thebackroomop.com";
const FINANCE = "finance@thebackroomop.com";
const KNOWN_LAPTOP = "ThinkPad T14 Gen 4";
const TAG_RULE = "Tags are 1–20 letters, digits, - _ or ., no spaces";

test.beforeAll(async () => {
  execSync("npm run db:seed", { timeout: 120_000 });
});
test.afterAll(async () => {
  await db.$disconnect();
});

// Copied from e2e/queues-records-ux.spec.ts — house rule: never import helpers across spec files.
async function login(page: Page, email: string) {
  await page.goto("/logout");
  await page.getByLabel(/Email/).fill(email);
  await page.getByLabel(/Password/).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
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

let seq = 0;
const newTag = () => `OWN${Date.now().toString(36).slice(-6).toUpperCase()}-${++seq}`;

const modelBox = (page: Page) => page.getByRole("combobox", { name: "Model", exact: true });
const serialBox = (page: Page) => page.getByRole("textbox", { name: "Serial number", exact: true });
const typeSelect = (page: Page) => page.getByRole("combobox", { name: "Type", exact: true });
const tagBox = (page: Page) => page.getByRole("textbox", { name: "Tag", exact: true });
const rowTag = (page: Page, n: number) => page.getByRole("textbox", { name: `Tag ${n}`, exact: true });
const rowSerial = (page: Page, n: number) => page.getByRole("textbox", { name: `Serial ${n}`, exact: true });

async function openRegister(page: Page) {
  await page.goto("/inventory/register");
  await expect(page.getByRole("heading", { name: "New equipment", level: 1 })).toBeVisible({ timeout: 20_000 });
  await waitForHydration(page.getByRole("button", { name: /^Laptop\b/ }).first());
}

async function pickLaptop(page: Page) {
  await page.getByRole("button", { name: /^Laptop (\d+ in stock|None yet)$/ }).click();
}

async function pickKnownModel(page: Page) {
  await modelBox(page).fill(KNOWN_LAPTOP);
  await page.getByRole("option", { name: KNOWN_LAPTOP, exact: true }).click();
  await expect(modelBox(page)).toHaveValue(KNOWN_LAPTOP);
}

async function setQuantity(page: Page, n: number) {
  const box = page.getByRole("textbox", { name: "How many", exact: true });
  await box.fill(String(n));
  await box.blur();
  await expect(rowSerial(page, n)).toBeVisible();
}

async function landed(page: Page) {
  await page.waitForURL(/\/inventory\/labels\?just=/, { timeout: 30_000 });
}

async function pasteInto(box: Locator, text: string) {
  await box.evaluate((el, t) => {
    const data = new DataTransfer();
    data.setData("text/plain", t);
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
}

test.describe("own tags and real types — Register", () => {
  test("1. one unit: a new model, an empty Type, a lower-case tag stored upper-case", async ({ page }) => {
    test.setTimeout(120_000);
    const tag = newTag();
    const model = "Asus Vivobook 15 (e2e)";
    await login(page, IT);
    await openRegister(page);
    await pickLaptop(page);
    await modelBox(page).fill(model);
    await page.getByRole("option", { name: /^\+ Add .Asus Vivobook 15 \(e2e\). as a new model$/ }).click();
    await expect(typeSelect(page)).toBeVisible();
    await expect(typeSelect(page)).toHaveValue("");
    await expect(page.getByText(/^Still needed:.*the type/)).toBeVisible();
    await typeSelect(page).selectOption({ label: "High-performance" });
    await tagBox(page).fill(tag.toLowerCase());
    await serialBox(page).fill(`OWN1-${Date.now()}`);
    await page.getByRole("button", { name: "Register 1 laptop", exact: true }).click();
    await landed(page);

    const asset = await db.asset.findUniqueOrThrow({ where: { tag }, include: { type: true } });
    expect(asset.tag).toBe(tag);
    expect(asset.type?.name).toBe("High-performance");
    // The Labels tab shows the tag's barcode.
    await expect(page.getByLabel(`Barcode ${tag}`, { exact: true })).toHaveCount(1);
    // The scan card opens for it.
    await page.goto(`/inventory/scan/${tag}`);
    await expect(page.getByText(tag, { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  });

  test("2. a known model leaves the Type empty and required", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, IT);
    await openRegister(page);
    await pickLaptop(page);
    await modelBox(page).fill("Dell Latitude 5420");
    await page.getByRole("option", { name: "Dell Latitude 5420", exact: true }).click();
    await expect(modelBox(page)).toHaveValue("Dell Latitude 5420");
    await expect(typeSelect(page)).toBeVisible();
    await expect(typeSelect(page)).toHaveValue("");
    await expect(page.getByText(/— set by this model/)).toHaveCount(0);
    await tagBox(page).fill(newTag());
    await serialBox(page).fill(`OWN2-${Date.now()}`);
    await page.getByRole("button", { name: "Register 1 laptop", exact: true }).click();
    await expect(page.getByText("Pick the type", { exact: true }).first()).toBeVisible();
    await expect(page).toHaveURL(/\/inventory\/register$/);
  });

  test("3. a batch of 3: pasted tags, repeats, a registered tag, an empty tag, then a clean batch", async ({ page }) => {
    test.setTimeout(150_000);
    const tags = [newTag(), newTag(), newTag()];
    const s = `OWN3-${Date.now()}`;
    await login(page, IT);
    await openRegister(page);
    await pickLaptop(page);
    await pickKnownModel(page);
    await typeSelect(page).selectOption({ label: "Standard" });
    await setQuantity(page, 3);

    await pasteInto(rowTag(page, 1), `${tags[0]}\r\n${tags[1]}\r\n${tags[2]}\r\n`);
    await expect(rowTag(page, 1)).toHaveValue(tags[0]);
    await expect(rowTag(page, 2)).toHaveValue(tags[1]);
    await expect(rowTag(page, 3)).toHaveValue(tags[2]);
    await expect(page.getByText("Pasted 3 tags", { exact: false })).toBeVisible();
    for (let i = 1; i <= 3; i++) await rowSerial(page, i).fill(`${s}-${i}`);

    // A repeat inside the batch.
    await rowTag(page, 3).fill(tags[1]);
    await expect(page.getByText(/appears twice in this batch/).first()).toBeVisible();

    // A tag that is already registered says so and links to the record.
    await rowTag(page, 3).fill("BR-LT-0148");
    await rowTag(page, 3).blur();
    const link = page.getByRole("link", { name: "already registered" });
    await expect(link).toBeVisible({ timeout: 20_000 });
    await expect(link).toHaveAttribute("href", /\/inventory\/.+/);

    // An empty tag refuses.
    await rowTag(page, 3).fill("");
    await page.getByRole("button", { name: "Register 3 laptops", exact: true }).click();
    await expect(page.getByText(/Enter a tag for every unit/).first()).toBeVisible();
    await expect(page).toHaveURL(/\/inventory\/register$/);
    expect(await db.asset.count({ where: { tag: { in: tags } } })).toBe(0);

    // A clean batch registers.
    await rowTag(page, 3).fill(tags[2]);
    await expect(page.getByText(/appears twice|already registered|Enter a tag for every unit/)).toHaveCount(0);
    await page.getByRole("button", { name: "Register 3 laptops", exact: true }).click();
    await landed(page);
    expect(await db.asset.count({ where: { tag: { in: tags } } })).toBe(3);
  });

  test("4. a tag with a space is refused with the rule", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, IT);
    await openRegister(page);
    await pickLaptop(page);
    await pickKnownModel(page);
    await typeSelect(page).selectOption({ label: "Standard" });
    await tagBox(page).fill("A B");
    await serialBox(page).fill(`OWN4-${Date.now()}`);
    await page.getByRole("button", { name: "Register 1 laptop", exact: true }).click();
    await expect(page.getByText(TAG_RULE, { exact: false }).first()).toBeVisible();
    await expect(page).toHaveURL(/\/inventory\/register$/);
    expect(await db.asset.count({ where: { tag: "A B" } })).toBe(0);
  });

  test("6. axe on Register with the Type select and a tag box", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, IT);
    await openRegister(page);
    await pickLaptop(page);
    await pickKnownModel(page);
    await expect(typeSelect(page)).toBeVisible();
    await expect(tagBox(page)).toBeVisible();
    await expectNoSeriousAxe(page);
  });
});

test.describe("own tags and real types — data", () => {
  test("5. the Laptop types are Standard, High-performance, MacBook; BR-LT-0201 is a MacBook; the policy's slot is Standard", async () => {
    const laptop = await db.assetCategory.findFirstOrThrow({ where: { name: "Laptop", cls: "IT" }, include: { types: true } });
    expect(laptop.types.map((t) => t.name).sort()).toEqual(["High-performance", "MacBook", "Standard"]);
    const mac = await db.asset.findUniqueOrThrow({ where: { tag: "BR-LT-0201" }, include: { type: true } });
    expect(mac.type?.name).toBe("MacBook");
    const policy = await db.equipmentPolicy.findUniqueOrThrow({
      where: { name: "Finance standard" }, include: { slots: { include: { assetType: true } } },
    });
    expect(policy.slots.find((sl) => sl.name === "laptop")?.assetType?.name).toBe("Standard");
  });
});

test.describe("own tags and real types — people", () => {
  test("7. the people picker: Recent, a capped list, a name search, and no idle names in the page", async ({ page }) => {
    test.setTimeout(150_000);
    const cat = await db.assetCategory.findFirstOrThrow({ where: { name: "Laptop", cls: "IT" } });
    const mk = (tag: string) => db.asset.create({
      data: { tag, model: "E2E Spare Laptop", categoryId: cat.id, cls: "IT", status: "SPARE", itVerifiedAt: new Date(), labelPrintedAt: new Date() },
    });
    const a = await mk(newTag());
    const b = await mk(newTag());
    const paolo = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0071" } });
    await login(page, IT);

    // Typing a part of a name finds the person, and assigning works.
    await page.goto(`/inventory/${a.id}`);
    await page.getByRole("button", { name: "Assign", exact: true }).click();
    const dialogA = page.getByRole("dialog", { name: new RegExp(`^Assign ${a.tag} `) });
    await dialogA.getByLabel("Assign to").fill(paolo.name.split(" ")[0]);
    await dialogA.getByRole("option").filter({ hasText: paolo.name }).first().click();
    await dialogA.getByRole("button", { name: "Assign", exact: true }).click();
    await expect(page.getByText(`${a.tag} assigned to ${paolo.name}`)).toBeVisible({ timeout: 15_000 });

    // The next Assign dialog offers that person under Recent before anything is typed.
    await page.goto(`/inventory/${b.id}`);
    await page.getByRole("button", { name: "Assign", exact: true }).click();
    const dialogB = page.getByRole("dialog", { name: new RegExp(`^Assign ${b.tag} `) });
    const who = dialogB.getByLabel("Assign to");
    await who.click();
    await expect(dialogB.getByRole("option").filter({ hasText: paolo.name }).first()).toBeVisible({ timeout: 15_000 });

    // "EMP-00" lists at most 10.
    const matching = await db.employee.count({ where: { employment: "ACTIVE", employeeNo: { contains: "EMP-00", mode: "insensitive" } } });
    await who.fill("EMP-00");
    await expect(dialogB.getByRole("option").first()).toBeVisible({ timeout: 15_000 });
    await expect(dialogB.getByRole("option")).toHaveCount(Math.min(10, matching));

    // No idle employee's name is in the inventory page: this one holds nothing and has no hold.
    const dept = await db.department.findFirstOrThrow();
    const stamp = Date.now().toString(36).toUpperCase();
    const idle = await db.employee.create({
      data: { employeeNo: `EMP-E${stamp}`, name: `Zelda Idlewild${stamp}`, title: "Tester", departmentId: dept.id, joinedAt: new Date() },
    });
    const res = await page.request.get("/inventory");
    expect(res.status()).toBe(200);
    expect(await res.text()).not.toContain(idle.name);
  });

  test("8. the Assigned filter: a holder, Unassigned, and the chip's x", async ({ page }) => {
    test.setTimeout(120_000);
    const holder = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0042" } });
    await login(page, IT);
    await page.goto("/inventory?q=BR-LT-01");
    const held = page.getByRole("row", { name: /BR-LT-0148/ });
    const spare = page.getByRole("row", { name: /BR-LT-0181/ });
    await expect(held).toBeVisible({ timeout: 20_000 });
    await expect(spare).toBeVisible();

    const trigger = page.getByRole("button", { name: /^Assigned/ });
    await waitForHydration(trigger);
    await trigger.click();
    const popover = page.getByRole("dialog", { name: "Filter by Assigned" });
    await popover.getByLabel("Search people").fill(holder.name.split(" ")[0]);
    const option = popover.getByRole("checkbox", { name: new RegExp(holder.name) });
    await expect(option).toBeVisible({ timeout: 15_000 });
    await option.check();
    await popover.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page.getByRole("button", { name: "Assigned: 1", exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(held).toBeVisible();
    await expect(spare).toHaveCount(0);

    // The chip's x removes it.
    await page.getByRole("button", { name: "Assigned: 1", exact: true }).click();
    await page.getByRole("button", { name: `Remove ${holder.name}`, exact: true }).click();
    await page.getByRole("dialog", { name: "Filter by Assigned" }).getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page.getByRole("button", { name: "Assigned", exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(spare).toBeVisible();

    // Unassigned narrows to assets with no holder.
    await page.getByRole("button", { name: "Assigned", exact: true }).click();
    await page.getByRole("dialog", { name: "Filter by Assigned" }).getByRole("checkbox", { name: /Unassigned/ }).check();
    await page.getByRole("dialog", { name: "Filter by Assigned" }).getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page.getByRole("button", { name: "Assigned: 1", exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(spare).toBeVisible();
    await expect(held).toHaveCount(0);
  });

  test("10. axe on the Assigned popover", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, IT);
    await page.goto("/inventory");
    const trigger = page.getByRole("button", { name: /^Assigned/ });
    await waitForHydration(trigger);
    await trigger.click();
    const popover = page.getByRole("dialog", { name: "Filter by Assigned" });
    await expect(popover).toBeVisible();
    await popover.getByLabel("Search people").fill("a");
    await expect(popover.getByRole("checkbox").nth(1)).toBeVisible({ timeout: 15_000 });
    await expectNoSeriousAxe(page);
  });
});

test.describe("own tags and real types — Schedule", () => {
  test("9. the Schedule opens by category; a link drills down; the export keeps asset rows", async ({ page }) => {
    test.setTimeout(150_000);
    const tag = "BR-LT-0148";
    const before = await db.asset.findUniqueOrThrow({
      where: { tag }, select: { id: true, financeConfirmedAt: true, financeConfirmedById: true },
    });
    const cat = await db.assetCategory.findFirstOrThrow({ where: { name: "Laptop", cls: "IT" } });
    const finance = await db.user.findUniqueOrThrow({ where: { email: FINANCE } });
    try {
      await db.assetCategory.update({ where: { id: cat.id }, data: { depreciationLifeMonths: 36, depreciationSalvagePercent: 10 } });
      await db.asset.update({
        where: { tag }, data: { financeConfirmedAt: new Date(Date.now() - 100 * 86_400_000), financeConfirmedById: finance.id },
      });
      const year = new Date().getFullYear();
      await login(page, FINANCE);
      await page.goto("/finance/depreciation");
      const table = page.getByRole("table", { name: `Depreciation schedule ${year}` });
      await expect(table).toBeVisible();
      await expect(table.getByRole("link", { name: "Laptop", exact: true })).toBeVisible();
      await expect(table.getByRole("cell", { name: "Total", exact: true })).toBeVisible();
      await expect(table.getByRole("cell", { name: tag, exact: true })).toHaveCount(0);
      await expectNoSeriousAxe(page); // case 10: the Schedule summary

      await table.getByRole("link", { name: "Laptop", exact: true }).click();
      await expect(page).toHaveURL(/[?&]cat=/);
      await expect(page.getByRole("cell", { name: "Subtotal — Laptop" })).toBeVisible();
      await expect(page.getByRole("cell", { name: tag, exact: true })).toBeVisible();
      await page.getByRole("link", { name: "← All categories" }).click();
      await expect(page).not.toHaveURL(/[?&]cat=/);
      await expect(page.getByRole("table", { name: `Depreciation schedule ${year}` }).getByRole("cell", { name: tag, exact: true })).toHaveCount(0);

      const sched = await page.request.get(`/finance/depreciation/export?year=${year}&cls=IT`);
      expect(sched.status()).toBe(200);
      const grid = (await readSheet(Buffer.from(await sched.body()))) as unknown[][];
      expect(grid.some((r) => r.includes(tag))).toBe(true);
      expect(grid.some((r) => r.includes("Total"))).toBe(true);
    } finally {
      await db.asset.update({
        where: { tag }, data: { financeConfirmedAt: before.financeConfirmedAt, financeConfirmedById: before.financeConfirmedById },
      });
      await db.assetCategory.update({
        where: { id: cat.id }, data: { depreciationLifeMonths: cat.depreciationLifeMonths, depreciationSalvagePercent: cat.depreciationSalvagePercent },
      });
    }
  });
});
