import { test, expect, type Locator, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import { SEED_PASSWORD } from "../prisma/fixtures";
import { REASON_CHIPS, chipsForOutcome } from "@/lib/reason-chips";
import { RETURN_OUTCOME_LABEL } from "@/lib/lifecycle";
import { unitsLabel } from "@/lib/stock-balance";

/**
 * Phase 23, Task 9 — the Parkinson sweep's shrunk forms (spec §9.2, 9 cases).
 * Tasks 3, 4, 6 and 7 built what this file drives: `ReasonField`'s quick-pick
 * chips, `EntityCombobox`'s `recent` group and `autoFocus`, `rememberPicks`
 * /`recentPicks`, the issue form's employee typeahead, receive's "Same item
 * again", the adjust dialog's prefilled balance, the draft form's Enter-adds-
 * a-line, the employee form's blank department and the supplier same-name
 * warning.
 *
 * Cases run `serial` because two of them share state on purpose: case 1 makes
 * the picks (one employee, one stock item) that case 2 then reads back out of
 * the Recent group, and `UserPreference` — where `recentPicks` stores them —
 * is truncated by the seed, so case 2 only sees what case 1 put there.
 *
 * Every expected string is derived: chip texts from `REASON_CHIPS`
 * (`@/lib/reason-chips`), return-outcome labels from `RETURN_OUTCOME_LABEL`
 * (`@/lib/lifecycle`), quantities from `unitsLabel` (`@/lib/stock-balance`),
 * and every code/name/id/balance from the database. The only bare strings are
 * copy the spec itself fixes ("Choose a department", "Pick a department",
 * "Same item again", "Recent"/"All", `A supplier named …`).
 *
 * DISCREPANCY (see this file's report): the brief's case 1/2 name Dennis Ong
 * as the employee to type and to find under Recent. `/stock/issue`'s own page
 * query is `where: { employment: "ACTIVE" }` and the seed makes Dennis
 * (EMP-0090) OFFBOARDING, so he is not offered by that combobox at all. Spec
 * §9.2 case 1 asks only that "typing narrows", so the test uses a genuinely
 * ACTIVE seeded employee (EMP-0097) and derives the expected match set from
 * the database with the combobox's own filter rule. No product code changed.
 *
 * Seeded facts this file leans on (prisma/seed.ts): PN-0001 (3-in-1 coffee
 * sachet, unit "sachet") sits at 40 on hand with nothing expired; OS-0001
 * (Bond paper A4, unit "ream") is the receive fixture; PN-0003 (Sugar sachet)
 * carries a RECEIPT lot referenced "DR-1103" that already arrived expired —
 * the write-off fixture; BR-LT-0166 is an IT laptop held by Dennis Ong, so
 * IT's own return dialog is `direct` and offers the outcome select.
 */

const db = new PrismaClient();

test.beforeAll(() => {
  execSync("npm run db:seed", { timeout: 120_000 });
});
test.afterAll(async () => {
  execSync("npm run db:seed", { timeout: 120_000 });
  await db.$disconnect();
});

// Copied from e2e/deadlines.spec.ts:62-68 (itself copied from
// e2e/stock-lots.spec.ts) — house rule: never import helpers across spec
// files, since each file reseeds independently.
async function login(page: Page, email: string) {
  await page.goto("/logout");
  await page.getByLabel(/Email/).fill(email);
  await page.getByLabel(/Password/).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

// Copied from e2e/deadlines.spec.ts:74-82. Probed on the element about to be
// interacted with, since hydration walks parent-to-child and a hydrated
// <form> does not yet imply a hydrated <input> inside it.
async function waitForHydration(target: Locator) {
  const el = target.first();
  await el.waitFor({ state: "attached", timeout: 20_000 });
  await expect(async () => {
    expect(await el.evaluate((node) => Object.keys(node).some((k) => k.startsWith("__reactFiber$")))).toBe(
      true,
    );
  }).toPass({ timeout: 20_000 });
}

// Copied from e2e/deadlines.spec.ts:91-111 (the mouse-move-then-settle step
// from e2e/stock-reports.spec.ts:56-61; PROMOTED_RULES and the AXE_DETAIL
// tail print from e2e/axe-sweep.spec.ts:50-79): these four rules fail
// regardless of impact, everything else below serious is counted, not failed.
const PROMOTED_RULES = new Set<string>([
  "empty-table-header",
  "page-has-heading-one",
  "heading-order",
  "landmark-unique",
]);

async function expectNoSeriousAxe(page: Page, label: string) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(700);
  const results = await new AxeBuilder({ page }).analyze();
  const bad: string[] = [];
  for (const v of results.violations) {
    if (v.impact === "serious" || v.impact === "critical" || PROMOTED_RULES.has(v.id)) {
      bad.push(`${v.id} (${v.impact}) x${v.nodes.length}`);
    } else if (process.env.AXE_DETAIL === "1") {
      for (const node of v.nodes) console.log(`${label} · ${v.id} · ${v.impact} · ${node.target.join(" ")}`);
    }
  }
  expect(bad, `axe on ${label}`).toEqual([]);
}

const IT = "it@thebackroomop.com";
const PURCHASING = "purchasing@thebackroomop.com";

/**
 * `EntityCombobox` renders `<div className="relative"><input/>{open && <ul
 * role="listbox"/>}</div>`, so a combobox's own list is its input's following
 * sibling. Scoping through it matters on `/stock/issue`, where the Item
 * combobox carries `autoFocus` (P-3) and therefore already has a list open
 * when the Employee one is focused — a bare `getByRole("listbox")` would be
 * ambiguous for the ~120 ms the blurred list takes to close.
 */
function comboList(combo: Locator): Locator {
  return combo.locator("xpath=following-sibling::ul");
}

/**
 * A lot's reference also appears in the item page's History table, so a bare
 * `getByRole("row")` is ambiguous across the two tables. Copied from
 * e2e/stock-lots.spec.ts:78-80 — the Card's `<h2>`'s parent's parent is the
 * Card's own wrapping div (card.tsx).
 */
function cardSection(page: Page, title: string): Locator {
  return page.getByRole("heading", { name: title, exact: true, level: 2 }).locator("xpath=../..");
}

/** Balances are DERIVED (spec §2.4) — recompute from the ledger, same as the app. */
async function balanceOf(itemId: string): Promise<number> {
  const agg = await db.stockMovement.aggregate({ where: { itemId }, _sum: { quantity: true } });
  return agg._sum.quantity ?? 0;
}

/**
 * `ReasonField`'s chips carry NO `aria-label` (ruling R6 — one containing
 * "Reason"/"Purpose" would break `getByLabel` on the field itself), so a chip's
 * accessible name is just its visible text and there is no common prefix to key
 * off. Both helpers therefore go through the chip group, which `ReasonField`
 * names "Quick picks" and renders only when `chips.length > 0` — so
 * `chipsIn(scope)` is naturally zero when the outcome has no chips.
 */
const chipsIn = (scope: Page | Locator) =>
  scope.getByRole("group", { name: "Quick picks" }).getByRole("button");
const chipButton = (scope: Page | Locator, chip: string) =>
  scope.getByRole("group", { name: "Quick picks" }).getByRole("button", { name: chip, exact: true });

/** Case 1 makes these picks; case 2 reads them back out of the Recent group. */
const ISSUE_CHIP = REASON_CHIPS["stock.issue"][0]; // "Regular supply"

test.describe.serial("quick forms", () => {
  test("1. the issue form's Employee field is a combobox that narrows as you type, and a Purpose chip fills the box", async ({
    page,
  }) => {
    test.setTimeout(120_000); // first hit of /stock/issue and /stock/receive in this file — cold JIT
    const pn0001 = await db.stockItem.findUniqueOrThrow({ where: { code: "PN-0001" } });
    const balanceBefore = await balanceOf(pn0001.id);
    // The Department select lists departments name-ascending, exactly as the
    // page's own query orders them — "the first department" is this one.
    const dept = await db.department.findFirstOrThrow({ orderBy: { name: "asc" } });
    // The page offers ACTIVE employees only; EMP-0097 (Nina Robles) is one.
    const target = await db.employee.findFirstOrThrow({
      where: { employeeNo: "EMP-0097", employment: "ACTIVE" },
    });
    const actives = await db.employee.findMany({
      where: { employment: "ACTIVE" },
      select: { name: true, employeeNo: true },
    });
    // EntityCombobox filters on `(label + " " + sub).toLowerCase().includes(query)`
    // with label = name and sub = employeeNo — the expected match set is
    // computed with that same rule rather than assumed.
    const query = target.name.slice(0, 3);
    const expected = actives.filter((e) =>
      `${e.name} ${e.employeeNo}`.toLowerCase().includes(query.toLowerCase()),
    );
    expect(expected.length, "the query really narrows the list").toBeLessThan(actives.length);

    await login(page, PURCHASING);
    await page.goto("/stock/issue");

    const itemCombo = page.getByRole("combobox", { name: /^Item\b/ });
    await waitForHydration(itemCombo);

    // Spec §8: the Employee field stopped being a <select>.
    const employeeCombo = page.getByLabel("Employee");
    await expect(employeeCombo).toHaveAttribute("role", "combobox");

    await itemCombo.fill(pn0001.code);
    await comboList(itemCombo).getByRole("option", { name: new RegExp(pn0001.code) }).click();
    await expect(itemCombo).toHaveValue(`${pn0001.code} · ${pn0001.name}`);

    await page.getByLabel(/^Quantity\b/).fill("1");
    await page.getByLabel(/^Department\b/).selectOption({ label: dept.name });

    await employeeCombo.fill(query);
    const options = comboList(employeeCombo).getByRole("option");
    await expect(options).toHaveCount(expected.length);
    await options.filter({ hasText: target.employeeNo }).click();
    await expect(employeeCombo).toHaveValue(`${target.name} · ${target.employeeNo}`);

    // Decision 8: a chip only fills the box. Ruling R6 made the chip row's
    // label the fixed "Quick picks" and stripped the chips' own aria-labels, so
    // `getByLabel("Purpose")` reaches the textarea and nothing else; `exact`
    // stays because getByLabel's default is a case-insensitive SUBSTRING match.
    await chipButton(page, ISSUE_CHIP).click();
    await expect(page.getByLabel("Purpose", { exact: true })).toHaveValue(ISSUE_CHIP);

    await page.getByRole("button", { name: "Record issue" }).click();
    await expect(
      page.getByText(`Success: Issued ${unitsLabel(1, pn0001.unit)} of ${pn0001.code} to ${dept.name}`, {
        exact: true,
      }),
    ).toBeVisible({ timeout: 30_000 });

    await expect.poll(() => balanceOf(pn0001.id), { timeout: 15_000 }).toBe(balanceBefore - 1);
    const movement = await db.stockMovement.findFirstOrThrow({
      where: { itemId: pn0001.id, kind: "ISSUE", quantity: -1 },
      orderBy: { createdAt: "desc" },
    });
    expect(movement.employeeId).toBe(target.id);
    expect(movement.reason).toBe(ISSUE_CHIP);

    // Put the unit back so this file's own later cases (4 reads PN-0001's
    // balance) see the seed picture; `afterAll` reseeds regardless.
    await page.goto(`/stock/receive?item=${pn0001.id}`);
    const receiveQty = page.getByLabel(/^Quantity\b/);
    await waitForHydration(receiveQty);
    await receiveQty.fill("1");
    await page.getByRole("button", { name: "Record receipt" }).click();
    await expect(
      page.getByText(`Success: Received ${unitsLabel(1, pn0001.unit)} of ${pn0001.code}`, { exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => balanceOf(pn0001.id), { timeout: 15_000 }).toBe(balanceBefore);
  });

  test("2. reopening the issue form offers case 1's picks under a Recent heading", async ({ page }) => {
    test.setTimeout(60_000);
    const pn0001 = await db.stockItem.findUniqueOrThrow({ where: { code: "PN-0001" } });
    const target = await db.employee.findFirstOrThrow({ where: { employeeNo: "EMP-0097" } });
    const user = await db.user.findUniqueOrThrow({ where: { email: PURCHASING } });

    // `rememberPicks` writes the preference after the action commits — the
    // stored list is exactly case 1's pick, newest first.
    const employeePref = await db.userPreference.findUniqueOrThrow({
      where: { userId_key: { userId: user.id, key: "recent:employee" } },
    });
    expect(employeePref.value).toEqual([target.id]);
    const itemPref = await db.userPreference.findUniqueOrThrow({
      where: { userId_key: { userId: user.id, key: "recent:stock-item" } },
    });
    expect(itemPref.value).toEqual([pn0001.id]);

    await login(page, PURCHASING);
    await page.goto("/stock/issue");
    const itemCombo = page.getByRole("combobox", { name: /^Item\b/ });
    await waitForHydration(itemCombo);

    // Phase 27 (spec §5.5): focus alone no longer opens the list, so each combobox needs its own
    // click before its list is expected to be visible.
    const employeeCombo = page.getByLabel("Employee");
    await employeeCombo.click();
    const employeeList = comboList(employeeCombo);
    await expect(employeeList).toBeVisible({ timeout: 10_000 });
    const employeeRows = await employeeList.locator("li").allTextContents();
    expect(employeeRows[0]).toBe("Recent");
    expect(employeeRows[1]).toContain(target.name);
    expect(employeeRows[2]).toBe("All"); // exactly one recent pick, then the full list

    await itemCombo.click();
    const itemList = comboList(itemCombo);
    await expect(itemList).toBeVisible({ timeout: 10_000 });
    const itemRows = await itemList.locator("li").allTextContents();
    expect(itemRows[0]).toBe("Recent");
    expect(itemRows[1]).toContain(pn0001.code);
    expect(itemRows[2]).toBe("All");
  });

  test("3. after a receipt, Same item again restores the item and puts the cursor in Quantity", async ({ page }) => {
    test.setTimeout(60_000);
    const os0001 = await db.stockItem.findUniqueOrThrow({ where: { code: "OS-0001" } });
    const balanceBefore = await balanceOf(os0001.id);

    await login(page, PURCHASING);
    await page.goto("/stock/receive");
    const itemCombo = page.getByRole("combobox", { name: /^Item\b/ });
    await waitForHydration(itemCombo);
    await itemCombo.fill(os0001.code);
    await comboList(itemCombo).getByRole("option", { name: new RegExp(os0001.code) }).click();

    const quantity = page.getByLabel(/^Quantity\b/);
    await quantity.fill("1");
    await page.getByRole("button", { name: "Record receipt" }).click();
    await expect(
      page.getByText(`Success: Received ${unitsLabel(1, os0001.unit)} of ${os0001.code}`, { exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => balanceOf(os0001.id), { timeout: 15_000 }).toBe(balanceBefore + 1);
    // The form cleared the item, which is what makes the shortcut worth having.
    await expect(itemCombo).toHaveValue("");

    await page.getByRole("button", { name: "Same item again" }).click();
    await expect(itemCombo).toHaveValue(`${os0001.code} · ${os0001.name}`);
    await expect(quantity).toBeFocused();
    // The offer retires once the item is back in the form.
    await expect(page.getByRole("button", { name: "Same item again" })).toHaveCount(0);
  });

  test("4. the adjust dialog opens on Set with the balance already in Quantity, and a chip fills Reason", async ({
    page,
  }) => {
    test.setTimeout(60_000); // first hit of a stock item page in this file
    const pn0001 = await db.stockItem.findUniqueOrThrow({ where: { code: "PN-0001" } });
    const balance = await balanceOf(pn0001.id);
    const chip = REASON_CHIPS["stock.adjust"][0]; // "Count correction"

    await login(page, PURCHASING);
    await page.goto(`/stock/items/${pn0001.id}`);
    // Same Stat shape e2e/deadlines.spec.ts:331 uses for a tile: the label
    // span's parent is the Stat, whose other span is the value.
    const onHand = page.getByText("On hand", { exact: true }).locator("xpath=..");
    await expect(onHand).toContainText(unitsLabel(balance, pn0001.unit), { timeout: 20_000 });

    const adjustBtn = page.getByRole("button", { name: "Adjust" });
    await waitForHydration(adjustBtn);
    await adjustBtn.click();

    const dialog = page.getByRole("dialog", { name: `Adjust ${pn0001.code}` });
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(dialog.getByLabel("Adjustment mode")).toHaveValue("set");
    // Spec §8: Set mode starts at the balance the page just showed.
    await expect(dialog.getByLabel("Quantity")).toHaveValue(String(balance));

    await chipButton(dialog, chip).click();
    await expect(dialog.getByLabel("Reason", { exact: true })).toHaveValue(chip);

    // Nothing is posted — the dialog is closed and the ledger is untouched.
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 10_000 });
    expect(await balanceOf(pn0001.id)).toBe(balance);
  });

  test("5. Enter in a draft line's unit price adds a line when that line has a description, and never otherwise", async ({
    page,
  }) => {
    test.setTimeout(60_000); // first hit of /purchases/new in this file
    const draftsBefore = await db.purchaseRequest.count();

    await login(page, PURCHASING);
    await page.goto("/purchases/new");
    const price1 = page.getByLabel("Line 1 unit price");
    await waitForHydration(price1);

    // Spec §7: Enter in a line with an empty description adds nothing.
    await price1.press("Enter");
    await expect(page.getByLabel("Line 2 description")).toHaveCount(0);
    await expect(page).toHaveURL(/\/purchases\/new$/); // preventDefault: the form never submits

    await page.getByLabel("Line 1 description").fill("E2E quick-forms line");
    await price1.press("Enter");
    const description2 = page.getByLabel("Line 2 description");
    await expect(description2).toBeVisible({ timeout: 10_000 });
    await expect(description2).toBeFocused();

    // The new line is itself description-less, so Enter in it adds no third.
    await page.getByLabel("Line 2 unit price").press("Enter");
    await expect(page.getByLabel("Line 3 description")).toHaveCount(0);

    // No department was ever chosen, so autosave never fired: no draft row.
    expect(await db.purchaseRequest.count()).toBe(draftsBefore);
  });

  test("6. the new-employee form starts with no department chosen and the server names the refusal", async ({
    page,
  }) => {
    test.setTimeout(60_000); // first hit of /employees/new in this file
    await login(page, IT);
    await page.goto("/employees/new");

    const department = page.getByLabel(/^Department\b/);
    await waitForHydration(department);
    await expect(department).toHaveValue("");
    await expect(department.locator("option:checked")).toHaveText("Choose a department");

    await page.getByLabel(/^Employee number\b/).fill("EMP-E2E-QF");
    await page.getByLabel(/^Name\b/).fill("Quick Forms Probe");
    await page.getByLabel(/^Title\b/).fill("Probe");
    await page.getByRole("button", { name: "Create employee" }).click();

    await expect(page.getByText("Pick a department", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/employees\/new$/);
    expect(await db.employee.count({ where: { employeeNo: "EMP-E2E-QF" } })).toBe(0);
  });

  test("7. typing a seeded supplier's name warns in place, with a link to the record that already exists", async ({
    page,
  }) => {
    test.setTimeout(60_000); // first hit of /purchases/suppliers/new in this file
    // `findSameSupplierName` orders name-ascending over every vendor row.
    const supplier = await db.vendor.findFirstOrThrow({
      where: { archivedAt: null },
      orderBy: { name: "asc" },
    });

    await login(page, PURCHASING);
    await page.goto("/purchases/suppliers/new");
    const name = page.getByLabel(/^Name\b/);
    await waitForHydration(name);
    await expect(page.getByText(/^A supplier named/)).toHaveCount(0);

    await name.fill(supplier.name);
    // 400 ms debounce, then the read-only check — a state-based wait, not a sleep.
    const banner = page.getByText(`A supplier named "${supplier.name}" already exists`, { exact: true });
    await expect(banner).toBeVisible({ timeout: 20_000 });
    const open = page.getByRole("link", { name: "Open it" });
    await expect(open).toBeVisible();
    await expect(open).toHaveAttribute("href", `/purchases/suppliers/${supplier.id}`);

    // §7: the warning is a nudge, not a gate — the form is still fillable.
    await expect(page.getByRole("button", { name: "Create supplier" })).toBeEnabled();
  });

  test("8. the write-off dialog offers its chips prefilled Expired, and a return dialog's chips follow the outcome", async ({
    page,
  }) => {
    test.setTimeout(120_000); // two roles, two record pages, both cold in this file
    const pn0003 = await db.stockItem.findUniqueOrThrow({ where: { code: "PN-0003" } });
    // The expired RECEIPT lot is the only lot on this item carrying a reference.
    const expiredLot = await db.stockLot.findFirstOrThrow({
      where: { itemId: pn0003.id, expiresAt: { not: null } },
    });
    expect(expiredLot.reference).not.toBeNull();

    await login(page, PURCHASING);
    await page.goto(`/stock/items/${pn0003.id}`);
    const lotRow = cardSection(page, "Lots").getByRole("row", { name: new RegExp(expiredLot.reference!) });
    const writeOffBtn = lotRow.getByRole("button", { name: "Write off" });
    await waitForHydration(writeOffBtn);
    await writeOffBtn.click();

    const writeOff = page.getByRole("dialog", { name: "Write off lot" });
    await expect(writeOff).toBeVisible({ timeout: 10_000 });
    // The "Expired" default survives the ReasonField swap (P-10).
    await expect(writeOff.getByLabel("Reason", { exact: true })).toHaveValue("Expired");
    for (const chip of REASON_CHIPS["stock.write-off"]) {
      await expect(chipButton(writeOff, chip)).toBeVisible();
    }
    const other = REASON_CHIPS["stock.write-off"][1]; // "Damaged"
    await chipButton(writeOff, other).click();
    await expect(writeOff.getByLabel("Reason", { exact: true })).toHaveValue(other);
    await writeOff.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 10_000 });

    // IT returning an IT laptop is a `direct` return, so the outcome select
    // is offered and the chips follow it (spec §8, chipsForOutcome).
    const laptop = await db.asset.findFirstOrThrow({ where: { tag: "BR-LT-0166" } });
    await login(page, IT);
    await page.goto(`/inventory/${laptop.id}`);
    const returnBtn = page.getByRole("button", { name: "Return" });
    await waitForHydration(returnBtn);
    await returnBtn.click();

    const returnDialog = page.getByRole("dialog", { name: `Return ${laptop.tag}` });
    await expect(returnDialog).toBeVisible({ timeout: 10_000 });
    const outcome = returnDialog.getByLabel(/^What happens to it\b/);
    // TRIAGE is the default and chipsForOutcome("TRIAGE") is empty.
    await expect(outcome).toHaveValue("TRIAGE");
    expect(chipsForOutcome("TRIAGE")).toEqual([]);
    // Zero chips means `ReasonField` renders no "Quick picks" group at all
    // (`chips.length > 0` guard), so the group-scoped count is 0 either way.
    await expect(returnDialog.getByRole("group", { name: "Quick picks" })).toHaveCount(0);
    await expect(chipsIn(returnDialog)).toHaveCount(0);

    await outcome.selectOption({ label: RETURN_OUTCOME_LABEL.MISSING });
    const missingChips = chipsForOutcome("MISSING");
    await expect(chipsIn(returnDialog)).toHaveCount(missingChips.length);
    for (const chip of missingChips) {
      await expect(chipButton(returnDialog, chip)).toBeVisible();
    }

    await outcome.selectOption({ label: RETURN_OUTCOME_LABEL.TRIAGE });
    await expect(returnDialog.getByRole("group", { name: "Quick picks" })).toHaveCount(0);
    await expect(chipsIn(returnDialog)).toHaveCount(0);

    // Nothing is submitted — the laptop stays with its holder.
    await returnDialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 10_000 });
    const after = await db.asset.findUniqueOrThrow({ where: { id: laptop.id } });
    expect(after.assigneeId).toBe(laptop.assigneeId);
    expect(after.status).toBe(laptop.status);
  });

  test("9. no serious, critical or promoted axe violations on the four forms this phase reshaped", async ({
    page,
  }) => {
    test.setTimeout(120_000); // four full-page scans, each with its own settle wait
    await login(page, PURCHASING);

    await page.goto("/stock/issue");
    await waitForHydration(page.getByRole("combobox", { name: /^Item\b/ }));
    await expectNoSeriousAxe(page, "/stock/issue");

    await page.goto("/stock/receive");
    await waitForHydration(page.getByRole("combobox", { name: /^Item\b/ }));
    await expectNoSeriousAxe(page, "/stock/receive");

    await page.goto("/purchases/suppliers/new");
    await waitForHydration(page.getByLabel(/^Name\b/));
    await expectNoSeriousAxe(page, "/purchases/suppliers/new");

    await login(page, IT);
    await page.goto("/employees/new");
    await waitForHydration(page.getByLabel(/^Department\b/));
    await expectNoSeriousAxe(page, "/employees/new");
  });
});
