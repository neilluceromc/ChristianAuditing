import { test, expect, type Locator, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import { SEED_PASSWORD } from "../prisma/fixtures";
import { defaultOffboardingDue } from "@/lib/deadlines";
import { localDateISO } from "@/lib/format";

/**
 * Phase 25, Task 7 — the IT navigation sweep end to end (spec §3–§6). Thirteen
 * cases, each independent: its own fixtures, no serial dependency, and a
 * `finally` that puts back every MUTABLE field it changed, so a failure in one
 * never cascades into the next.
 *   1  (§3.1/§3.2) Start offboarding from the profile: prefilled dialog, the
 *      wizard as the landing place, exactly one audit row, and the profile
 *      afterwards (no button, frozen banner, due pill).
 *   2  (§3.1) the server floor is the rule: a past date is refused and nothing
 *      moves; a viewer never sees the button at all.
 *   3  (§4 row 3) the wizard's collect step links the request that owns an item.
 *   4  (§4 rows 1–2) the asset record's pending banner and the asset timeline
 *      both link the same request.
 *   5  (§4 row 5) the employee timeline links requests, their assets, and holds.
 *   6  (§4 row 4) both activity feeds carry an entity link chip.
 *   7  (§4 row 8) a HOLD marker names the person AND links to them — clicking
 *      the name must not open the asset the row otherwise opens.
 *   8  (§4 row 6) the profile lists the open requests its count claims.
 *   9  (§4 row 7) the fleet bar's legend is a link into the filtered inventory.
 *   10 (§5.1) the new-hire finish line: focus, banner, and the two next steps.
 *   11 (§5.2) employees list parity: sortable headers and whole-row click.
 *   12 (§6.4/§6.5/§3.4) offboarding facets narrow each other, Export downloads
 *      a dated sheet, and a completed leaver's pill reads "closed".
 *   13 (§4 row 9) /audit labels a department by name, not by id.
 *
 * Seeded fixtures this file depends on (prisma/seed.ts), read off the seed
 * rather than assumed from the brief:
 *   Carlo Dizon EMP-0099 — ACTIVE, Operations, holds BR-LT-0201 only, and is
 *     named by NO approval at all: the cleanest Start-offboarding fixture.
 *   Nina Robles EMP-0097 — ACTIVE, the ONLY employee with an employee-scoped
 *     open approval (APR-2041, PENDING, on BR-LT-0181), and the ONLY holder of
 *     an ACTIVE reservation (BR-MN-0910), so she is both the "Open requests"
 *     and the HOLD fixture.
 *   BR-LT-0148 — carries APR-2039 (CLAIMED), the one asset with a pending
 *     request, so it is the banner/timeline fixture.
 *   Dennis Ong EMP-0090 — the one OFFBOARDING row (two days overdue), holding
 *     BR-LT-0166 / BR-PH-0312 / BR-HS-0510, with nothing decided.
 *   Faith Mercado EMP-0093 — OFFBOARDED with `offboardingDueAt: null` (the seed
 *     sets a due date only for OFFBOARDING), so case 12 has to put a date on
 *     her itself to see the "closed" pill, and take it off again.
 *   The seed writes only THREE audit entries, all `entityType: "asset"` on
 *     BR-LT-0148 — none for an employee — so case 6 seeds its own newest
 *     employee row rather than leaning on what case 1 happens to leave behind.
 *
 * R3 (controller ruling): `AuditEntry` is append-only at the database — a
 * trigger refuses deletes — so no case here deletes an audit row. Each one
 * restores the MUTABLE state it touched instead; leftover audit rows are inert,
 * and `beforeAll` reseeds anyway.
 */

const db = new PrismaClient();

test.beforeAll(() => {
  execSync("npm run db:seed", { timeout: 120_000 });
});
test.afterAll(async () => {
  await db.$disconnect();
});

// Copied from e2e/it-gaps.spec.ts:83-89 (itself from e2e/transfers.spec.ts) —
// house rule: never import helpers across spec files, since each file reseeds
// independently.
async function login(page: Page, email: string) {
  await page.goto("/logout");
  await page.getByLabel(/Email/).fill(email);
  await page.getByLabel(/Password/).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

// Copied from e2e/it-gaps.spec.ts:92-97.
async function expectNoSeriousAxe(page: Page) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(700);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
}

// Copied from e2e/it-gaps.spec.ts:100-108.
async function waitForHydration(target: Locator) {
  const el = target.first();
  await el.waitFor({ state: "attached", timeout: 20_000 });
  await expect(async () => {
    expect(await el.evaluate((node) => Object.keys(node).some((k) => k.startsWith("__reactFiber$")))).toBe(
      true,
    );
  }).toPass({ timeout: 20_000 });
}

/**
 * One facet dropdown's option counts, keyed by the label the operator reads.
 * The counts live in a second `<span>` beside the option label inside each
 * `<label>` row (facet-dropdown.tsx) — `Checkbox` is a bare `<input>`, so those
 * two spans are the only ones there. The trigger is found by its
 * `aria-haspopup="dialog"`, not by role+name, because a sortable table header
 * on the same page is also a `<button>` whose name can start with the facet's
 * own word.
 */
async function facetCounts(page: Page, facet: string): Promise<Record<string, string>> {
  const trigger = page.locator('button[aria-haspopup="dialog"]').filter({ hasText: facet });
  await waitForHydration(trigger);
  await trigger.click();
  const dropdown = page.getByRole("dialog", { name: `Filter by ${facet}` });
  const options = dropdown.locator("label");
  await expect(options.first()).toBeVisible();
  const counts: Record<string, string> = {};
  for (let i = 0; i < (await options.count()); i += 1) {
    const spans = options.nth(i).locator("span");
    counts[(await spans.first().innerText()).trim()] = (await spans.last().innerText()).trim();
  }
  await page.keyboard.press("Escape");
  await expect(dropdown).toBeHidden();
  return counts;
}

const IT = "it@thebackroomop.com";
const ADMIN = "admin@thebackroomop.com";
const VIEWER = "viewer@thebackroomop.com";

test.describe("it navigation sweep (Phase 25)", () => {
  test("1. Start offboarding: IT sees the button on an active employee, the dialog is prefilled, submit lands in the wizard and writes one audit row", async ({ page }) => {
    const carlo = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0099" } });
    const before = await db.auditEntry.count({ where: { entityType: "employee", entityId: carlo.id } });
    try {
      await login(page, IT);
      await page.goto(`/employees/${carlo.id}`);
      const startButton = page.getByRole("button", { name: "Start offboarding" });
      await waitForHydration(startButton);
      await startButton.click();

      const dialog = page.getByRole("dialog", { name: `Start offboarding ${carlo.name}` });
      await waitForHydration(dialog);
      const today = localDateISO(new Date());
      await expect(dialog.getByLabel("Complete by")).toHaveValue(defaultOffboardingDue(today));
      // "Start", exact — `getByRole` name matching is a substring, and the
      // dialog's own heading is "Start offboarding <name>".
      await dialog.getByRole("button", { name: "Start", exact: true }).click();
      await page.waitForURL(`**/offboarding/${carlo.id}`);

      const after = await db.employee.findUniqueOrThrow({ where: { id: carlo.id } });
      expect(after.employment).toBe("OFFBOARDING");
      expect(after.offboardingDueAt && localDateISO(after.offboardingDueAt)).toBe(defaultOffboardingDue(today));
      // Read-only (R3): the row itself is never deleted, only counted.
      expect(await db.auditEntry.count({ where: { entityType: "employee", entityId: carlo.id } })).toBe(before + 1);
      // …and read, so the DIFF the action writes is pinned too (spec §8 case 1
      // asks for "one update row WITH the three fields"; final review I-4a).
      const row = await db.auditEntry.findFirst({
        where: { entityType: "employee", entityId: carlo.id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      expect(row?.action).toBe("update");
      const diff = row!.diff as Record<string, { from: unknown; to: unknown }>;
      expect(Object.keys(diff).sort()).toEqual(["employment", "offboardingAt", "offboardingDueAt"]);
      expect(diff.employment).toEqual({ from: "ACTIVE", to: "OFFBOARDING" });
      // Prisma stores a `Date` inside a `Json` column as its ISO string, which
      // is exactly what `diffOf` would have produced — the assertion that makes
      // the hand-built diff (parked M-P25-1) safe to leave as it is.
      expect(diff.offboardingAt.to).toBe(after.offboardingAt!.toISOString());
      expect(diff.offboardingDueAt.to).toBe(after.offboardingDueAt!.toISOString());

      await page.goto(`/employees/${carlo.id}`);
      await expect(page.getByRole("button", { name: "Start offboarding" })).toHaveCount(0);
      await expect(page.getByText("Offboarding in progress — slots are frozen")).toBeVisible();
      await expect(page.getByText(/due in \d+ d|due today/)).toBeVisible();
      await expectNoSeriousAxe(page);
    } finally {
      await db.employee.update({
        where: { id: carlo.id },
        data: { employment: "ACTIVE", offboardingAt: null, offboardingDueAt: null },
      });
    }
  });

  test("2. the completion-date floor is the server's, and a viewer never gets the button", async ({ page }) => {
    const carlo = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0099" } });
    try {
      await login(page, IT);
      await page.goto(`/employees/${carlo.id}`);
      const startButton = page.getByRole("button", { name: "Start offboarding" });
      await waitForHydration(startButton);
      await startButton.click();

      const dialog = page.getByRole("dialog", { name: `Start offboarding ${carlo.name}` });
      await waitForHydration(dialog);
      const due = dialog.getByLabel("Complete by");
      // `min` is a courtesy, not the rule — drop it so the request actually
      // reaches the server and the SERVER's refusal is what gets asserted.
      await due.evaluate((el) => el.removeAttribute("min"));
      await due.fill("2026-01-01");
      await dialog.getByRole("button", { name: "Start", exact: true }).click();

      await expect(dialog.getByText("Pick today or later")).toBeVisible();
      const after = await db.employee.findUniqueOrThrow({ where: { id: carlo.id } });
      expect(after.employment).toBe("ACTIVE");
      expect(after.offboardingDueAt).toBeNull();

      await login(page, VIEWER);
      await page.goto(`/employees/${carlo.id}`);
      await expect(page.getByRole("button", { name: "Start offboarding" })).toHaveCount(0);
      await expectNoSeriousAxe(page);
    } finally {
      // The refusal path writes nothing; this is the belt-and-braces restore in
      // case a regression ever lets the floor through.
      await db.employee.update({
        where: { id: carlo.id },
        data: { employment: "ACTIVE", offboardingAt: null, offboardingDueAt: null },
      });
    }
  });

  test("3. the wizard's collect step links the request that owns an item", async ({ page }) => {
    const dennis = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0090" } });
    const headset = await db.asset.findUniqueOrThrow({ where: { tag: "BR-HS-0510" } });
    const itUser = await db.user.findUniqueOrThrow({ where: { email: IT } });
    const created = await db.approval.create({
      data: {
        refNo: "APR-9901", type: "lifecycle_return", state: "PENDING", priority: "NORMAL",
        slaAt: new Date(Date.now() + 86_400_000),
        requestedById: itUser.id, assetId: headset.id, employeeId: dennis.id,
        payload: { to: { status: "SPARE" }, reason: "e2e" },
      },
    });
    try {
      await login(page, IT);
      // `?step=collect` is the id WizardSteps itself builds (WIZARD_STEPS in
      // src/lib/offboarding.ts), not a label.
      await page.goto(`/offboarding/${dennis.id}?step=collect`);
      const ref = page.getByRole("link", { name: "APR-9901" });
      await expect(ref).toHaveAttribute("href", `/approvals/${created.id}`);
      await ref.click();
      await page.waitForURL(`**/approvals/${created.id}`);
      await expect(page.getByRole("heading", { name: "APR-9901", level: 1 })).toBeVisible();
      await expectNoSeriousAxe(page);
    } finally {
      await db.approval.delete({ where: { id: created.id } });
    }
  });

  test("4. the asset record's pending banner and the asset timeline link the same request", async ({ page }) => {
    const asset = await db.asset.findUniqueOrThrow({ where: { tag: "BR-LT-0148" } });
    const approval = await db.approval.findFirstOrThrow({ where: { refNo: "APR-2039" } });

    await login(page, IT);
    await page.goto(`/inventory/${asset.id}`);
    await expect(page.getByRole("link", { name: "Open request" })).toHaveAttribute("href", `/approvals/${approval.id}`);

    await page.goto(`/inventory/${asset.id}/timeline`);
    await expect(page.getByRole("link", { name: "APR-2039" })).toHaveAttribute("href", `/approvals/${approval.id}`);
    await expectNoSeriousAxe(page);
  });

  test("5. the employee timeline links the request, the asset it names, and the held spare", async ({ page }) => {
    const nina = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0097" } });
    const approval = await db.approval.findFirstOrThrow({ where: { refNo: "APR-2041" } });
    const requested = await db.asset.findUniqueOrThrow({ where: { tag: "BR-LT-0181" } });
    const reserved = await db.asset.findUniqueOrThrow({ where: { tag: "BR-MN-0910" } });

    await login(page, IT);
    await page.goto(`/employees/${nina.id}/timeline`);
    await expect(page.getByRole("link", { name: "APR-2041" })).toHaveAttribute("href", `/approvals/${approval.id}`);
    await expect(page.getByRole("link", { name: "BR-LT-0181" })).toHaveAttribute("href", `/inventory/${requested.id}`);
    await expect(page.getByRole("link", { name: "BR-MN-0910" })).toHaveAttribute("href", `/inventory/${reserved.id}`);
    await expectNoSeriousAxe(page);
  });

  test("6. both activity feeds carry an entity link chip", async ({ page }) => {
    const carlo = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0099" } });
    // The seed writes no employee audit entry at all, so this case creates its
    // own newest one rather than depending on what an earlier case left behind.
    // It is never removed: AuditEntry is append-only (R3), the row is inert, and
    // `beforeAll` reseeds the file.
    await db.auditEntry.create({
      data: {
        actorLabel: "e2e it-nav", entityType: "employee", entityId: carlo.id,
        action: "update", diff: { title: { from: carlo.title, to: carlo.title } },
      },
    });

    await login(page, IT);
    await page.goto("/inventory/activity");
    // The feed's `<ol>` is the only ordered list on this page — the header
    // carries no breadcrumb — and the avatar beside the chip is not a link.
    await expect(page.locator("ol li a").first()).toHaveAttribute("href", /^\/inventory\/.+/);

    await page.goto("/employees/activity");
    await expect(page.locator("ol li a").first()).toHaveAttribute("href", `/employees/${carlo.id}`);
    await expectNoSeriousAxe(page);
  });

  test("7. a HOLD marker names the person and links to them, not to the asset the row opens", async ({ page }) => {
    const nina = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0097" } });

    await login(page, IT);
    // A PARTIAL tag, deliberately: the USB-scanner contract redirects an exact
    // tag match straight to the record (`exactTagMatch` in
    // src/server/modules/inventory/queries.ts), and this case needs the LIST.
    // "MN-0910" fails TAG_SHAPE, so it stays a contains-search, and only
    // BR-MN-0910 contains it.
    await page.goto("/inventory?q=MN-0910");
    const row = page.locator("tbody tr").filter({ hasText: "BR-MN-0910" });
    await expect(row).toContainText("HOLD");
    const holder = row.getByRole("link", { name: "Nina Robles" });
    await expect(holder).toHaveAttribute("href", `/employees/${nina.id}`);

    await waitForHydration(row);
    await holder.click();
    await page.waitForURL(`**/employees/${nina.id}`);
    await expect(page.getByRole("heading", { name: "Nina Robles", level: 1 })).toBeVisible();
    await expectNoSeriousAxe(page);
  });

  test("8. the profile lists the open requests its count claims", async ({ page }) => {
    const nina = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0097" } });
    const approval = await db.approval.findFirstOrThrow({ where: { refNo: "APR-2041" } });

    await login(page, IT);
    await page.goto(`/employees/${nina.id}`);
    // Stat renders label and value as two spans in one wrapper.
    await expect(page.getByText("Open requests", { exact: true }).locator("..")).toContainText("1");
    await expect(page.getByRole("link", { name: "APR-2041" })).toHaveAttribute("href", `/approvals/${approval.id}`);
    await expectNoSeriousAxe(page);
  });

  test("9. the fleet bar's legend links into the inventory filtered to that status", async ({ page }) => {
    await login(page, IT);
    await page.goto("/");
    // exact — the segment beside it names itself "DEPLOYED: N assets" (sr-only).
    const legend = page.getByRole("link", { name: "DEPLOYED", exact: true });
    await expect(legend).toHaveAttribute("href", "/inventory?status=DEPLOYED");
    // The SEGMENT is the control this phase actually invented (percentage
    // width, sr-only name, inside an overflow-hidden wrapper), so it is the one
    // asserted and clicked; the legend copy only has to agree with it (I-4b).
    const segment = page.getByRole("link", { name: /^DEPLOYED: \d+ assets$/ });
    await expect(segment).toHaveAttribute("href", "/inventory?status=DEPLOYED");
    expect(await legend.getAttribute("href")).toBe(await segment.getAttribute("href"));
    await segment.click();
    await page.waitForURL(/\/inventory\?status=DEPLOYED$/);

    const rows = page.locator("tbody tr");
    // `count()` does not auto-wait, so the table has to be on screen first.
    await expect(rows.first()).toBeVisible();
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(0);
    await expect(rows.locator("td").filter({ hasText: /^DEPLOYED$/ })).toHaveCount(rowCount);
    // A dropdown read, not `toContainText("1")` on the facet trigger — that
    // would also pass on a badge reading "11" or "21" (M-P25-5). The Status
    // facet counts WITHOUT its own selection (`facetOptions`' `without(facet)`),
    // so DEPLOYED's option count is exactly what the filtered list shows.
    expect((await facetCounts(page, "Status")).DEPLOYED).toBe(String(rowCount));
    await expectNoSeriousAxe(page);
  });

  test("10. the new-hire finish line: the first field has focus, and the banner offers both next steps", async ({ page }) => {
    try {
      await login(page, ADMIN);
      await page.goto("/employees/new");
      const name = page.getByLabel("Name");
      await waitForHydration(name);
      // autoFocus only takes effect at hydration, so this is asserted BEFORE
      // any fill moves the caret somewhere else.
      await expect(name).toBeFocused();

      await page.getByLabel("Employee number").fill("EMP-9902");
      await name.fill("Nav Test");
      await page.getByLabel("Title").fill("Tester");
      await page.getByLabel("Department").selectOption({ label: "Operations" });
      await page.getByLabel("Joined").fill(localDateISO(new Date()));
      await page.getByRole("button", { name: "Create employee" }).click();
      await page.waitForURL(/\/employees\/[^/?]+\?created=1$/);

      const hire = await db.employee.findFirstOrThrow({ where: { employeeNo: "EMP-9902" } });
      await expect(page).toHaveURL(new RegExp(`/employees/${hire.id}\\?created=1$`));
      await expect(page.getByText("Nav Test added · EMP-9902")).toBeVisible();
      await expect(page.getByRole("link", { name: "Assign devices" })).toHaveAttribute("href", "#loadout");
      // The banner renders above the PageHeader, whose actions repeat the same
      // href — first() is the banner's own copy.
      await expect(page.getByRole("link", { name: "Accountability form" }).first())
        .toHaveAttribute("href", `/employees/${hire.id}/form`);
      await expectNoSeriousAxe(page);
    } finally {
      // The audit row this create wrote stays (R3); the employee itself goes.
      await db.employee.deleteMany({ where: { employeeNo: "EMP-9902" } });
    }
  });

  test("11. the employees list sorts from its headers and opens a record from anywhere in the row", async ({ page }) => {
    const dennis = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0090" } });
    const nina = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0097" } });

    await login(page, IT);
    await page.goto("/employees");
    const joined = page.getByRole("button", { name: "Joined" });
    await waitForHydration(joined);
    await joined.click();
    await page.waitForURL(/sort=joinedAt/);
    // Faith Mercado (−1300 d) is OFFBOARDED and hidden by default, so the
    // earliest VISIBLE joiner is Dennis Ong at −1100 d.
    await expect(page.locator("tbody tr").first()).toContainText(dennis.employeeNo);

    await page.getByRole("button", { name: "Joined" }).click();
    await page.waitForURL(/sort=-joinedAt/);
    await expect(page.locator("tbody tr").first()).toContainText(nina.employeeNo);

    const firstRow = page.locator("tbody tr").first();
    await waitForHydration(firstRow);
    await firstRow.focus();
    await page.keyboard.press("Enter");
    await page.waitForURL(`**/employees/${nina.id}`);

    await page.goBack();
    await page.waitForURL(/sort=-joinedAt/);
    const backRow = page.locator("tbody tr").first();
    await waitForHydration(backRow);
    // The Department cell — a plain cell, no link of its own: the ROW is what
    // carries the click.
    await backRow.locator("td").nth(1).click();
    await page.waitForURL(`**/employees/${nina.id}`);
    await expect(page.getByRole("heading", { name: "Nina Robles", level: 1 })).toBeVisible();
    await expectNoSeriousAxe(page);
  });

  test("12. offboarding facets narrow each other, Export downloads a dated sheet, and a completed leaver reads \"closed\"", async ({ page }) => {
    const faith = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0093" } });

    await login(page, IT);
    await page.goto("/offboarding");
    const baseProgress = await facetCounts(page, "Progress");
    // One leaver in the seed (Dennis Ong), two days overdue, nothing decided.
    expect(baseProgress).toEqual({ "Has undecided items": "1", "All decided": "0" });

    // A `due` filter must not change the Progress counts here: the single row
    // passes it, so narrowing by it narrows nothing.
    await page.goto("/offboarding?due=overdue");
    expect(await facetCounts(page, "Progress")).toEqual(baseProgress);

    // …and the other way round: with `progress=complete` active, no row
    // survives, so BOTH Due counts fall to zero.
    await page.goto("/offboarding?progress=complete");
    expect(await facetCounts(page, "Due")).toEqual({ Overdue: "0", "On track": "0" });

    await page.goto("/offboarding");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "Export" }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^offboarding-\d{4}-\d{2}-\d{2}\.xlsx$/);

    // The seed gives its OFFBOARDED row no due date at all (offboardingDueAt is
    // set only for OFFBOARDING), so the pill this asserts needs one put there.
    // Read first, restore to what was read (M-8): hard-coding `null` back would
    // silently become a fixture mutation the day the seed dates this row.
    const faithBefore = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0093" } });
    await db.employee.update({
      where: { id: faith.id },
      data: { offboardingDueAt: new Date(Date.now() - 5 * 86_400_000) },
    });
    try {
      await page.goto(`/offboarding/${faith.id}`);
      // Not "5 d overdue": a closed case is neither overdue nor on track, and
      // `DuePill.override` says so.
      await expect(page.locator("header").getByText("closed", { exact: true })).toBeVisible();
      await expectNoSeriousAxe(page);
    } finally {
      await db.employee.update({ where: { id: faith.id }, data: { offboardingDueAt: faithBefore.offboardingDueAt } });
    }
  });

  test("13. /audit labels a department by name, not by id", async ({ page }) => {
    const ops = await db.department.findFirstOrThrow({ where: { name: "Operations" } });
    try {
      await login(page, ADMIN);
      await page.goto("/admin/departments");
      const actions = page.getByRole("button", { name: "Actions for Operations" });
      await waitForHydration(actions);
      await actions.click();
      await page.getByRole("menuitem", { name: "Rename" }).click();

      // The rename input only exists once the menu item has opened it; Enter is
      // ref-table.tsx's save gesture (blur cancels).
      const input = page.getByLabel("Rename Operations");
      await input.fill("Operations X");
      await input.press("Enter");
      await expect(page.getByText("Operations X", { exact: true })).toBeVisible();

      await page.goto("/audit");
      const newest = page.locator("tbody tr").first();
      await expect(newest).toContainText("department");
      await expect(newest).toContainText("rename");
      await expect(newest).toContainText("Operations X");
      await expectNoSeriousAxe(page);
    } finally {
      // The rename's audit row stays (R3); the name goes back.
      await db.department.update({ where: { id: ops.id }, data: { name: "Operations" } });
    }
  });
});
