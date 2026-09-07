import { test, expect, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { SEED_PASSWORD } from "../prisma/fixtures";
import { fmtDate } from "../src/lib/format";

/**
 * Phase 16 — custody. Six cases per spec §9.2 rows 7–12: a loaner slot fills
 * only from a TEMPORARY device; waiving and adding per-person slot
 * exceptions; a direct loan carries a due date that a return clears; the
 * Loans worklist ranks a no-due-date loan above an overdue one; bulk-assign
 * skips an untriaged spare by name; and a signed accountability form covers
 * current holdings, downloads with the right headers, and the next issue
 * shows as uncovered.
 *
 * Cases run serial: case 9 puts BR-MN-0910 through a full loan-then-triage
 * round trip so it reads as an ordinary assignable spare again by the time
 * case 11 selects it. Every other dependency (which slot exists, who holds
 * what) is looked up fresh, never hardcoded from a prior case.
 */

const db = new PrismaClient();

test.beforeAll(() => {
  execSync("npm run db:seed", { timeout: 120_000 });
});
test.afterAll(async () => {
  await db.$disconnect();
});

// Copied from e2e/direct-lifecycle.spec.ts:24-51 — house rule: never import
// helpers across spec files, since each file reseeds independently.
async function login(page: Page, email: string) {
  await page.goto("/logout");
  await page.getByLabel(/Email/).fill(email);
  await page.getByLabel(/Password/).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

const idOf = async (tag: string) => (await db.asset.findUniqueOrThrow({ where: { tag }, select: { id: true } })).id;

// highestNumber/tagOf (also part of the shared helper block at
// e2e/direct-lifecycle.spec.ts:24-51) are not needed here — no case in this
// file registers a fresh tag — so they are left out rather than copied unused.

const IT = "it@thebackroomop.com";
const ADMIN = "admin@thebackroomop.com";

const OPEN_STATES = ["PENDING", "CLAIMED", "APPROVED"] as const;

test.describe.serial("custody", () => {
  test("7. a loaner slot fills only from a TEMPORARY device", async ({ page }) => {
    // BR-LT-0210's real AssetType is "Dell Latitude" (the model text
    // "ThinkPad T14 Gen 4" is free-form and does not have to match) — looked
    // up rather than assumed, since a slot only fills from an exact typeId
    // match (computeLoadout).
    const bp = await db.asset.findUniqueOrThrow({ where: { tag: "BR-LT-0210" }, select: { typeId: true } });
    const laptopType = await db.assetType.findUniqueOrThrow({ where: { id: bp.typeId! }, include: { category: true } });
    const emp = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0095" } }); // Leo Tan, Contractor, holds BR-LT-0210 on loan

    // Verified against the seeded DB: only "Finance standard" (applies to the
    // Finance department) exists, and EMP-0095 is Operations/"Contractor" —
    // no policy applies to them yet, so a title policy is created below.
    await login(page, ADMIN);
    await page.goto("/admin/equipment-policies");

    await page.getByLabel("New policy name").fill("Contractor kit");
    // exact:true — "Applies to" is otherwise a substring match of the
    // department select's own label ("Department this policy applies to").
    await page.getByLabel("Applies to", { exact: true }).selectOption({ label: "a role title" });
    await page.getByLabel("Role title this policy applies to").fill(emp.title);
    await page.getByRole("button", { name: "Create policy" }).click();
    await expect(page.getByText("Policy created — add its slots next")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("heading", { name: "Contractor kit", level: 2 })).toBeVisible({ timeout: 10_000 });

    // Scoped to the Contractor kit card: "Add slot" is a bare button label
    // repeated on every policy card (Finance standard has its own), so an
    // unscoped getByRole would hit both once a second policy exists.
    const card = page.getByRole("heading", { name: "Contractor kit", level: 2 }).locator("xpath=../..");

    const typeLabel = `${laptopType.category.name} · ${laptopType.name}`;

    // A standard (non-loaner) slot of the SAME type first, to prove the
    // converse half of this case's title: a plain slot must NOT claim a
    // TEMPORARY device either.
    await card.getByLabel("New slot name for Contractor kit").fill("laptop");
    await card.getByLabel("Asset type for the new slot in Contractor kit").selectOption({ label: typeLabel });
    await card.getByRole("button", { name: "Add slot" }).click();
    await expect(page.getByText("Slot added — existing assignments are untouched").first()).toBeVisible({ timeout: 10_000 });

    await card.getByLabel("New slot name for Contractor kit").fill("loaner laptop");
    await card.getByLabel("Asset type for the new slot in Contractor kit").selectOption({ label: typeLabel });
    await card.getByLabel("loaner slot — filled by a device on loan (TEMPORARY)").check();
    await card.getByRole("button", { name: "Add slot" }).click();
    await expect(page.getByText("Slot added — existing assignments are untouched").first()).toBeVisible({ timeout: 10_000 });

    await page.goto(`/employees/${emp.id}`);
    const loanerTile = page.getByRole("button", { name: /^loaner laptop slot,/ });
    await expect(loanerTile).toBeVisible();
    await expect(loanerTile.getByText("BR-LT-0210")).toBeVisible();
    // exact:true — "LOAN" is otherwise a substring match of the tile's own
    // "loaner laptop" name label.
    await expect(loanerTile.getByText("LOAN", { exact: true })).toBeVisible();

    // The plain "laptop" slot (same type, not loaner) stays empty — Leo Tan
    // holds nothing else of this type, and BR-LT-0210 is TEMPORARY so the
    // non-loaner slot's own predicate excludes it.
    const standardTile = page.getByRole("button", { name: /^laptop slot,/ });
    await expect(standardTile).toBeVisible();
    await expect(standardTile.getByText("BR-LT-0210")).toHaveCount(0);
    await expect(standardTile.getByText("policy gap")).toBeVisible();
  });

  test("8. waiving a slot updates the progress line and can be restored; adding a slot shows an EXCEPTION pill", async ({ page }) => {
    const emp = await db.employee.findFirstOrThrow({ where: { department: { name: "Finance" }, employment: "ACTIVE" } });
    // No seeded Finance employee holds a headset-type asset (only EMP-0042
    // holds anything, and it's a laptop/monitor/phone/dock) — the headset
    // slot is unfilled for whichever Finance employee this query returns.
    await login(page, IT);
    await page.goto(`/employees/${emp.id}`);

    const progress = page.getByText(/^\d+ \/ \d+$/); // "Loadout vs policy" — "<filled> / <totalSlots>"
    const [filledBefore, totalBefore] = (await progress.textContent())!.split("/").map((n) => Number(n.trim()));

    await page.getByRole("button", { name: "Actions for the headset slot" }).click();
    await page.getByRole("menuitem", { name: "Waive for this person…" }).click();
    const waiveDialog = page.getByRole("dialog", { name: "Waive the headset slot?" });
    await waiveDialog.getByLabel("Reason").fill("piloting a BYOD headset policy");
    await waiveDialog.getByRole("button", { name: "Waive" }).click();
    await expect(page.getByText("headset waived for this person")).toBeVisible({ timeout: 10_000 });

    // Waiving removes the slot from effectiveSlots entirely — totalSlots
    // drops by one and filled is unchanged (headset was never filled), so
    // the number of missing (total - filled) slots reads one lower.
    await expect(progress).toHaveText(`${filledBefore} / ${totalBefore - 1}`);
    const details = page.getByText("Waived for this person (1)");
    await expect(details).toBeVisible();
    await details.click();
    await expect(page.getByText("piloting a BYOD headset policy")).toBeVisible();

    let waives = await db.employeeSlotException.findMany({ where: { employeeId: emp.id, kind: "WAIVE" } });
    expect(waives).toHaveLength(1);
    expect(await db.auditEntry.count({ where: { entityType: "employee", entityId: emp.id, action: "policy.exception.waived" } })).toBe(1);

    await page.getByRole("button", { name: "Restore" }).click();
    await expect(page.getByText("Exception removed")).toBeVisible({ timeout: 10_000 });
    await expect(progress).toHaveText(`${filledBefore} / ${totalBefore}`);
    await expect(page.getByText(/Waived for this person/)).toHaveCount(0);

    waives = await db.employeeSlotException.findMany({ where: { employeeId: emp.id, kind: "WAIVE" } });
    expect(waives).toHaveLength(0);
    expect(await db.auditEntry.count({ where: { entityType: "employee", entityId: emp.id, action: "policy.exception.removed" } })).toBe(1);

    // Add a "tablet" slot for this person only.
    await page.getByRole("button", { name: "Add a slot for this person…" }).click();
    const addDialog = page.getByRole("dialog", { name: "Add a slot for this person" });
    await addDialog.getByLabel("Slot name").fill("tablet");
    await addDialog.getByLabel("Reason").fill("pilot device for field staff");
    await addDialog.getByRole("button", { name: "Add" }).click();
    await expect(page.getByText("tablet added for this person")).toBeVisible({ timeout: 10_000 });

    const tabletTile = page.getByRole("button", { name: /^tablet slot,/ });
    await expect(tabletTile).toBeVisible();
    const exceptionPill = tabletTile.getByText("EXCEPTION");
    await expect(exceptionPill).toBeVisible();
    await expect(exceptionPill).toHaveAttribute("title", "pilot device for field staff");

    const adds = await db.employeeSlotException.findMany({ where: { employeeId: emp.id, kind: "ADD" } });
    expect(adds).toHaveLength(1);
    expect(adds[0].name).toBe("tablet");
    expect(adds[0].reason).toBe("pilot device for field staff");
    expect(await db.auditEntry.count({ where: { entityType: "employee", entityId: emp.id, action: "policy.exception.added" } })).toBe(1);
  });

  test("9. a direct loan carries a due date; returning clears it", async ({ page }) => {
    const id = await idOf("BR-MN-0910"); // SPARE monitor
    // Seeded with an ACTIVE reservation for EMP-0097 ("New hire setup") — the
    // assign guard refuses handing a reserved asset to anyone else, so the
    // loan goes to the reserving employee, which also fulfils the hold.
    const nina = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0097" } }); // Nina Robles, Finance, ACTIVE

    await login(page, IT);
    await page.goto(`/inventory/${id}`);
    await page.getByRole("button", { name: "Assign" }).click();
    const dialog = page.getByRole("dialog", { name: "Assign BR-MN-0910" });
    // The SegmentedControl's radio inputs are visually sr-only — clicking the
    // visible label text is what direct-lifecycle.spec.ts's own "Initial
    // status" case does, and is what an operator actually clicks.
    await dialog.getByRole("radiogroup", { name: "Assignment kind" }).getByText("Loan", { exact: true }).click();
    const loanDueAt = await dialog.getByLabel("Loan until").inputValue();
    await dialog.getByLabel("Assign to").fill("EMP-0097");
    await dialog.getByRole("option", { name: /EMP-0097/ }).click();
    await dialog.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText(`BR-MN-0910 on loan to ${nina.name} until ${loanDueAt}`)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(`On loan until ${fmtDate(loanDueAt)}`)).toBeVisible();

    let asset = await db.asset.findUniqueOrThrow({ where: { id } });
    expect(asset.status).toBe("TEMPORARY");
    expect(asset.loanDueAt?.toISOString().slice(0, 10)).toBe(loanDueAt);

    await page.getByRole("button", { name: "Return" }).click();
    const returnDialog = page.getByRole("dialog", { name: "Return BR-MN-0910" });
    await returnDialog.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText("BR-MN-0910 returned · now SPARE")).toBeVisible({ timeout: 15_000 });

    asset = await db.asset.findUniqueOrThrow({ where: { id } });
    expect(asset.loanDueAt).toBeNull();
    expect(asset.assigneeId).toBeNull();

    // Cleanup so case 11 finds BR-MN-0910 as an ordinary assignable spare,
    // not one "back but not yet triaged" (the default TRIAGE return outcome
    // sets returnedAt, same as direct-lifecycle.spec.ts's own case 3) — the
    // round trip an operator would actually complete.
    await page.getByRole("button", { name: "Triage" }).click();
    const triageDialog = page.getByRole("dialog", { name: "Triage BR-MN-0910" });
    await expect(triageDialog.getByLabel("Decision")).toHaveValue("SPARE");
    await triageDialog.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText("BR-MN-0910 triaged · Keep as spare")).toBeVisible({ timeout: 15_000 });

    asset = await db.asset.findUniqueOrThrow({ where: { id } });
    expect(asset.status).toBe("SPARE");
    expect(asset.returnedAt).toBeNull();
  });

  test("10. the Loans worklist ranks a no-due-date loan above an overdue one", async ({ page }) => {
    // BR-LT-0210 is still TEMPORARY with loanDueAt null (seed fact, untouched
    // by any earlier case in this file — case 9 worked on BR-MN-0910).
    const yesterday = new Date(Date.now() - 86_400_000);
    await db.asset.update({ where: { tag: "BR-PH-0287" }, data: { loanDueAt: yesterday } });

    await login(page, IT);
    await page.goto("/inventory/work");
    const loansSection = page.locator("section#loans");
    await expect(loansSection).toBeVisible();
    const rows = loansSection.locator("li");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText("BR-LT-0210 on loan with no due date");
    await expect(rows.nth(0).getByRole("link", { name: "Set date" })).toBeVisible();
    await expect(rows.nth(1)).toContainText("BR-PH-0287 overdue by 1 d");
  });

  test("11. bulk-assigning three spares assigns two and skips the untriaged one by name", async ({ page }) => {
    const [mn0910Id, mn0911Id, ph0301Id] = await Promise.all([
      idOf("BR-MN-0910"), idOf("BR-MN-0911"), idOf("BR-PH-0301"),
    ]);
    // Simulate "back but not yet triaged" without going through the whole
    // UI round trip — the same DB shape case 9's default TRIAGE return
    // outcome produces.
    await db.asset.update({ where: { id: ph0301Id }, data: { returnedAt: new Date() } });
    const paolo = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0071" } }); // Paolo Santos, IT Support, ACTIVE

    await login(page, IT);
    await page.goto("/inventory?status=SPARE");
    await page.getByLabel(/Select BR-MN-0910/).check();
    await page.getByLabel(/Select BR-MN-0911/).check();
    await page.getByLabel(/Select BR-PH-0301/).check();
    await page.getByRole("button", { name: "Bulk actions…" }).click();
    const drawer = page.getByRole("dialog", { name: "Bulk actions" });
    // Same sr-only-radio-input caveat as case 9 — click the visible label text.
    await drawer.getByRole("radiogroup", { name: "Bulk action" }).getByText("Assign to a person", { exact: true }).click();
    // getByRole("combobox", ...), not getByLabel: "Assign to" is otherwise a
    // substring match of the "Assign to a person" radio's own accessible name.
    await drawer.getByRole("combobox", { name: "Assign to" }).fill("EMP-0071");
    await drawer.getByRole("option", { name: /EMP-0071/ }).click();
    // BR-MN-0910 already carries one lifecycle_assign approval and audit
    // entry from case 9 (its loan to Nina) — scope the "this action wrote
    // two" checks below to writes from this point on, not just this asset.
    const beforeAction = new Date();
    await drawer.getByRole("button", { name: "Confirm" }).click();

    await expect(page.getByText(`2 assets assigned to ${paolo.name}`)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("1 skipped")).toBeVisible();
    await expect(page.getByText("BR-PH-0301 — BR-PH-0301 is back but not yet triaged")).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();

    const [mnA, mnB, ph] = await Promise.all([
      db.asset.findUniqueOrThrow({ where: { id: mn0910Id } }),
      db.asset.findUniqueOrThrow({ where: { id: mn0911Id } }),
      db.asset.findUniqueOrThrow({ where: { id: ph0301Id } }),
    ]);
    expect(mnA.assigneeId).toBe(paolo.id);
    expect(mnB.assigneeId).toBe(paolo.id);
    expect(ph.assigneeId).toBeNull();

    const executed = await db.approval.findMany({
      where: { assetId: { in: [mn0910Id, mn0911Id] }, type: "lifecycle_assign", createdAt: { gte: beforeAction } },
    });
    expect(executed).toHaveLength(2);
    expect(executed.every((a) => a.state === "EXECUTED")).toBe(true);
    expect(
      await db.auditEntry.count({
        where: { entityType: "asset", entityId: { in: [mn0910Id, mn0911Id] }, action: "lifecycle.assign", createdAt: { gte: beforeAction } },
      }),
    ).toBe(2);
    expect(
      await db.approval.count({ where: { assetId: { in: [mn0910Id, mn0911Id, ph0301Id] }, state: { in: [...OPEN_STATES] } } }),
    ).toBe(0);
  });

  test("12. a signed form covers current holdings, downloads correctly, and the next issue shows as uncovered", async ({ page }) => {
    const finance = await db.employee.findFirstOrThrow({ where: { department: { name: "Finance" }, employment: "ACTIVE" } });
    const heldCount = await db.asset.count({ where: { assigneeId: finance.id } });

    await login(page, IT);
    await page.goto(`/employees/${finance.id}`);
    await expect(page.getByText("No signed form on file")).toBeVisible();

    await page.getByRole("button", { name: "Record a signed form…" }).click();
    const dialog = page.getByRole("dialog", { name: "Record a signed form" });
    const signedRaw = await dialog.getByLabel("Signed on").inputValue();
    await dialog.getByLabel("Signed form (scan or photo)").setInputFiles({
      name: "signed.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 signed"),
    });
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Signed form recorded")).toBeVisible({ timeout: 15_000 });

    const plural = heldCount === 1 ? "" : "s";
    await expect(page.getByText(`Signed ${fmtDate(signedRaw)} · ${heldCount} item${plural} covered`)).toBeVisible();

    const ack = await db.acknowledgement.findFirstOrThrow({ where: { employeeId: finance.id } });
    expect((ack.items as unknown as Array<{ assetId: string }>)).toHaveLength(heldCount);
    expect(await db.auditEntry.count({ where: { entityType: "employee", entityId: finance.id, action: "acknowledgement.recorded" } })).toBe(1);

    const href = await page.getByRole("link", { name: "Download" }).getAttribute("href");
    const res = await page.request.get(href!);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-disposition"]).toContain("attachment");

    // Issue one more spare to them — it was not part of the snapshot above,
    // so it must surface as uncovered.
    const spareId = await idOf("BR-HS-0502");
    await page.goto(`/inventory/${spareId}`);
    await page.getByRole("button", { name: "Assign" }).click();
    const assignDialog = page.getByRole("dialog", { name: "Assign BR-HS-0502" });
    await assignDialog.getByLabel("Assign to").fill(finance.employeeNo);
    await assignDialog.getByRole("option", { name: new RegExp(finance.employeeNo) }).click();
    await assignDialog.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText(`BR-HS-0502 assigned to ${finance.name}`)).toBeVisible({ timeout: 15_000 });

    await page.goto(`/employees/${finance.id}`);
    await expect(page.getByText("Issued since last signature: BR-HS-0502")).toBeVisible();
  });
});
