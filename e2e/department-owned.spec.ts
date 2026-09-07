import { test, expect, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { SEED_PASSWORD } from "../prisma/fixtures";

/**
 * Phase 14 — each department owns its class. Thirteen cases: Purchasing
 * approves its own lifecycle changes through the real actions, IT cannot
 * touch them, admin sees both; Assign holder / Return on the asset record;
 * documents by class; categories and types by class; labels; the new-employee
 * form; the Home stats; the asymmetric visibility rule (IT/viewer see IT
 * assets only); and the full register-then-check-then-confirm flow across
 * Purchasing, IT and Finance.
 *
 * Never reference a raw cuid — the DB reseeds and cuids change every run.
 * Assets are referenced by tag, employees by employeeNo, approvals by refNo
 * read back from the DB.
 */
const db = new PrismaClient();
const P = "purchasing@thebackroomop.com";
const IT = "it@thebackroomop.com";
const ADMIN = "admin@thebackroomop.com";
const FIN = "finance@thebackroomop.com";

test.beforeAll(() => {
  execSync("npm run db:seed", { timeout: 120_000 });
});
test.afterAll(async () => {
  await db.$disconnect();
});

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

/** Drives the worker exactly like asset-classes.spec.ts — the job was enqueued by the REAL approve action this time. */
function runWorkerOnce() {
  execSync("npm run worker:once", { timeout: 60_000, stdio: "inherit" });
}

test.describe.serial("Purchasing owns its approvals", () => {
  test("1. request → Purchasing's queue, not IT's → claim → approve → worker executes", async ({ page }) => {
    const id = await idOf("BR-VH-0002");
    await login(page, P);
    await page.goto(`/inventory/${id}`);
    await page.getByRole("button", { name: "Request status change" }).click();
    await page.getByLabel("New status").selectOption("REPAIRING");
    await page.getByLabel("Reason").fill("e2e — brake pads");
    await page.getByRole("dialog", { name: "Request a status change" }).getByRole("button", { name: "Request", exact: true }).click();
    await expect(page.getByText(/created — waiting in the approval queue/)).toBeVisible();
    const refNo = (await db.approval.findFirstOrThrow({ where: { assetId: id, state: "PENDING" } })).refNo;
    await page.goto("/approvals");
    await expect(page.getByRole("row", { name: new RegExp(refNo) })).toBeVisible();
    await login(page, IT);
    await page.goto("/approvals");
    await expect(page.getByRole("row", { name: new RegExp(refNo) })).toHaveCount(0);
    await login(page, P);
    await page.goto("/approvals");
    await page.getByRole("link", { name: refNo }).click();
    await expect(page.getByRole("heading", { name: refNo })).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Claim" }).click();
    await expect(page.getByText(`${refNo} claimed`)).toBeVisible();
    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText(`${refNo} approved`)).toBeVisible();
    runWorkerOnce();
    expect((await db.asset.findUniqueOrThrow({ where: { id } })).status).toBe("REPAIRING");
    expect((await db.approval.findUniqueOrThrow({ where: { refNo } })).state).toBe("EXECUTED");
  });

  test("2. IT cannot act on a Purchasing approval, even by URL", async ({ page }) => {
    const id = await idOf("BR-FN-0003"); // STORED furniture
    await login(page, P);
    await page.goto(`/inventory/${id}`);
    await page.getByRole("button", { name: "Request status change" }).click();
    await page.getByLabel("New status").selectOption("RETIRED");
    await page.getByLabel("Reason").fill("e2e — broken leg");
    await page.getByRole("dialog", { name: "Request a status change" }).getByRole("button", { name: "Request", exact: true }).click();
    await expect(page.getByText(/created — waiting in the approval queue/)).toBeVisible();
    const approval = await db.approval.findFirstOrThrow({ where: { assetId: id, state: "PENDING" } });

    await login(page, IT);
    await page.goto(`/approvals/${approval.id}`);
    await expect(page.getByRole("heading", { name: approval.refNo })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Claim" })).toHaveCount(0);
    expect((await db.approval.findUniqueOrThrow({ where: { id: approval.id } })).state).toBe("PENDING");
  });

  test("3. admin's queue shows both classes", async ({ page }) => {
    await login(page, ADMIN);
    await page.goto("/approvals");
    await expect(page.getByRole("row", { name: /APR-2041/ })).toBeVisible(); // seeded IT
    const fn = await db.approval.findFirstOrThrow({ where: { asset: { tag: "BR-FN-0003" }, state: "PENDING" } });
    await expect(page.getByRole("row", { name: new RegExp(fn.refNo) })).toBeVisible();
  });
});

test.describe.serial("Assign holder / Return", () => {
  test("4. Purchasing assigns a stored car, approves, the car is held; then returns it", async ({ page }) => {
    // BR-VH-0002 was executed to REPAIRING in case 1 — put it back to STORED via Prisma, which the trigger allows.
    await db.asset.update({ where: { tag: "BR-VH-0002" }, data: { status: "STORED" } });
    const id = await idOf("BR-VH-0002");
    await login(page, P);
    await page.goto(`/inventory/${id}`);
    await page.getByRole("button", { name: "Assign holder" }).click();
    const dialog = page.getByRole("dialog", { name: "Assign a holder" });
    await dialog.getByRole("combobox").fill("EMP-0097");
    await dialog.getByRole("option", { name: /EMP-0097/ }).click();
    await dialog.getByLabel("Reason").fill("e2e — pool car to Nina");
    await dialog.getByRole("button", { name: "Request assign" }).click();
    await expect(page.getByText(/created — waiting in the approval queue/)).toBeVisible();
    const assign = await db.approval.findFirstOrThrow({ where: { assetId: id, state: "PENDING", type: "lifecycle_assign" } });
    // The control is absent while the approval is open.
    await page.reload();
    await expect(page.getByRole("button", { name: "Assign holder" })).toHaveCount(0);

    await page.goto(`/approvals/${assign.id}`);
    await page.getByRole("button", { name: "Claim" }).click();
    await expect(page.getByText(`${assign.refNo} claimed`)).toBeVisible();
    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText(`${assign.refNo} approved`)).toBeVisible();
    runWorkerOnce();
    const held = await db.asset.findUniqueOrThrow({ where: { id }, include: { assignee: true } });
    expect(held.status).toBe("OPERATIONAL");
    expect(held.assignee?.employeeNo).toBe("EMP-0097");

    await page.goto(`/inventory/${id}`);
    await expect(page.getByText(/held by/)).toBeVisible();
    await page.getByRole("button", { name: "Return" }).click();
    const ret = page.getByRole("dialog", { name: "Request a return" });
    await ret.getByLabel("Reason").fill("e2e — back to the pool");
    await ret.getByRole("button", { name: "Request return" }).click();
    await expect(page.getByText(/created — waiting in the approval queue/)).toBeVisible();
    const returned = await db.approval.findFirstOrThrow({ where: { assetId: id, state: "PENDING", type: "lifecycle_return" } });
    expect((returned.payload as { to: { status: string } }).to.status).toBe("STORED");
  });

  test("5. on a laptop, Purchasing has no holder control and the holder link opens read-only", async ({ page }) => {
    const id = await idOf("BR-LT-0148"); // DEPLOYED, held, seeded checked
    await login(page, P);
    await page.goto(`/inventory/${id}`);
    await expect(page.getByRole("button", { name: "Return" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Assign holder" })).toHaveCount(0);
    // BR-LT-0148 is seeded checked (itVerifiedAt not null): the isAwaitingItCheck
    // window that would otherwise grant Purchasing an Edit link has closed.
    await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);
    await page.getByRole("link", { name: /held by/ }).or(page.locator('a[href^="/employees/"]').first()).click();
    await expect(page).toHaveURL(/\/employees\/[^/]+$/);
    await expect(page.getByRole("region", { name: "Loadout view" }).or(page.getByLabel("Loadout view"))).toBeVisible();
    await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);
  });
});

test.describe("documents by class", () => {
  const pdf = { name: "orcr.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%e2e\n") };

  test("6. Purchasing files a car's papers and signs them; a laptop's panel is read-only for Purchasing", async ({ page }) => {
    const car = await idOf("BR-VH-0001");
    await login(page, P);
    await page.goto(`/inventory/${car}/documents`);
    // D-: documents-panel.tsx only renders "Mark signed" for kind
    // "accountability-form" (`doc.kind === "accountability-form"`) — "other"
    // (the plan's draft) never gets a sign control.
    await page.getByLabel("Document kind").selectOption("accountability-form");
    await page.locator('input[type="file"]').setInputFiles(pdf);
    await expect(page.getByText("orcr.pdf")).toBeVisible();
    await page.getByRole("button", { name: "Mark signed" }).click();
    // D-: getByText("SIGNED") without exact:true also matches the "Mark
    // signed" button's OWN label (substring match, case-insensitive) —
    // before the real Pill replaces it, the assertion was resolving
    // instantly against the still-present button, so the DB check right
    // after ran before the sign action had actually committed. exact:true
    // targets the real Pill (documents-panel.tsx) and waits for it for real.
    await expect(page.getByText("SIGNED", { exact: true })).toBeVisible();
    expect(await db.assetDocument.count({ where: { assetId: car, signed: true } })).toBe(1);

    const laptop = await idOf("BR-LT-0148");
    await page.goto(`/inventory/${laptop}/documents`);
    await expect(page.getByRole("button", { name: "Choose file" })).toHaveCount(0);
    await expect(page.getByLabel("Document kind")).toHaveCount(0);
  });
});

test.describe.serial("categories and types by class", () => {
  test("7. Purchasing creates Office Supplies (class forced) and a Shredder under it; IT never sees the row", async ({ page }) => {
    await login(page, P);
    await page.goto("/admin/asset-categories");
    await expect(page.getByRole("combobox", { name: "Class for the new category" })).toHaveCount(0);
    await expect(page.getByLabel("Class for the new category")).toHaveText("PURCHASING");
    await page.getByLabel("New category name").fill("Office Supplies");
    await page.getByRole("button", { name: "Add" }).click();
    // D-: the inline add row (ref-table.tsx) is itself a <Tr>, and until
    // createRefRow resolves and clears newName, its Input's un-cleared value
    // ("Office Supplies") can satisfy getByRole("row", { name: /Office
    // Supplies/ }) on its own — a false positive that let the DB read below
    // race ahead of the real write. Wait for the input to actually clear
    // (only happens on the success path, ref-table.tsx's run()) first.
    await expect(page.getByLabel("New category name")).toHaveValue("");
    await expect(page.getByRole("row", { name: /Office Supplies/ })).toBeVisible();
    const cat = await db.assetCategory.findUniqueOrThrow({ where: { name: "Office Supplies" } });
    expect(cat.cls).toBe("PURCHASING");
    await expect(page.getByRole("row", { name: /Laptop/ })).toHaveCount(0);

    await page.goto("/admin/asset-types");
    const picker = page.getByLabel("Category for the new type");
    const offered = await picker.locator("option").allTextContents();
    expect(offered).toContain("Office Supplies");
    expect(offered).not.toContain("Laptop");
    await picker.selectOption({ label: "Office Supplies" });
    await page.getByLabel("New type name").fill("Shredder");
    await page.getByRole("button", { name: "Add" }).click();
    // Same D- as above, for the type table's add row.
    await expect(page.getByLabel("New type name")).toHaveValue("");
    await expect(page.getByRole("row", { name: /Shredder/ })).toBeVisible();

    await login(page, IT);
    await page.goto("/admin/asset-categories");
    await expect(page.getByRole("row", { name: /Office Supplies/ })).toHaveCount(0);
    await expect(page.getByRole("row", { name: /Laptop/ })).toBeVisible();

    await login(page, ADMIN);
    await page.goto("/admin/asset-categories");
    await expect(page.getByRole("row", { name: /Office Supplies/ })).toContainText("PURCHASING");
    await expect(page.getByRole("combobox", { name: "Class for the new category" })).toBeVisible();
  });
});

test.describe("labels", () => {
  test("8. Purchasing prints two cars; a smuggled laptop id is skipped and counted", async ({ page }) => {
    const [a, b, lt] = await Promise.all([idOf("BR-VH-0001"), idOf("BR-VH-0002"), idOf("BR-LT-0148")]);
    await login(page, P);
    await page.goto(`/inventory/labels?ids=${a},${b}`);
    await expect(page.getByRole("heading", { name: "Print labels", level: 1 })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("img", { name: "Barcode BR-VH-0001" })).toBeVisible();
    await expect(page.getByRole("img", { name: "Barcode BR-VH-0002" })).toBeVisible();
    await expect(page.getByText("2 labels · 1 sheet")).toBeVisible();

    await page.goto(`/inventory/labels?ids=${a},${lt}`);
    await expect(page.getByText("1 selected asset could not be printed and was skipped.")).toBeVisible();
    await expect(page.getByRole("img", { name: "Barcode BR-LT-0148" })).toHaveCount(0);
  });
});

test.describe.serial("new employee", () => {
  test("9. IT creates an employee and a case-variant duplicate is refused", async ({ page }) => {
    await login(page, IT);
    await page.goto("/employees");
    await page.getByRole("link", { name: "New employee" }).click();
    await expect(page).toHaveURL(/\/employees\/new$/);
    await page.getByLabel("Employee number").fill("EMP-9001");
    await page.getByLabel("Name").fill("Test Person");
    await page.getByLabel("Title").fill("Analyst");
    await page.getByLabel("Department").selectOption({ label: "IT" });
    await page.getByRole("button", { name: "Create employee" }).click();
    await expect(page).toHaveURL(/\/employees\/[^/]+$/);
    await expect(page.getByRole("heading", { name: "Test Person" })).toBeVisible();
    const row = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-9001" } });
    expect(row.employment).toBe("ACTIVE");
    expect(await db.auditEntry.count({ where: { entityType: "employee", entityId: row.id, action: "create" } })).toBe(1);

    await page.goto("/employees/new");
    await page.getByLabel("Employee number").fill("emp-9001");
    await page.getByLabel("Name").fill("Someone Else");
    await page.getByLabel("Title").fill("Clerk");
    await page.getByRole("button", { name: "Create employee" }).click();
    await expect(page.getByText("That employee number is already in use")).toBeVisible();
    expect(await db.employee.count({ where: { employeeNo: { equals: "emp-9001", mode: "insensitive" } } })).toBe(1);
  });

  test("10. Purchasing cannot open the create or edit forms", async ({ page }) => {
    const emp = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0097" } });
    await login(page, P);
    await page.goto("/employees/new");
    await expect(page).not.toHaveURL(/\/employees\/new/);
    await page.goto(`/employees/${emp.id}/edit`);
    await expect(page).not.toHaveURL(/\/edit$/);
    await page.goto(`/employees/${emp.id}`);
    await expect(page.getByRole("heading", { name: emp.name })).toBeVisible();
  });
});

test.describe("Purchasing Home", () => {
  test("11. Approvals waiting and Awaiting IT check", async ({ page }) => {
    const expectedApprovals = await db.approval.count({
      where: { state: { in: ["PENDING", "CLAIMED"] }, OR: [{ assetId: null }, { asset: { cls: "PURCHASING" } }] },
    });
    const expectedItCheck = await db.asset.count({ where: { cls: "IT", itVerifiedAt: null } });
    await login(page, P);
    await page.goto("/");
    await expect(page.getByText("Approvals waiting")).toBeVisible();
    await expect(page.getByRole("link", { name: String(expectedApprovals), exact: true })).toBeVisible();
    await expect(page.getByText("Awaiting IT check")).toBeVisible();
    // "Awaiting IT check" (Stat's label span) and its number (Stat's value
    // span) are siblings, not one text node — assert the number lives in the
    // same Stat block rather than trying to match one combined string.
    await expect(page.getByText("Awaiting IT check").locator("xpath=..")).toContainText(String(expectedItCheck));
  });
});

test.describe("visibility", () => {
  test("12. IT is redirected off the Purchasing view, cannot open a car, and the scan card says so", async ({ page }) => {
    const car = await idOf("BR-VH-0001");
    await login(page, IT);
    await page.goto("/inventory?cls=PURCHASING");
    await expect(page).toHaveURL(/\/inventory$/);
    await expect(page.getByRole("navigation", { name: "Asset class" })).toHaveCount(0);
    await page.goto(`/inventory/${car}`);
    // D-: AssetRecordLayout's own notFound() (a wrong-class id) bubbles past
    // the scoped inventory/[id]/not-found.tsx (a sibling of the layout, which
    // per Next.js cannot catch a notFound() the layout itself throws) to the
    // app's root not-found page — "This page doesn't exist", not "not found".
    await expect(page.getByText("This page doesn't exist", { exact: true })).toBeVisible();
    await page.goto("/inventory/scan/BR-VH-0001");
    await expect(page.getByText("BR-VH-0001 is not in your register.")).toBeVisible();
    await login(page, P);
    await page.goto(`/inventory/${car}`);
    await expect(page.getByRole("heading", { name: "BR-VH-0001" })).toBeVisible();
    await page.goto("/inventory/scan/BR-VH-0001");
    await expect(page.getByRole("button", { name: "Open full record" }).or(page.getByRole("link", { name: "Open full record" }))).toBeVisible();
  });
});

test.describe.serial("the register flow: Purchasing → IT → Finance", () => {
  let tag = "";
  let id = "";
  test("13a. Purchasing registers a laptop; it awaits IT; Purchasing can still edit", async ({ page }) => {
    tag = tagOf("LT", (await highestNumber("LT")) + 1);
    await login(page, P);
    await page.goto("/inventory/register");
    await page.getByLabel("Category").selectOption({ label: "Laptop" });
    await page.getByLabel("Model").fill("ThinkPad T14 Gen 5 (e2e)");
    // D-: finance/queries.ts's financeAssets only lists assets with
    // `cost: { not: null }` ("Capitalized assets: anything with an
    // acquisition cost") — 13d expects Finance to list this asset once
    // confirmed, so it needs a cost from the start, or it would never appear
    // there regardless of itVerifiedAt/financeConfirmedAt.
    await page.getByLabel("Cost (₱)").fill("45000");
    await page.getByLabel("Quantity").fill("1");
    await expect(page.getByLabel("Tag 1")).toHaveValue(tag);
    await page.getByRole("button", { name: "Register asset" }).click();
    await page.waitForURL((url) => url.pathname === "/inventory");
    const a = await db.asset.findUniqueOrThrow({ where: { tag } });
    id = a.id;
    expect(a.cls).toBe("IT");
    expect(a.itVerifiedAt).toBeNull();
    await page.goto(`/inventory/${id}`);
    await expect(page.getByText("AWAITING IT CHECK")).toBeVisible();
    await page.getByRole("link", { name: "Edit" }).click();
    await page.getByLabel("Model").fill("ThinkPad T14 Gen 5 (e2e, corrected)");
    await page.getByRole("button", { name: /Save/ }).click();
    await expect(page.getByText(/Saved|saved/)).toBeVisible();
  });
  test("13b. Finance cannot see or confirm it yet", async ({ page }) => {
    await login(page, FIN);
    await page.goto("/finance/assets");
    await expect(page.getByRole("link", { name: tag })).toHaveCount(0);
    await page.goto(`/inventory/${id}`);
    await expect(page.getByRole("button", { name: "Confirm details" })).toHaveCount(0);
  });
  test("13c. IT's Home lists it under CHECK; IT marks it checked; Purchasing's Edit is gone", async ({ page }) => {
    await login(page, IT);
    await page.goto("/");
    // D-: "Your shift" caps at SHIFT_LIMIT=5 and ranks CHECK last of all six
    // kinds (lib/home.ts KIND_RANK). The seed gives this user SIX higher-
    // ranked candidate rows (an overdue SLA, a failed EXEC, an offboarding
    // LEAVE, two recent HIREs, and one MISSING-asset DATA row that only
    // appears once the visible five make room) — one more than the window —
    // so the new CHECK row has no room to show until at least two are
    // cleared. Clear them first — a real, supported action ("Clear … for
    // today", dismiss-button.tsx) — the same way a shift worker would,
    // rather than asserting on a list ordering this case doesn't own. Each
    // clear is a full server round trip (dismissShiftRow + router.refresh()),
    // so wait for the network to settle rather than for an exact row count —
    // a cleared row is very often replaced in the same render by the next
    // candidate, so the total count does not reliably dip in between.
    for (let i = 0; i < 5; i++) {
      if (await page.getByText(new RegExp(tag)).count()) break;
      await page.getByRole("button", { name: /^Clear "/ }).first().click();
      await page.waitForLoadState("networkidle");
    }
    await expect(page.getByText(new RegExp(tag))).toBeVisible();
    await page.goto(`/inventory/${id}`);
    await page.getByRole("button", { name: "Mark checked" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Mark checked" }).click();
    await expect(page.getByText(/checked — Finance can see it now/)).toBeVisible();
    await expect(page.getByText("AWAITING FINANCE")).toBeVisible();
    expect((await db.asset.findUniqueOrThrow({ where: { id } })).itVerifiedAt).not.toBeNull();
    await login(page, P);
    await page.goto(`/inventory/${id}`);
    await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);
  });
  test("13d. Finance now lists and confirms it", async ({ page }) => {
    await login(page, FIN);
    await page.goto("/finance/assets");
    await expect(page.getByRole("link", { name: tag })).toBeVisible();
    await page.goto(`/inventory/${id}`);
    await page.getByRole("button", { name: "Confirm details" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(page.getByText(/FINANCE CONFIRMED/)).toBeVisible();
  });
});
