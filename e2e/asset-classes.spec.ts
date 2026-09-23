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

/**
 * Phase 30 (spec §4.1): the record header shows one state-chosen primary and
 * puts every other action in its ⋯ "More actions" menu. Opens that menu and
 * returns it — retried until the island has hydrated.
 */
async function openMore(page: Page) {
  const more = page.getByRole("button", { name: "More actions", exact: true });
  const menu = page.getByRole("menu");
  await expect(async () => {
    if ((await more.getAttribute("aria-expanded")) !== "true") await more.click();
    await expect(menu).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  return menu;
}

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

    // Phase 30 (spec §5.6, plan P-13): quantity 1 is one asset — it goes
    // through createAsset and ends on its record with the created notice,
    // not on the batch card.
    await page.getByRole("button", { name: "Register 1 asset" }).click();
    await expect(page).toHaveURL(/\/inventory\/[^/?]+\?created=1$/, { timeout: 30_000 });
    await expect(page.getByText(`${registeredTag} registered`)).toBeVisible();

    const a = await db.asset.findUniqueOrThrow({ where: { tag: registeredTag } });
    expect(a.cls).toBe("PURCHASING");
    expect(a.status).toBe("STORED");
    expect(a.categoryId).toBe(vehicleCategoryId);
    expect(a.typeId).toBe(sedanTypeId);
    expect(a.financeConfirmedAt).toBeNull();
  });

  test("2. Purchasing is offered both classes' categories; IT only its own (Phase 14)", async ({ page }) => {
    const before = await db.asset.count();
    await login(page, "purchasing@thebackroomop.com");
    await page.goto("/inventory/register");
    const options = await page.getByLabel("Category").locator("option").allTextContents();
    expect(options).toContain("Vehicle");
    expect(options).toContain("Laptop");
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
    // Phase 30 (spec §4.1): the class pill left the header; the breadcrumb now
    // names the class's own list (admin's default list is IT, so it says cls=).
    await expect(page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Purchasing assets", exact: true }))
      .toHaveAttribute("href", "/inventory?cls=PURCHASING");
    await page.goto(`/inventory/${id}/secrets`);
    // A page-level notFound() under inventory/loading.tsx streams the shell with
    // 200 before the guard runs, so the HTTP status cannot be 404 here — the
    // not-found page IS the 404 (D-18). The secrets panel must not render.
    // EmptyState (empty-state.tsx) renders its title as a plain <p>, not a heading.
    await expect(page.getByText("Asset not found", { exact: true })).toBeVisible();
    // The seed creates no AssetSecret rows, so a Reveal-button negative would
    // be vacuous here regardless of the class guard — SecretsPanel renders no
    // Reveal button when there are no secrets either way. "Reads are audited"
    // (secrets-panel.tsx ~line 97) is the banner SecretsPanel renders
    // unconditionally whenever it mounts, so its absence is the real assertion.
    await expect(page.getByText("Reads are audited", { exact: true })).toHaveCount(0);
  });
});

test.describe("status controls and approvals speak the class's language", () => {
  test.describe.configure({ mode: "serial" });

  test("6. the picker on a car offers only its class's legal targets, in friendly words, with nothing preselected", async ({ page }) => {
    const id = await idOf("BR-VH-0002"); // STORED, unassigned
    await login(page, "purchasing@thebackroomop.com");
    await page.goto(`/inventory/${id}`);
    // Phase 30: the approval path keeps its words; the item sits in More.
    await (await openMore(page)).getByRole("menuitem", { name: "Request status change…", exact: true }).click();
    const status = page.getByLabel("New status");
    // Spec §4.2 (statusTargets): never the current STORED, never the holder
    // status OPERATIONAL (Assign holder does that), never an IT status.
    // Plan P-6: friendly labels, option values still the enum.
    await expect(status).toHaveValue("");
    expect(await status.locator("option").allTextContents()).toEqual(["Pick a status…", "Repairing", "Retired", "Sold", "Lost"]);
    expect(await status.locator("option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value)))
      .toEqual(["", "REPAIRING", "RETIRED", "SOLD", "LOST"]);
  });

  test("7. an approval executes the car's requested status", async ({ page }) => {
    const id = await idOf("BR-VH-0002");
    await login(page, "purchasing@thebackroomop.com");
    await page.goto(`/inventory/${id}`);
    await (await openMore(page)).getByRole("menuitem", { name: "Request status change…", exact: true }).click();
    // Phase 30: OPERATIONAL is a holder status and no longer a target for an
    // unassigned car (case 6) — REPAIRING is the round trip's other half.
    await page.getByLabel("New status").selectOption("REPAIRING");
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
    execSync("npm run worker:once", { timeout: 60_000, stdio: "inherit" });

    const after = await db.asset.findUniqueOrThrow({ where: { id } });
    expect(after.status).toBe("REPAIRING");
    expect((await db.approval.findUniqueOrThrow({ where: { id: approval.id } })).state).toBe("EXECUTED");
  });

  test("14. a held car cannot be status-changed out from under its driver (D-8)", async ({ page }) => {
    // The only test that reaches the worker's HOLDER_STATUSES guard. BR-VH-0001 is OPERATIONAL and assigned.
    const id = await idOf("BR-VH-0001");
    const purchasing = await db.user.findUniqueOrThrow({ where: { email: "purchasing@thebackroomop.com" } });
    await login(page, "purchasing@thebackroomop.com");
    await page.goto(`/inventory/${id}`);
    // Phase 30 (spec §4.2): a held car has no status target at all — Return
    // (the primary) is the only way out — so the header never offers the
    // request the worker would refuse.
    await expect(page.getByRole("button", { name: "Return", exact: true })).toBeVisible();
    await expect((await openMore(page)).getByRole("menuitem")).toHaveText(["Print label"]);

    // The worker's guard still has to hold for a request filed some other way
    // (an older client, a race): file it exactly as requestStatusChange does —
    // the next APR number, the same payload — already APPROVED, then run it.
    const [{ nextval }] = await db.$queryRaw<[{ nextval: bigint }]>`SELECT nextval('approval_ref_seq')`;
    const approval = await db.approval.create({
      data: {
        refNo: `APR-${nextval}`, type: "lifecycle_change_status", state: "APPROVED",
        payload: { from: { status: "OPERATIONAL" }, to: { status: "STORED" }, reason: "e2e — should be refused by the worker" },
        requestedById: purchasing.id, assetId: id, slaAt: new Date(Date.now() + 86_400_000),
      },
    });
    // Same enqueue-by-hand as case 7 — this shortcut bypasses actions.ts, which
    // is the only place that normally creates the EXECUTE_APPROVAL job.
    await db.job.create({ data: { type: "EXECUTE_APPROVAL", payload: { approvalId: approval.id } } });
    execSync("npm run worker:once", { timeout: 60_000, stdio: "inherit" });
    const after = await db.approval.findUniqueOrThrow({ where: { id: approval.id } });
    expect(after.state).toBe("EXECUTION_FAILED");
    expect(after.workerError).toMatch(/is still assigned — request a lifecycle\.return first/);
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
    // Pins the count so ["RETURNED","MISSING"] alone (2, no Defective) would fail.
    await expect(outcomeGroup.getByRole("radio")).toHaveCount(3);

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
  test("10. ?cls=PURCHASING lists Purchasing assets and scopes the Filters panel; the plain URL opens the role's own class", async ({ page }) => {
    await login(page, "purchasing@thebackroomop.com");
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
    // Phase 30 (plan P-7): the plain URL opens the class the role manages — Purchasing for
    // purchasing_staff — and the IT view names itself with cls=IT.
    await page.goto("/inventory");
    await expect(page.getByRole("heading", { name: "Purchasing assets", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "BR-VH-0001" })).toBeVisible();
    await expect(page.getByRole("link", { name: "BR-LT-0148" })).toHaveCount(0);
    // Register assets names the viewed class even on the default view, so the form opens narrowed.
    const registerLink = page.getByRole("main").getByRole("link", { name: "Register assets" });
    await expect(registerLink).toHaveAttribute("href", "/inventory/register?cls=PURCHASING");
    await registerLink.click();
    await expect(page).toHaveURL(/\/inventory\/register\?cls=PURCHASING$/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Register assets", level: 1 })).toBeVisible();
    const purchasingOptions = await page.getByLabel("Category").locator("option").allTextContents();
    expect(purchasingOptions).toContain("Vehicle");
    expect(purchasingOptions).not.toContain("Laptop");
    await page.goto("/inventory?cls=IT");
    await expect(page.getByRole("link", { name: "BR-LT-0148" })).toBeVisible();
    await expect(page.getByRole("link", { name: "BR-VH-0001" })).toHaveCount(0);

    // A Purchasing record's breadcrumb names the Purchasing list, which is this role's plain URL.
    await page.goto(`/inventory/${await idOf("BR-FN-0003")}`);
    const crumb = page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Purchasing assets", exact: true });
    await expect(crumb).toHaveAttribute("href", "/inventory");
    await crumb.click();
    await expect(page).toHaveURL(/\/inventory$/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Purchasing assets", level: 1 })).toBeVisible();

    // Phase 14: IT cannot ask for the Purchasing view at all.
    await login(page, "it@thebackroomop.com");
    await page.goto("/inventory?cls=PURCHASING");
    await expect(page).toHaveURL(/\/inventory$/);
    await expect(page.getByRole("link", { name: "BR-VH-0001" })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Asset class" })).toHaveCount(0);
    await login(page, "purchasing@thebackroomop.com");

    // Switching class clears the facet filters — none of them can apply to the other class (D-12).
    // Phase 30: chips read as the value alone, and Purchasing is this role's default (no cls=).
    await page.goto("/inventory?cls=IT&status=SPARE");
    const spareChip = page.getByRole("link", { name: "SPARE — remove filter" });
    await expect(spareChip).toBeVisible();
    await page.getByRole("navigation", { name: "Asset class" }).getByRole("link", { name: "Purchasing" }).click();
    await expect(page).toHaveURL(/\/inventory$/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Purchasing assets", level: 1 })).toBeVisible();
    await expect(spareChip).toHaveCount(0);
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
    // "Artwork" must stay unique across the suite's data — this case relies on
    // the file-level reseed (test.beforeAll) for it to be creatable again on a re-run.
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
    // Phase 30 (spec §4.1 row 5): Confirm details is Finance's primary; Send back sits in More.
    await (await openMore(page)).getByRole("menuitem", { name: "Send back to Purchasing…", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Send back BR-FN-0003?" });
    await dialog.getByLabel("What is wrong?").fill("e2e — wrong cost recorded");
    await dialog.getByRole("button", { name: "Send back" }).click();
    await expect(page.getByText("BR-FN-0003 sent back to Purchasing")).toBeVisible();
    // exact: true — Playwright's getByText is substring AND case-insensitive
    // by default, and the Purchasing sidebar nav carries its own "Awaiting
    // finance" link at all times, which would otherwise satisfy a loose match
    // on "AWAITING FINANCE" below regardless of whether the pill ever changed.
    // Phase 30 (spec §4.1): the header's one pill asks something of THIS
    // viewer — Finance still owes a confirmation; RETURNED BY FINANCE is the
    // pill Purchasing sees below.
    await expect(page.getByRole("alert").filter({ hasText: "Finance sent this back" })).toContainText("e2e — wrong cost recorded");
    await expect(page.getByText("AWAITING FINANCE", { exact: true })).toBeVisible();
    await expect(page.getByText("RETURNED BY FINANCE", { exact: true })).toHaveCount(0);

    // IT cannot resubmit — and, as of Phase 14's asymmetric visibility, cannot
    // even see this record: BR-FN-0003 is Purchasing-class furniture, and IT
    // only sees the IT class now (VISIBLE_CLASSES, src/lib/asset-class.ts).
    // getVisibleAsset returns null for it_staff here, so AssetRecordLayout's
    // OWN notFound() fires. Phase 30 (plan P-15): that layout now lives in the
    // (record) route group, one segment BELOW inventory/[id]/not-found.tsx, so
    // the scoped "Asset not found" EmptyState catches it — the same page case
    // 5 shows for a child route's own notFound(). (While the layout sat beside
    // not-found.tsx in [id]/, its notFound() bubbled past to the app's root
    // "This page doesn't exist".)
    await login(page, "it@thebackroomop.com");
    await page.goto(`/inventory/${id}`);
    await expect(page.getByText("Asset not found", { exact: true })).toBeVisible();

    await login(page, "purchasing@thebackroomop.com");
    await page.goto(`/inventory/${id}`);
    await expect(page.getByText("RETURNED BY FINANCE", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Mark corrected" })).toBeVisible();
    await page.getByRole("button", { name: "Mark corrected" }).click();
    const resubmitDialog = page.getByRole("dialog", { name: "Mark corrected BR-FN-0003?" });
    await resubmitDialog.getByRole("button", { name: "Mark corrected" }).click();
    await expect(page.getByText("BR-FN-0003 resubmitted to Finance")).toBeVisible();
    await expect(page.getByText("RETURNED BY FINANCE", { exact: true })).toHaveCount(0);
    expect((await db.asset.findUniqueOrThrow({ where: { id } })).financeReturnedAt).toBeNull();
  });
});

test.describe("page gates speak the class", () => {
  test("17. a wrong-class edit URL lands on the record, and the Secrets tab is absent by role", async ({ page }) => {
    const carId = await idOf("BR-VH-0001");
    await login(page, "it@thebackroomop.com");
    // Phase 14: IT cannot see a Purchasing asset at all (not just its Edit
    // link). Phase 30 (plan P-15): the edit route left the record layout, so
    // it is the edit page's own notFound() that fires, and
    // inventory/[id]/not-found.tsx — its parent segment's boundary — shows the
    // scoped "Asset not found", as for the record itself (case 16).
    await page.goto(`/inventory/${carId}/edit`);
    await expect(page.getByText("Asset not found", { exact: true })).toBeVisible();

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
    // Phase 30 (spec §5.1): /inventory/new redirects to the one Register flow,
    // keeping ?cls=. The redirect can land after page.goto resolves (the page
    // streams under inventory/loading.tsx), so each read waits for the form's
    // own heading first — allTextContents() does not wait for anything.
    const categoryOptions = async (url: RegExp) => {
      await expect(page).toHaveURL(url);
      await expect(page.getByRole("heading", { name: "Register assets", level: 1 })).toBeVisible();
      return page.getByLabel("Category").locator("option").allTextContents();
    };
    await login(page, "purchasing@thebackroomop.com");
    await page.goto("/inventory/new");
    let options = await categoryOptions(/\/inventory\/register$/);
    expect(options).toContain("Vehicle");
    expect(options).toContain("Laptop");
    // Both classes offered → one optgroup per class (spec §5.2).
    await expect(page.getByLabel("Category").locator("optgroup")).toHaveCount(2);

    await login(page, "it@thebackroomop.com");
    await page.goto("/inventory/new");
    options = await categoryOptions(/\/inventory\/register$/);
    expect(options).toContain("Laptop");
    expect(options).not.toContain("Vehicle");
    await expect(page.getByLabel("Category").locator("optgroup")).toHaveCount(0);

    await login(page, "finance@thebackroomop.com");
    await page.goto("/inventory/new");
    await expect(page).toHaveURL(new RegExp(`${ROLE_LANDING.finance_staff}$`));

    await login(page, "admin@thebackroomop.com");
    await page.goto("/inventory/new?cls=PURCHASING");
    options = await categoryOptions(/\/inventory\/register\?cls=PURCHASING$/);
    expect(options).toContain("Vehicle");
    expect(options).not.toContain("Laptop");
    // The breadcrumb names the list it came from.
    await expect(page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Purchasing assets", exact: true }))
      .toHaveAttribute("href", "/inventory?cls=PURCHASING");

    await page.goto("/inventory/new");
    options = await categoryOptions(/\/inventory\/register$/);
    expect(options).toContain("Vehicle");
    expect(options).toContain("Laptop");

    await page.goto("/inventory?cls=PURCHASING");
    // Phase 30 (spec §6.1): the header's one primary; scoped to main — the nav has an entry of the same name.
    const registerLink = page.getByRole("main").getByRole("link", { name: "Register assets" });
    await expect(registerLink).toHaveAttribute("href", /^\/inventory\/register\?cls=PURCHASING$/);
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
    // Options are `${category.name} · ${type.name}`. A bare /Sedan/ negative
    // would pass even if the whole Purchasing side leaked in (every Purchasing
    // type name happens not to be "Sedan"), so assert no Purchasing CATEGORY
    // is offered at all, alongside a positive that Laptop is.
    expect(options.some((o) => /^Laptop · /.test(o))).toBe(true);
    expect(options.some((o) => /^(Vehicle|Furniture|Pantry Equipment|Building) · /.test(o))).toBe(false);
  });
});

test.describe("the create form's initial-state control follows the class", () => {
  test("20. Vehicle offers 2 (Stored default), Laptop offers 3 (Spare default), and the disclosure text tracks the choice", async ({ page }) => {
    await login(page, "admin@thebackroomop.com");
    // Phase 30 (spec §5.3): the Register form at quantity 1 carries the initial
    // state, in the friendly status words (plan P-6).
    await page.goto("/inventory/register");

    await page.getByLabel("Category").selectOption({ label: "Vehicle" });
    const initialState = page.getByRole("radiogroup", { name: "Initial state" });
    await expect(initialState.getByRole("radio")).toHaveCount(2);
    await expect(initialState.getByRole("radio", { name: "Stored" })).toBeChecked();
    await expect(initialState.getByRole("radio", { name: "Operational" })).toBeVisible();
    await expect(initialState.getByRole("radio", { name: "Deployed" })).toHaveCount(0);
    await expect(page.getByText("Registered as a spare, ready to assign.")).toBeVisible();

    await initialState.getByText("Operational").click();

    await page.getByLabel("Category").selectOption({ label: "Laptop" });
    // Admin applies IT's lifecycle directly, so Loan is offered (ruling R4).
    await expect(initialState.getByRole("radio")).toHaveCount(3);
    await expect(initialState.getByRole("radio", { name: "Spare" })).toBeChecked();
    await expect(initialState.getByRole("radio", { name: "Loan" })).toBeVisible();
    await expect(initialState.getByRole("radio", { name: "Operational" })).toHaveCount(0);

    // Direct for IT: the line says what happens, with no approval.
    await initialState.getByText("Deployed").click();
    await expect(page.getByText("Deployed to the chosen person.")).toBeVisible();
    await expect(page.getByText("This files a request for approval.")).toHaveCount(0);
    await initialState.getByText("Loan").click();
    await expect(page.getByText("Lent to the chosen person until the date below.")).toBeVisible();
    await expect(page.getByLabel("Loan until")).not.toHaveValue("");

    // Purchasing keeps its queue: a holder state files a request.
    await page.getByLabel("Category").selectOption({ label: "Vehicle" });
    await initialState.getByText("Operational").click();
    await expect(page.getByText("This files a request for approval.")).toBeVisible();
    await expect(page.getByLabel("Loan until")).toHaveCount(0);
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
        tag: "BR-LT-9901", model: "Wrong department (e2e)", brand: null, serial: null, categoryName: "Vehicle", typeName: null,
        status: "", assigneeName: null, assigneeNo: null, purchasedAt: null, cost: null, warrantyUntil: null,
        loanDueAt: null, vendorName: null, invoiceRef: null, rmaRef: null, notes: null, provenance: "Registered directly",
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
