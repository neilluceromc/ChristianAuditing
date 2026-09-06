import { test, expect, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { toXlsxBuffer } from "@/server/xlsx/write";
import { ASSET_EXPORT_COLUMNS } from "@/lib/export-columns";
import { ROLE_LANDING } from "@/lib/workspaces";
import { SEED_PASSWORD } from "../prisma/fixtures";

/**
 * Phase 13 — asset classes. Twenty cases across six surfaces: Purchasing
 * registration and its class gate, Finance's two tabs and send-back, the
 * IT-only Secrets surface, class-aware status controls and approvals, the
 * leaver wizard with a car, the two database triggers, the category admin,
 * the page gates, the create form, and the import wizard's refusal.
 *
 * Case 15 is dropped — do not write it, do not renumber.
 *
 * Never reference a raw cuid — the DB reseeds and cuids change every run.
 * Assets are referenced by tag, employees by employeeNo, categories by name.
 */

const db = new PrismaClient();

test.beforeAll(() => {
  execSync("npm run db:seed", { timeout: 120_000 });
});
test.afterAll(async () => {
  await db.$disconnect();
});

// Copied from e2e/receiving.spec.ts — the helper that actually works against
// this login page (the plan's own draft was untested against the real form).
async function login(page: Page, email: string) {
  await page.goto("/logout");
  await page.getByLabel(/Email/).fill(email);
  await page.getByLabel(/Password/).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

const idOf = async (tag: string) => (await db.asset.findUniqueOrThrow({ where: { tag }, select: { id: true } })).id;

/** Highest number in use under a prefix — never hardcode 0003; an earlier test may have registered more. */
async function highestNumber(prefix: string): Promise<number> {
  const rows = await db.asset.findMany({ where: { tag: { startsWith: `BR-${prefix}-` } }, select: { tag: true } });
  return rows.reduce((max, r) => Math.max(max, Number(r.tag.slice(6))), 0);
}
const tagOf = (prefix: string, n: number) => `BR-${prefix}-${String(n).padStart(4, "0")}`;

let vehicleCategoryId: string;
let sedanTypeId: string;
let registeredTag: string;

test.beforeAll(async () => {
  const vehicle = await db.assetCategory.findFirstOrThrow({ where: { name: "Vehicle" } });
  vehicleCategoryId = vehicle.id;
  sedanTypeId = (await db.assetType.findFirstOrThrow({ where: { name: "Sedan", categoryId: vehicle.id } })).id;
});

test.describe("registration — each class is its own department's", () => {
  test.describe.configure({ mode: "serial" });

  test("1. Purchasing registers a Vehicle → PURCHASING, STORED, prefix VH", async ({ page }) => {
    registeredTag = tagOf("VH", (await highestNumber("VH")) + 1);
    await login(page, "purchasing@thebackroomop.com");
    await page.goto("/inventory/register");

    await page.getByLabel("Category").selectOption({ label: "Vehicle" });
    await page.getByLabel("Type").selectOption({ label: "Sedan" });
    await page.getByLabel("Model").fill("Toyota Corolla Cross (e2e)");
    await page.getByLabel("Quantity").fill("1");
    await expect(page.getByLabel("Prefix")).toHaveValue("VH");
    await expect(page.getByLabel("Tag 1")).toHaveValue(registeredTag);

    // Selector fixed from the plan's draft: quantity 1 renders the button
    // "Register asset" (no leading count) — register-form.tsx's ternary only
    // prepends the number when quantity > 1.
    await page.getByRole("button", { name: "Register asset" }).click();
    // Fixed from the plan's draft: /\/inventory/ trivially matches the CURRENT
    // url ("/inventory/register" already contains "/inventory"), so
    // waitForURL resolved instantly without waiting for the real redirect —
    // the DB read below then raced the still-in-flight server action and
    // found nothing. Wait for the actual landing pathname instead.
    await page.waitForURL((url) => url.pathname === "/inventory");

    const a = await db.asset.findUniqueOrThrow({ where: { tag: registeredTag } });
    expect(a.cls).toBe("PURCHASING");
    expect(a.status).toBe("STORED");
    expect(a.categoryId).toBe(vehicleCategoryId);
    expect(a.typeId).toBe(sedanTypeId);
    expect(a.financeConfirmedAt).toBeNull();
  });

  test("2. Purchasing is never offered an IT category, and nothing is written", async ({ page }) => {
    const before = await db.asset.count();
    await login(page, "purchasing@thebackroomop.com");
    await page.goto("/inventory/register");
    const options = await page.getByLabel("Category").locator("option").allTextContents();
    expect(options).toContain("Vehicle");
    expect(options).not.toContain("Laptop");
    expect(await db.asset.count()).toBe(before);
  });

  test("3. IT is never offered a Purchasing category, and nothing is written", async ({ page }) => {
    const before = await db.asset.count();
    await login(page, "it@thebackroomop.com");
    await page.goto("/inventory/register");
    const options = await page.getByLabel("Category").locator("option").allTextContents();
    expect(options).toContain("Laptop");
    expect(options).not.toContain("Vehicle");
    expect(await db.asset.count()).toBe(before);
  });
});

test.describe("Finance sees two tabs", () => {
  test("4. the car is under Purchasing with Purchasing words, and absent from IT", async ({ page }) => {
    await login(page, "finance@thebackroomop.com");
    await page.goto("/finance/assets?cls=PURCHASING");
    await expect(page.getByRole("link", { name: "BR-VH-0001" })).toBeVisible();
    await expect(page.getByRole("link", { name: "OPERATIONAL" })).toBeVisible();
    await expect(page.getByRole("link", { name: "DEPLOYED" })).toHaveCount(0);

    await page.goto("/finance/assets");
    await expect(page.getByRole("link", { name: "BR-VH-0001" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "DEPLOYED" })).toBeVisible();
    await expect(page.getByRole("link", { name: "OPERATIONAL" })).toHaveCount(0);
  });
});

test.describe("IT-only surfaces close to a Purchasing asset", () => {
  test("5. Secrets tab absent, and the URL renders the not-found page", async ({ page }) => {
    const id = await idOf("BR-VH-0001");
    await login(page, "admin@thebackroomop.com");
    await page.goto(`/inventory/${id}`);
    await expect(page.getByRole("link", { name: /Secrets/ })).toHaveCount(0);
    await expect(page.getByText("PURCHASING", { exact: true })).toBeVisible();
    await page.goto(`/inventory/${id}/secrets`);
    // A page-level notFound() under inventory/loading.tsx streams the shell with
    // 200 before the guard runs, so the HTTP status cannot be 404 here — the
    // not-found page IS the 404 (D-18). The secrets panel must not render.
    // EmptyState (empty-state.tsx) renders its title as a plain <p>, not a heading.
    await expect(page.getByText("Asset not found", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Reveal/ })).toHaveCount(0);
  });
});

test.describe("status controls and approvals speak the class's language", () => {
  test.describe.configure({ mode: "serial" });

  test("6. the picker on a car offers exactly the six, minus its current status", async ({ page }) => {
    const id = await idOf("BR-VH-0002"); // STORED, unassigned
    await login(page, "purchasing@thebackroomop.com");
    await page.goto(`/inventory/${id}`);
    await page.getByRole("button", { name: "Request status change" }).click();
    const options = await page.getByLabel("New status").locator("option").allTextContents();
    expect(options.sort()).toEqual(["LOST", "OPERATIONAL", "REPAIRING", "RETIRED", "SOLD"]);
    expect(options).not.toContain("DEPLOYED");
  });

  test("7. an approval executes the car to OPERATIONAL", async ({ page }) => {
    const id = await idOf("BR-VH-0002");
    await login(page, "purchasing@thebackroomop.com");
    await page.goto(`/inventory/${id}`);
    await page.getByRole("button", { name: "Request status change" }).click();
    await page.getByLabel("New status").selectOption("OPERATIONAL");
    await page.getByLabel("Reason").fill("e2e — car back in service");
    // Fixed from the plan's draft: an unscoped getByRole("button", {name:
    // "Request"}) is a strict-mode violation — Playwright's substring, case-
    // insensitive match also hits the global "Search assets, people,
    // requests…" command-palette button. Scope to the dialog and match exactly.
    await page.getByRole("dialog", { name: "Request a status change" })
      .getByRole("button", { name: "Request", exact: true }).click();
    await expect(page.getByText(/created — waiting in the approval queue/)).toBeVisible();

    // Fixture shortcut: approve directly rather than through the queue UI,
    // which approvals-audit.spec.ts already covers end to end. The real
    // approve action (actions.ts) also enqueues the EXECUTE_APPROVAL job in
    // the same transition — bypassing the UI still has to enqueue it by hand,
    // or the worker has nothing to lease and the approval sits APPROVED forever.
    const approval = await db.approval.findFirstOrThrow({ where: { assetId: id, state: "PENDING" } });
    await db.approval.update({ where: { id: approval.id }, data: { state: "APPROVED" } });
    await db.job.create({ data: { type: "EXECUTE_APPROVAL", payload: { approvalId: approval.id } } });
    execSync("npm run worker:once", { timeout: 60_000 });

    const after = await db.asset.findUniqueOrThrow({ where: { id } });
    expect(after.status).toBe("OPERATIONAL");
    expect((await db.approval.findUniqueOrThrow({ where: { id: approval.id } })).state).toBe("EXECUTED");
  });

  test("14. a held car cannot be status-changed out from under its driver (D-8)", async ({ page }) => {
    // The only test that reaches the worker's HOLDER_STATUSES guard. BR-VH-0001 is OPERATIONAL and assigned.
    const id = await idOf("BR-VH-0001");
    await login(page, "purchasing@thebackroomop.com");
    await page.goto(`/inventory/${id}`);
    await page.getByRole("button", { name: "Request status change" }).click();
    await page.getByLabel("New status").selectOption("STORED");
    await page.getByLabel("Reason").fill("e2e — should be refused by the worker");
    await page.getByRole("dialog", { name: "Request a status change" })
      .getByRole("button", { name: "Request", exact: true }).click();
    await expect(page.getByText(/created — waiting in the approval queue/)).toBeVisible();
    const approval = await db.approval.findFirstOrThrow({ where: { assetId: id, state: "PENDING" } });
    await db.approval.update({ where: { id: approval.id }, data: { state: "APPROVED" } });
    // Same enqueue-by-hand as case 7 — this shortcut bypasses actions.ts, which
    // is the only place that normally creates the EXECUTE_APPROVAL job.
    await db.job.create({ data: { type: "EXECUTE_APPROVAL", payload: { approvalId: approval.id } } });
    execSync("npm run worker:once", { timeout: 60_000 });
    const after = await db.approval.findUniqueOrThrow({ where: { id: approval.id } });
    expect(after.state).toBe("EXECUTION_FAILED");
    expect(after.workerError).toMatch(/lifecycle\.return/);
    const car = await db.asset.findUniqueOrThrow({ where: { id } });
    expect(car.status).toBe("OPERATIONAL");
    expect(car.assigneeId).not.toBeNull();
  });
});

test.describe("a leaver who holds a car", () => {
  test("8. sees Returned / Defective / Missing, no Buyout, and Returned lands on STORED", async ({ page }) => {
    const dennis = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0090" } });
    const car = await db.asset.create({
      data: {
        tag: "BR-VH-0090", model: "Isuzu D-Max (e2e leaver)", categoryId: vehicleCategoryId, typeId: sedanTypeId,
        cls: "PURCHASING", status: "OPERATIONAL", assigneeId: dennis.id,
      },
    });
    await login(page, "it@thebackroomop.com");
    await page.goto(`/offboarding/${dennis.id}?step=collect`);
    const group = page.getByRole("group", { name: `Decide ${car.tag}` });
    await expect(group).toBeVisible();
    // Selectors fixed from the plan's draft: SegmentedControl (segmented-
    // control.tsx) renders `role="radiogroup"` > `role="radio"` inputs that
    // are visually sr-only — the visible thing to assert and click is each
    // option's <label> text, exactly the pattern e2e/offboarding.spec.ts
    // already uses for this same component ("Decide" is `role="group"`,
    // never `role="button"`).
    const outcomeGroup = group.getByRole("radiogroup", { name: `Outcome for ${car.tag}` });
    await expect(outcomeGroup.getByText("Returned")).toBeVisible();
    await expect(outcomeGroup.getByText("Missing")).toBeVisible();
    await expect(outcomeGroup.getByText("Buyout")).toHaveCount(0);

    await outcomeGroup.getByText("Returned").click();
    await group.getByRole("button", { name: "Confirm decision" }).click();
    await expect(page.getByText(`${car.tag} → STORED`)).toBeVisible();

    const approval = await db.approval.findFirstOrThrow({ where: { assetId: car.id, type: "lifecycle_return" } });
    expect((approval.payload as { to: { status: string } }).to.status).toBe("STORED");
  });
});

test.describe("the database is the guarantee", () => {
  test("9. a Purchasing asset cannot be written into an IT status, even via Prisma", async () => {
    await expect(db.asset.update({ where: { tag: "BR-FN-0001" }, data: { status: "DEPLOYED" } }))
      .rejects.toThrow(/cannot hold status/);
    expect((await db.asset.findUniqueOrThrow({ where: { tag: "BR-FN-0001" } })).status).toBe("OPERATIONAL");
  });

  test("13. a category with assets cannot change class, even via Prisma", async () => {
    await expect(db.assetCategory.update({ where: { name: "Vehicle" }, data: { cls: "IT" } }))
      .rejects.toThrow(/has assets/);
    expect((await db.assetCategory.findUniqueOrThrow({ where: { name: "Vehicle" } })).cls).toBe("PURCHASING");
  });
});

test.describe("the inventory view", () => {
  test("10. ?cls=PURCHASING lists Purchasing assets and scopes the Filters panel; the plain URL is unchanged", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/inventory?cls=PURCHASING");
    await expect(page.getByRole("link", { name: "BR-VH-0001" })).toBeVisible();
    await expect(page.getByRole("link", { name: "BR-LT-0148" })).toHaveCount(0);
    // The Filters panel is scoped too (D-12): six Purchasing statuses, Purchasing categories only.
    // Fixed from the plan's draft: an unscoped getByRole("button", {name:
    // /^Status/}) is a strict-mode violation — the sortable "Status" table
    // column header (table.tsx's plain <button>) also matches. FacetDropdown's
    // own trigger is the one with aria-haspopup="dialog" (facet-dropdown.tsx).
    await page.locator('button[aria-haspopup="dialog"]').filter({ hasText: /^Status/ }).click();
    const statusDialog = page.getByRole("dialog", { name: "Filter by Status" });
    await expect(statusDialog.getByRole("checkbox")).toHaveCount(6);
    await expect(statusDialog.getByText("RETIRED")).toBeVisible();
    await expect(statusDialog.getByText("DISPOSE")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.locator('button[aria-haspopup="dialog"]').filter({ hasText: /^Category/ }).click();
    const categoryDialog = page.getByRole("dialog", { name: "Filter by Category" });
    await expect(categoryDialog.getByText("Vehicle")).toBeVisible();
    await expect(categoryDialog.getByText("Laptop")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.goto("/inventory");
    await expect(page.getByRole("link", { name: "BR-LT-0148" })).toBeVisible();
    await expect(page.getByRole("link", { name: "BR-VH-0001" })).toHaveCount(0);
    // Switching class clears the facet filters — none of them can apply to the other class (D-12).
    await page.goto("/inventory?status=SPARE");
    await expect(page.getByText("status: SPARE")).toBeVisible();
    await page.getByRole("navigation", { name: "Asset class" }).getByRole("link", { name: "Purchasing" }).click();
    await expect(page).toHaveURL(/cls=PURCHASING/);
    await expect(page).not.toHaveURL(/status=/);
    await expect(page.getByText("status: SPARE")).toHaveCount(0);
  });

  test("11. the bulk drawer on the Purchasing view offers Purchasing statuses", async ({ page }) => {
    await login(page, "admin@thebackroomop.com");
    await page.goto("/inventory?cls=PURCHASING");
    await page.getByRole("row", { name: /BR-FN-0003/ }).getByRole("checkbox").check();
    await page.getByRole("button", { name: /Bulk/ }).click();
    const options = await page.getByLabel("Target status").locator("option").allTextContents();
    expect(options).toContain("RETIRED");
    expect(options).not.toContain("DISPOSE");
  });
});

test.describe("category admin", () => {
  test("12. a category is created with a class and the column shows it", async ({ page }) => {
    await login(page, "admin@thebackroomop.com");
    await page.goto("/admin/asset-categories");
    await page.getByLabel("Class for the new category").selectOption("PURCHASING");
    await page.getByLabel("New category name").fill("Artwork");
    await page.getByRole("button", { name: "Add" }).click();
    await expect(page.getByRole("row", { name: /Artwork/ })).toContainText("PURCHASING");
    expect((await db.assetCategory.findUniqueOrThrow({ where: { name: "Artwork" } })).cls).toBe("PURCHASING");
  });
});

test.describe("Finance send-back and resubmit speak the class", () => {
  test.describe.configure({ mode: "serial" });

  test("16. Finance sends a Purchasing registration back; Purchasing resubmits it; IT cannot", async ({ page }) => {
    const id = await idOf("BR-FN-0003");

    await login(page, "finance@thebackroomop.com");
    await page.goto(`/inventory/${id}`);
    await page.getByRole("button", { name: "Send back to Purchasing" }).click();
    const dialog = page.getByRole("dialog", { name: "Send back BR-FN-0003?" });
    await dialog.getByLabel("What is wrong?").fill("e2e — wrong cost recorded");
    await dialog.getByRole("button", { name: "Send back" }).click();
    // exact: true — Playwright's getByText is substring AND case-insensitive
    // by default, and the Purchasing sidebar nav carries its own "Awaiting
    // finance" link at all times, which would otherwise satisfy a loose match
    // on "AWAITING FINANCE" below regardless of whether the pill ever changed.
    await expect(page.getByText("RETURNED BY FINANCE", { exact: true })).toBeVisible();

    await login(page, "purchasing@thebackroomop.com");
    await page.goto(`/inventory/${id}`);
    await expect(page.getByRole("button", { name: "Mark corrected" })).toBeVisible();
    await page.getByRole("button", { name: "Mark corrected" }).click();
    const resubmitDialog = page.getByRole("dialog", { name: "Mark corrected BR-FN-0003?" });
    await resubmitDialog.getByRole("button", { name: "Mark corrected" }).click();
    await expect(page.getByText("AWAITING FINANCE", { exact: true })).toBeVisible();
    expect((await db.asset.findUniqueOrThrow({ where: { id } })).financeReturnedAt).toBeNull();

    await login(page, "it@thebackroomop.com");
    await page.goto(`/inventory/${id}`);
    await expect(page.getByRole("button", { name: "Mark corrected" })).toHaveCount(0);
  });
});

test.describe("page gates speak the class", () => {
  test("17. a wrong-class edit URL lands on the record, and the Secrets tab is absent by role", async ({ page }) => {
    const carId = await idOf("BR-VH-0001");
    await login(page, "it@thebackroomop.com");
    await page.goto(`/inventory/${carId}/edit`);
    await expect(page).toHaveURL(new RegExp(`/inventory/${carId}$`));

    const laptopId = await idOf("BR-LT-0148");
    await login(page, "purchasing@thebackroomop.com");
    await page.goto(`/inventory/${laptopId}/edit`);
    await expect(page).toHaveURL(new RegExp(`/inventory/${laptopId}$`));
    await page.goto(`/inventory/${laptopId}`);
    await expect(page.getByRole("link", { name: /Secrets/ })).toHaveCount(0);

    await login(page, "it@thebackroomop.com");
    await page.goto(`/inventory/${laptopId}`);
    await expect(page.getByRole("link", { name: /Secrets/ })).toBeVisible();
  });

  test("18. /inventory/new offers each role its own categories", async ({ page }) => {
    await login(page, "purchasing@thebackroomop.com");
    await page.goto("/inventory/new");
    let options = await page.getByLabel("Category").locator("option").allTextContents();
    expect(options).toContain("Vehicle");
    expect(options).not.toContain("Laptop");

    await login(page, "it@thebackroomop.com");
    await page.goto("/inventory/new");
    options = await page.getByLabel("Category").locator("option").allTextContents();
    expect(options).toContain("Laptop");
    expect(options).not.toContain("Vehicle");

    await login(page, "finance@thebackroomop.com");
    await page.goto("/inventory/new");
    await expect(page).toHaveURL(new RegExp(`${ROLE_LANDING.finance_staff}$`));

    await login(page, "admin@thebackroomop.com");
    await page.goto("/inventory/new?cls=PURCHASING");
    options = await page.getByLabel("Category").locator("option").allTextContents();
    expect(options).toContain("Vehicle");
    expect(options).not.toContain("Laptop");

    await page.goto("/inventory/new");
    options = await page.getByLabel("Category").locator("option").allTextContents();
    expect(options).toContain("Vehicle");
    expect(options).toContain("Laptop");

    await page.goto("/inventory?cls=PURCHASING");
    const newAssetLink = page.getByRole("link", { name: "New asset" });
    await expect(newAssetLink).toHaveAttribute("href", /\?cls=PURCHASING$/);
    await expect(page.getByRole("link", { name: "Repairs" })).toHaveCount(0);

    await page.goto("/inventory");
    await expect(page.getByRole("link", { name: "Repairs" })).toBeVisible();
  });
});

test.describe("the leaver-kit policy picker", () => {
  test("19. names no Purchasing type", async ({ page }) => {
    await login(page, "admin@thebackroomop.com");
    await page.goto("/admin/equipment-policies");
    // policy-editor.tsx: aria-label is `Asset type for the new slot in ${policy.name}`
    // — "Finance standard" is the seed's one policy.
    const options = await page
      .getByLabel("Asset type for the new slot in Finance standard")
      .locator("option")
      .allTextContents();
    expect(options.some((o) => /Laptop/.test(o))).toBe(true);
    expect(options.some((o) => /Sedan/.test(o))).toBe(false);
  });
});

test.describe("the create form's initial-state control follows the class", () => {
  test("20. Vehicle offers 2 (STORED default), Laptop offers 3 (SPARE default), and the disclosure text tracks the choice", async ({ page }) => {
    await login(page, "admin@thebackroomop.com");
    await page.goto("/inventory/new");

    await page.getByLabel("Category").selectOption({ label: "Vehicle" });
    const initialStatus = page.getByRole("radiogroup", { name: "Initial status" });
    await expect(initialStatus.getByRole("radio")).toHaveCount(2);
    await expect(initialStatus.getByRole("radio", { name: "STORED" })).toBeChecked();
    await expect(initialStatus.getByRole("radio", { name: "OPERATIONAL" })).toBeVisible();
    await expect(initialStatus.getByRole("radio", { name: "DEPLOYED" })).toHaveCount(0);

    await initialStatus.getByText("OPERATIONAL").click();

    await page.getByLabel("Category").selectOption({ label: "Laptop" });
    await expect(initialStatus.getByRole("radio")).toHaveCount(3);
    await expect(initialStatus.getByRole("radio", { name: "SPARE" })).toBeChecked();
    await expect(initialStatus.getByRole("radio", { name: "OPERATIONAL" })).toHaveCount(0);

    await initialStatus.getByText("DEPLOYED").click();
    await expect(page.getByText(/registered as SPARE/)).toBeVisible();

    await page.getByLabel("Category").selectOption({ label: "Vehicle" });
    await initialStatus.getByText("OPERATIONAL").click();
    await expect(page.getByText(/registered as STORED/)).toBeVisible();
  });
});

test.describe("the IT import wizard refuses a Purchasing row by name", () => {
  test("21. names Purchasing, points at the Register screen, and admin can follow the fix", async ({ page }) => {
    // Same helper e2e/fixtures/make.ts uses (toXlsxBuffer + ASSET_EXPORT_COLUMNS),
    // built in-memory and handed to setInputFiles — the same pattern
    // import-export.spec.ts's own round-trip test uses for an in-memory
    // upload — rather than adding a row to the committed assets-mixed.xlsx,
    // whose counts import-export.spec.ts pins.
    const buffer = await toXlsxBuffer(ASSET_EXPORT_COLUMNS, [
      {
        tag: "BR-LT-9901", model: "Wrong department (e2e)", serial: null, categoryName: "Vehicle", typeName: null,
        status: "", assigneeName: null, assigneeNo: null, purchasedAt: null, cost: null, warrantyUntil: null,
        vendorName: null, rmaRef: null, notes: null,
      },
    ]);

    await login(page, "it@thebackroomop.com");
    await page.goto("/inventory/import");
    await page.getByLabel(/Spreadsheet/).setInputFiles({
      name: "wrong-class-row.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer,
    });
    await page.getByRole("button", { name: /^Validate/ }).click();

    await expect(page.getByText("0 new · 0 updates · 1 blocked")).toBeVisible();
    // The outermost card div containing both the group label and its Fix —
    // "Belongs to Purchasing" (blocked-causes.tsx's label span) and "Open the
    // Register screen" (the Fix link) sit in the same card but at different
    // nesting depths, so filter rather than a fixed parent-chain distance.
    const card = page.locator("div")
      .filter({ hasText: "Belongs to Purchasing" })
      .filter({ hasText: "Open the Register screen" })
      .first();
    await expect(card).toContainText("Vehicle");
    await expect(card).not.toContainText("for you");
    await card.getByRole("link", { name: "Open the Register screen" }).click();
    await expect(page).toHaveURL(/\/inventory\/register$/);
    // The Fix is a client-side <Link>: the URL updates before the register
    // form's content has streamed in, so a bare toHaveURL race with the
    // options read below (empty array, not a wrong-role list). Wait for the
    // page's own content before reading it.
    await expect(page.getByRole("heading", { name: "Register assets", level: 1 })).toBeVisible();

    await login(page, "admin@thebackroomop.com");
    await page.goto("/inventory/import");
    await page.getByLabel(/Spreadsheet/).setInputFiles({
      name: "wrong-class-row.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer,
    });
    await page.getByRole("button", { name: /^Validate/ }).click();
    await expect(page.getByText("0 new · 0 updates · 1 blocked")).toBeVisible();
    await page.getByRole("link", { name: "Open the Register screen" }).click();
    await expect(page).toHaveURL(/\/inventory\/register$/);
    await expect(page.getByRole("heading", { name: "Register assets", level: 1 })).toBeVisible();
    const options = await page.getByLabel("Category").locator("option").allTextContents();
    expect(options).toContain("Vehicle");
  });
});
