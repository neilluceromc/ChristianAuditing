import { test, expect, type Locator, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import { SEED_PASSWORD } from "../prisma/fixtures";
import { fmtDate, localDateISO } from "@/lib/format";
import { addDays, dayFromISO } from "@/lib/deadlines";

/**
 * Phase 32 — Laws of UX on the IT screens where the work gets done (spec §11),
 * fifteen cases, each independent:
 *   1–7  offboarding: the queue's Attention order and state-labelled action, the
 *        wizard opening where the work is, Mark the rest as Returned, the client
 *        reason check, Accounts reachable early with the clear-status dialog,
 *        the Finish readiness checklist and success ending, the farewell draft.
 *   8–11 the worklist: Triage… in place, Hide until tomorrow with Undo, the nav
 *        badge agreeing with the page, a viewer's read-only Home card.
 *   12–14 the scan card: IT's Return…, the leaver line, a viewer's card.
 *   15   /reservations: Assign to {name}… opens Assign with the person preset.
 *
 * Plan P-16: the seed has no Triage row, no Awaiting-IT-check row and no
 * EXECUTION_FAILED return, so cases build their own fixtures with Prisma and
 * put mutable fields back in `finally`; audit rows are never deleted.
 *
 * Dennis Ong (EMP-0090) is the one seeded leaver, holding BR-LT-0166,
 * BR-PH-0312 and BR-HS-0510. Every Dennis case starts AND ends with
 * `resetDennis()`: his three items back in his name as DEPLOYED, his
 * employment/M365/due date as seeded, and `offboardingAt` moved to now. That
 * last one is what undoes a decision without touching any approval row: the
 * wizard only counts returns created on or after `offboardingAt`
 * (`candidatesFor`, queries.ts), so moving the window's start past them leaves
 * every earlier decision on record and out of this offboarding.
 */

const db = new PrismaClient();

const IT = "it@thebackroomop.com";
const VIEWER = "viewer@thebackroomop.com";
const DENNIS_NO = "EMP-0090";
const DENNIS_TAGS = ["BR-LT-0166", "BR-PH-0312", "BR-HS-0510"];
/** The runtime second leaver: sorts BEFORE "Dennis Ong" by name, so the Attention order has to move him. */
const SECOND_NO = "EMP-0321";
const SECOND_NAME = "Aaron Abad";

/** Dennis's seeded completion date, read after the seed (2 days overdue on the Manila calendar). */
let dennisDueAt: Date | null = null;

test.beforeAll(async () => {
  execSync("npm run db:seed", { timeout: 120_000 });
  dennisDueAt = (await db.employee.findUniqueOrThrow({ where: { employeeNo: DENNIS_NO } })).offboardingDueAt;
});
test.afterAll(async () => {
  await db.$disconnect();
});

// Copied from e2e/it-nav.spec.ts:59-65 — house rule: never import helpers across spec files.
async function login(page: Page, email: string) {
  await page.goto("/logout");
  await page.getByLabel(/Email/).fill(email);
  await page.getByLabel(/Password/).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

// Copied from e2e/it-nav.spec.ts:68-73.
async function expectNoSeriousAxe(page: Page) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(700);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
}

// Copied from e2e/it-nav.spec.ts:76-84.
async function waitForHydration(target: Locator) {
  const el = target.first();
  await el.waitFor({ state: "attached", timeout: 20_000 });
  await expect(async () => {
    expect(await el.evaluate((node) => Object.keys(node).some((k) => k.startsWith("__reactFiber$")))).toBe(true);
  }).toPass({ timeout: 20_000 });
}

/** Dennis as seeded, with the offboarding window restarted now (see the header). */
async function resetDennis() {
  const dennis = await db.employee.findUniqueOrThrow({ where: { employeeNo: DENNIS_NO } });
  await db.asset.updateMany({
    where: { tag: { in: DENNIS_TAGS } },
    data: { assigneeId: dennis.id, status: "DEPLOYED", returnedAt: null, defectiveSince: null, repairEndedAt: null, loanDueAt: null },
  });
  await db.employee.update({
    where: { id: dennis.id },
    data: { employment: "OFFBOARDING", m365Status: "offboarding", offboardingAt: new Date(), offboardingDueAt: dennisDueAt },
  });
  return dennis;
}

/** A second leaver: OFFBOARDING, due in 10 days, holding nothing, M365 inactive — "ready to complete". */
async function addSecondLeaver() {
  const ops = await db.department.findFirstOrThrow({ where: { name: "Operations" } });
  const data = {
    name: SECOND_NAME, title: "Warehouse Associate", departmentId: ops.id,
    employment: "OFFBOARDING" as const, m365Status: "inactive", offboardingAt: new Date(),
    offboardingDueAt: dayFromISO(addDays(localDateISO(new Date()), 10)),
    joinedAt: new Date(Date.now() - 400 * 86_400_000),
  };
  return db.employee.upsert({ where: { employeeNo: SECOND_NO }, create: { employeeNo: SECOND_NO, ...data }, update: data });
}

/** The second leaver stops leaving (ACTIVE clears both offboarding dates, as the schema says). */
async function retireSecondLeaver() {
  await db.employee.updateMany({
    where: { employeeNo: SECOND_NO },
    data: { employment: "ACTIVE", offboardingAt: null, offboardingDueAt: null },
  });
}

test.describe("it-work-ux — offboarding", () => {
  test("1. the queue opens in Attention order; the overdue leaver's action names the work; the overdue count links its filter", async ({ page }) => {
    test.setTimeout(90_000);
    await resetDennis();
    await addSecondLeaver();
    try {
      await login(page, IT);
      await page.goto("/offboarding");
      const rows = page.locator("tbody tr");
      await expect(rows).toHaveCount(2, { timeout: 20_000 });
      // Non-vacuous: by name "Aaron Abad" would lead; Attention puts the 2-days-overdue Dennis first.
      await expect(rows.nth(0)).toContainText("Dennis Ong");
      await expect(rows.nth(0)).toContainText("overdue by 2 d");
      await expect(rows.nth(1)).toContainText(SECOND_NAME);
      await expect(rows.nth(0).getByRole("link", { name: "Collect 3 items" })).toBeVisible();
      await expect(rows.nth(0)).toContainText("0 of 3 decided");
      await expect(page.getByText(/2 people leaving/)).toBeVisible();
      await expectNoSeriousAxe(page);

      await page.getByRole("link", { name: "1 overdue" }).click();
      await page.waitForURL(/due=overdue/);
      await expect(page.locator("tbody tr")).toHaveCount(1);
      await expect(page.locator("tbody tr").first()).toContainText("Dennis Ong");
    } finally {
      await retireSecondLeaver();
      await resetDennis();
    }
  });

  test("2. the wizard opens on Collect without ?step=; no header primary on its own step; More actions lists the three", async ({ page }) => {
    test.setTimeout(90_000);
    const dennis = await resetDennis();
    try {
      await login(page, IT);
      await page.goto(`/offboarding/${dennis.id}`);
      await expect(page.getByRole("heading", { name: "Dennis Ong", level: 1 })).toBeVisible({ timeout: 20_000 });
      const steps = page.getByRole("list", { name: "Offboarding steps" });
      await expect(steps.locator('[aria-current="step"]')).toHaveText(/Collect items/);
      await expect(steps.getByRole("link")).toHaveCount(4);
      await expect(steps.getByRole("link").last()).toHaveText(/Finish/);
      await expect(page.getByText("0 of 3 decided").first()).toBeVisible();
      // Plan P-3: the header's primary would be "Collect 3 items" — the step it names is this one.
      await expect(page.getByRole("link", { name: "Collect 3 items" })).toHaveCount(0);

      const more = page.getByRole("button", { name: "More actions" });
      await waitForHydration(more);
      await more.click();
      await expect(page.getByRole("menuitem")).toHaveText(["Employee record", "Farewell report", "Export sheet"]);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("menuitem")).toHaveCount(0);
      await expectNoSeriousAxe(page);
    } finally {
      await resetDennis();
    }
  });

  test("3. Mark the rest as Returned files every remaining item, one changed to Missing", async ({ page }) => {
    test.setTimeout(90_000);
    const dennis = await resetDennis();
    try {
      await login(page, IT);
      await page.goto(`/offboarding/${dennis.id}?step=collect`);
      const trigger = page.getByRole("button", { name: "Mark the rest as Returned…" });
      await waitForHydration(trigger);
      await trigger.click();
      const dialog = page.getByRole("dialog", { name: "Mark the rest as Returned · Dennis Ong" });
      await expect(dialog).toBeVisible();
      await dialog.getByLabel("BR-PH-0312 · Samsung A54").selectOption("MISSING");
      await dialog.getByLabel("Reason for BR-PH-0312").fill("lost on site");
      await expectNoSeriousAxe(page);
      await dialog.getByRole("button", { name: "File 3 decisions" }).click();

      await expect(page.getByText("3 decisions filed")).toBeVisible();
      await expect(dialog).toBeHidden();
      await expect(page.getByText("3 of 3 decided").first()).toBeVisible();
      // The decided cards' request links sit inside a line of text (axe: link-in-text-block).
      await expectNoSeriousAxe(page);

      const phone = await db.asset.findUniqueOrThrow({ where: { tag: "BR-PH-0312" } });
      expect(phone.status).toBe("MISSING");
      expect(phone.assigneeId).toBeNull();
    } finally {
      await resetDennis();
    }
  });

  test("4. a reasonless Defective is caught on the client: the error shows, the reason field takes focus, nothing is filed", async ({ page }) => {
    test.setTimeout(90_000);
    const dennis = await resetDennis();
    try {
      await login(page, IT);
      await page.goto(`/offboarding/${dennis.id}?step=collect`);
      const card = page.getByRole("group", { name: "Decide BR-LT-0166" });
      await waitForHydration(card);
      await card.getByRole("radiogroup", { name: /Outcome for BR-LT-0166/ }).getByText("Defective").click();
      await card.getByRole("button", { name: "Confirm decision" }).click();

      await expect(card.getByText(/Defective needs a reason \(at least 3 characters\)/)).toBeVisible();
      await expect(card.getByLabel(/Reason/)).toBeFocused();
      // No toast, no decision: the laptop is still Dennis's and still undecided.
      await expect(page.getByText(/BR-LT-0166 → /)).toHaveCount(0);
      await expect(page.getByText("0 of 3 decided").first()).toBeVisible();
      const laptop = await db.asset.findUniqueOrThrow({ where: { tag: "BR-LT-0166" } });
      expect(laptop.assigneeId).toBe(dennis.id);
      await expectNoSeriousAxe(page);
    } finally {
      await resetDennis();
    }
  });

  test("5. Accounts is reachable while items are undecided; clearing a live status asks first and Clear status saves it", async ({ page }) => {
    test.setTimeout(90_000);
    const dennis = await resetDennis();
    try {
      await login(page, IT);
      await page.goto(`/offboarding/${dennis.id}?step=collect`);
      const steps = page.getByRole("list", { name: "Offboarding steps" });
      await waitForHydration(steps.getByRole("link", { name: /Accounts & M365/ }));
      await steps.getByRole("link", { name: /Accounts & M365/ }).click();
      await page.waitForURL(/step=accounts/);
      await expect(page.getByText(/3 items still undecided/)).toBeVisible();

      const status = page.getByLabel("Microsoft 365 account status");
      await waitForHydration(status);
      await status.selectOption({ label: "Never had an account" });
      await page.getByRole("button", { name: "Save account status" }).click();
      const dialog = page.getByRole("dialog", {
        name: "Clear Dennis Ong's Microsoft 365 status? Only do this if they never had an account.",
      });
      await expect(dialog).toBeVisible();
      await expectNoSeriousAxe(page);
      await dialog.getByRole("button", { name: "Clear status" }).click();

      await expect(dialog).toBeHidden();
      await expect(page.getByText("Account status is now never had an account")).toBeVisible();
      expect((await db.employee.findUniqueOrThrow({ where: { id: dennis.id } })).m365Status).toBeNull();
    } finally {
      await resetDennis();
    }
  });

  test("6. Finish: a failed return blocks completion; once clear, Complete offboarding ends on the success card", async ({ page }) => {
    test.setTimeout(120_000);
    const dennis = await resetDennis();
    const second = await addSecondLeaver();
    const it = await db.user.findUniqueOrThrow({ where: { email: IT } });
    const laptop = await db.asset.findUniqueOrThrow({ where: { tag: "BR-LT-0166" } });
    // An EXECUTION_FAILED return on a held item, inside the window (createdAt after offboardingAt).
    const [{ nextval }] = await db.$queryRaw<[{ nextval: bigint }]>`SELECT nextval('approval_ref_seq')`;
    const failed = await db.approval.create({
      data: {
        refNo: `APR-${nextval}`, type: "lifecycle_return", state: "EXECUTION_FAILED", priority: "NORMAL",
        slaAt: new Date(Date.now() + 48 * 3_600_000), requestedById: it.id, claimedById: it.id,
        assetId: laptop.id, employeeId: dennis.id, workerError: "e2e fixture: execution guard refused",
        createdAt: new Date(Date.now() + 1_000),
        payload: { from: { assigneeId: dennis.id }, to: { assigneeId: null, status: "SPARE" }, reason: "offboarding" },
      },
    });
    try {
      await login(page, IT);
      await page.goto(`/offboarding/${dennis.id}?step=report`);
      const checklist = page.getByRole("list", { name: "Ready to complete" });
      await expect(checklist).toBeVisible({ timeout: 20_000 });
      await expect(checklist).toContainText(`Requests · ${failed.refNo} failed to execute`);
      await expect(page.getByRole("button", { name: "Complete offboarding" })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Complete offboarding" })).toHaveCount(0);
      await expectNoSeriousAxe(page);

      // The blocker goes (rejected re-opens the item), the account reads inactive, everything is decided.
      await db.approval.update({ where: { id: failed.id }, data: { state: "REJECTED", resolvedAt: new Date() } });
      await db.employee.update({ where: { id: dennis.id }, data: { m365Status: "inactive" } });
      await page.goto(`/offboarding/${dennis.id}?step=collect`);
      const trigger = page.getByRole("button", { name: "Mark the rest as Returned…" });
      await waitForHydration(trigger);
      await trigger.click();
      const rest = page.getByRole("dialog", { name: "Mark the rest as Returned · Dennis Ong" });
      await rest.getByRole("button", { name: "File 3 decisions" }).click();
      await expect(page.getByText("3 decisions filed")).toBeVisible();

      await page.goto(`/offboarding/${dennis.id}?step=report`);
      await expect(page.getByRole("list", { name: "Ready to complete" })).not.toContainText("failed to execute");
      const complete = page.getByRole("button", { name: "Complete offboarding" });
      await waitForHydration(complete);
      await complete.click();
      const confirm = page.getByRole("dialog", { name: "Complete Dennis Ong's offboarding?" });
      await confirm.getByRole("button", { name: "Complete", exact: true }).click();

      await page.waitForURL(/done=1/);
      await expect(page.getByRole("heading", { name: `Dennis Ong offboarded · 3 decisions · ${fmtDate(new Date())}` })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole("link", { name: "Print farewell report" })).toHaveAttribute("href", `/offboarding/${dennis.id}/report`);
      await expect(page.getByRole("link", { name: "Next leaver →" })).toHaveAttribute("href", `/offboarding/${second.id}`);
      await expectNoSeriousAxe(page);
    } finally {
      await db.approval.updateMany({ where: { id: failed.id, state: "EXECUTION_FAILED" }, data: { state: "REJECTED", resolvedAt: new Date() } });
      await retireSecondLeaver();
      await resetDennis();
    }
  });

  test("7. the farewell report mid-way: a Back control, the DRAFT line and Still to decide", async ({ page }) => {
    test.setTimeout(90_000);
    const dennis = await resetDennis();
    try {
      await login(page, IT);
      await page.goto(`/offboarding/${dennis.id}/report`);
      await expect(page.getByRole("button", { name: "Back" })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText("DRAFT — 3 items undecided")).toBeVisible();
      await expect(page.getByText("Still to decide")).toBeVisible();
      for (const tag of DENNIS_TAGS) await expect(page.getByText(new RegExp(`^${tag} · `))).toBeVisible();
      await expectNoSeriousAxe(page);
    } finally {
      await resetDennis();
    }
  });
});

test.describe("it-work-ux — the worklist", () => {
  test("8. a Triage row's Triage… opens the triage dialog in place; saving settles it and the row leaves", async ({ page }) => {
    test.setTimeout(90_000);
    // BR-PH-0301: a seeded IT spare with no open request (BR-LT-0181, the other obvious one, is held by APR-2041).
    const spare = await db.asset.findUniqueOrThrow({ where: { tag: "BR-PH-0301" } });
    expect(spare.status).toBe("SPARE");
    expect(await db.approval.count({ where: { assetId: spare.id, state: { in: ["PENDING", "CLAIMED", "APPROVED"] } } })).toBe(0);
    await db.asset.update({ where: { id: spare.id }, data: { returnedAt: new Date(Date.now() - 2 * 86_400_000) } });
    try {
      await login(page, IT);
      await page.goto("/inventory/work");
      const row = page.locator("#triage li").filter({ hasText: spare.tag });
      await expect(row).toBeVisible({ timeout: 20_000 });
      const triage = row.getByRole("button", { name: "Triage…" });
      await waitForHydration(triage);
      await triage.click();
      const dialog = page.getByRole("dialog", { name: `Triage ${spare.tag} · ${spare.model}` });
      await expect(dialog).toBeVisible();
      await expectNoSeriousAxe(page);
      await dialog.getByRole("button", { name: "Save decision" }).click();

      await expect(page.getByText(`${spare.tag} triaged · Keep as spare`)).toBeVisible();
      await expect(dialog).toBeHidden();
      await expect(page.locator("li").filter({ hasText: spare.tag })).toHaveCount(0);
      expect((await db.asset.findUniqueOrThrow({ where: { id: spare.id } })).returnedAt).toBeNull();
    } finally {
      await db.asset.update({ where: { id: spare.id }, data: { returnedAt: null, status: "SPARE" } });
    }
  });

  test("9. Hide until tomorrow takes a Loans row off the list; Undo in the toast brings it back", async ({ page }) => {
    test.setTimeout(90_000);
    const it = await db.user.findUniqueOrThrow({ where: { email: IT } });
    try {
      await login(page, IT);
      await page.goto("/inventory/work");
      const loans = page.locator("#loans");
      const row = loans.locator("ol > li").filter({ hasText: "BR-LT-0210" });
      await expect(row).toBeVisible({ timeout: 20_000 });
      await expect(page.locator("#work-loans")).not.toContainText("hidden today");

      const menu = row.getByRole("button", { name: "Actions for BR-LT-0210" });
      await waitForHydration(menu);
      await menu.click();
      await page.getByRole("menuitem", { name: "Hide until tomorrow" }).click();
      await expect(row).toHaveCount(0);
      await expect(page.locator("#work-loans")).toContainText("· 1 hidden today");
      await expect(loans.getByRole("button", { name: "Show", exact: true })).toBeVisible();

      await page.getByRole("button", { name: "Undo" }).click();
      await expect(loans.locator("ol > li").filter({ hasText: "BR-LT-0210" })).toBeVisible();
      await expect(page.locator("#work-loans")).not.toContainText("hidden today");
      await expectNoSeriousAxe(page);
    } finally {
      // Undo already cleared it; if the case failed half-way, take the key back out of today's list.
      const pref = await db.userPreference.findUnique({ where: { userId_key: { userId: it.id, key: "home:dismissed" } } });
      const value = pref?.value as { date?: string; keys?: string[] } | undefined;
      if (pref && value?.keys?.some((k) => k.startsWith("loans:"))) {
        await db.userPreference.update({
          where: { id: pref.id },
          data: { value: { date: value.date ?? localDateISO(new Date()), keys: value.keys.filter((k) => !k.startsWith("loans:")) } },
        });
      }
    }
  });

  test("10. the Worklist nav badge counts exactly the rows the worklist lists", async ({ page }) => {
    test.setTimeout(90_000);
    await login(page, IT);
    await page.goto("/inventory/work");
    const rows = page.locator('section[aria-labelledby^="work-"] > ol > li');
    await expect(rows.first()).toBeVisible({ timeout: 20_000 });
    // An uncapped page: every section's heading count is exact, not "{n}+".
    for (const heading of await page.locator('section[aria-labelledby^="work-"] h2').allInnerTexts()) {
      expect(heading).not.toContain("+");
    }
    const listed = await rows.count();
    expect(listed).toBeGreaterThan(0);

    const link = page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: /^Worklist/ }).first();
    const badge = link.locator('[aria-label$="waiting on the worklist"]');
    await expect(badge).toHaveText(String(listed));
    await expect(badge).toHaveAttribute("aria-label", `${listed} waiting on the worklist`);
    await expectNoSeriousAxe(page);
  });

  test("11. a viewer's Home shows the Worklist card read-only: Open links, no row menus, no Claimed by you", async ({ page }) => {
    test.setTimeout(90_000);
    await login(page, VIEWER);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Worklist", exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("link", { name: "Open worklist" })).toBeVisible();
    const rows = page.locator('section[aria-labelledby^="work-"] > ol > li');
    await expect(rows.first()).toBeVisible();
    const n = await rows.count();
    for (let i = 0; i < n; i++) {
      await expect(rows.nth(i).getByRole("link")).toHaveText("Open");
      await expect(rows.nth(i).getByRole("button")).toHaveCount(0);
    }
    await expect(page.getByRole("button", { name: /^Actions for / })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Claimed by you" })).toHaveCount(0);
    await expectNoSeriousAxe(page);
  });
});

test.describe("it-work-ux — the scan card and holds", () => {
  test("12. the scan card gives IT the held device's Return…, opening the record's own Return dialog", async ({ page }) => {
    test.setTimeout(90_000);
    await login(page, IT);
    await page.goto("/inventory/scan/BR-LT-0201");
    const ret = page.getByRole("button", { name: "Return…" });
    await expect(ret).toBeVisible({ timeout: 20_000 });
    await waitForHydration(ret);
    await ret.click();
    const dialog = page.getByRole("dialog", { name: "Return BR-LT-0201 · MacBook Air M3 from Carlo Dizon?" });
    await expect(dialog).toBeVisible();
    await expectNoSeriousAxe(page);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    const laptop = await db.asset.findUniqueOrThrow({ where: { tag: "BR-LT-0201" }, include: { assignee: true } });
    expect(laptop.assignee?.name).toBe("Carlo Dizon");
  });

  test("13. the scan card on a leaver's device points at the wizard's Collect step", async ({ page }) => {
    test.setTimeout(90_000);
    const dennis = await resetDennis();
    try {
      await login(page, IT);
      await page.goto("/inventory/scan/BR-HS-0510");
      const line = page.getByRole("link", { name: "Dennis Ong is leaving · collect it in the offboarding wizard →" });
      await expect(line).toBeVisible({ timeout: 20_000 });
      await expect(line).toHaveAttribute("href", `/offboarding/${dennis.id}?step=collect`);
      await expectNoSeriousAxe(page);
    } finally {
      await resetDennis();
    }
  });

  test("14. a viewer's scan card offers no action and still opens the full record", async ({ page }) => {
    test.setTimeout(90_000);
    await login(page, VIEWER);
    await page.goto("/inventory/scan/BR-LT-0201");
    await expect(page.getByRole("link", { name: "Open full record" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: /^(Return…|Triage…|Mark checked|Assign…)$/ })).toHaveCount(0);
    await expectNoSeriousAxe(page);
  });

  test("15. /reservations: a hold's row menu hands the spare to its person — Assign opens with them preset", async ({ page }) => {
    test.setTimeout(90_000);
    // Our own hold (a spare and a person), so the seeded BR-MN-0910 hold stays untouched.
    const ops = await db.department.findFirstOrThrow({ where: { name: "Operations" } });
    const monitor = await db.assetCategory.findFirstOrThrow({ where: { name: "Monitor" } });
    const person = await db.employee.upsert({
      where: { employeeNo: "EMP-0322" },
      create: {
        employeeNo: "EMP-0322", name: "Bea Villanueva", title: "Planner", departmentId: ops.id,
        employment: "ACTIVE", m365Status: "active", joinedAt: new Date(Date.now() - 500 * 86_400_000),
      },
      update: {},
    });
    const spare = await db.asset.upsert({
      where: { tag: "BR-MN-9322" },
      create: {
        tag: "BR-MN-9322", model: "e2e hold fixture", categoryId: monitor.id, cls: "IT", status: "SPARE",
        itVerifiedAt: new Date(),
      },
      update: {},
    });
    const hold = await db.reservation.create({
      data: {
        assetId: spare.id, employeeId: person.id, state: "ACTIVE", reason: "e2e hand-over",
        expiresAt: dayFromISO(addDays(localDateISO(new Date()), 7)),
      },
    });
    try {
      await login(page, IT);
      await page.goto("/reservations");
      const menu = page.getByRole("button", { name: `Actions for ${spare.tag}` });
      await expect(menu).toBeVisible({ timeout: 20_000 });
      await waitForHydration(menu);
      await menu.click();
      await expect(page.getByRole("menuitem", { name: "Release…" })).toBeVisible();
      await page.getByRole("menuitem", { name: `Assign to ${person.name}…` }).click();

      const dialog = page.getByRole("dialog", { name: `Assign ${spare.tag} · ${spare.model}` });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByLabel("Assign to")).toHaveValue(new RegExp(person.name));
      await expect(dialog.getByText(`Held for ${person.name} — assigning to anyone else is refused`)).toBeVisible();
      await expectNoSeriousAxe(page);
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(dialog).toBeHidden();
      const after = await db.asset.findUniqueOrThrow({ where: { id: spare.id } });
      expect(after.assigneeId).toBeNull();
    } finally {
      await db.reservation.updateMany({
        where: { id: hold.id, state: "ACTIVE" },
        data: { state: "RELEASED", resolvedAt: new Date() },
      });
    }
  });
});
