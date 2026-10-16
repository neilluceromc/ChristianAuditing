import { test, expect, type Locator, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import { SEED_PASSWORD } from "../prisma/fixtures";
import { fmtDate, fmtDayMonth, fmtDayMonthYear, localDateISO } from "../src/lib/format";
import { dueStatus } from "../src/lib/deadlines";

/**
 * Phase 16 — custody. Six cases per spec §9.2 rows 7–12: a loaner slot fills
 * only from a TEMPORARY device; waiving and adding per-person slot
 * exceptions; a direct loan carries a due date that a return clears; the
 * Loans worklist ranks a no-due-date loan above an overdue one; bulk-assign
 * skips an untriaged spare by name; and a signed accountability form covers
 * current holdings, downloads with the right headers, and the next issue
 * shows as uncovered. The final-review fix wave (D-20) adds axe coverage of
 * this phase's new dialogs and drawer states: the Waive and Add-a-slot
 * dialogs (case 8), the Assign dialog in Loan mode (case 9), the bulk drawer
 * in assign mode and again on its skipped list (case 11), and the Record-a-
 * signed-form dialog (case 12).
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

// Copied from e2e/it-core.spec.ts:24 — house rule: never import across spec
// files. Adapted with the same pointer-settle step e2e/axe-sweep.spec.ts's
// scanRoute already uses: unlike it-core.spec.ts's callers (every one a fresh
// page.goto), every call here follows a click that opens a dialog or drawer,
// and a freshly-mounted Button variant="primary" reports a phantom SERIOUS
// contrast violation when axe samples it mid-transition or with the pointer
// resting on it — measured here on the Waive dialog (3.6:1 against the
// required 4.5:1, on the "Waive" button), it passes at rest. Settling first,
// not weakening the assertion.
async function expectNoSeriousAxe(page: Page) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(700);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
}

// Copied from e2e/admin.spec.ts (itself from e2e/it-nav.spec.ts:88-97) — house rule: never import
// helpers across spec files.
async function waitForHydration(target: Locator) {
  const el = target.first();
  await el.waitFor({ state: "attached", timeout: 20_000 });
  await expect(async () => {
    expect(await el.evaluate((node) => Object.keys(node).some((k) => k.startsWith("__reactFiber$")))).toBe(
      true,
    );
  }).toPass({ timeout: 20_000 });
}

const IT = "it@thebackroomop.com";
const ADMIN = "admin@thebackroomop.com";

const OPEN_STATES = ["PENDING", "CLAIMED", "APPROVED"] as const;

test.describe.serial("custody", () => {
  test("7. a loaner slot fills only from a TEMPORARY device", async ({ page }) => {
    // BR-LT-0210's real AssetType is "Standard" (the model text
    // "ThinkPad T14 Gen 4" is free-form and does not have to match) — looked
    // up rather than assumed, since a slot only fills from an exact typeId
    // match (computeLoadout).
    const bp = await db.asset.findUniqueOrThrow({ where: { tag: "BR-LT-0210" }, select: { typeId: true } });
    const laptopType = await db.assetType.findUniqueOrThrow({ where: { id: bp.typeId! }, include: { category: true } });
    const emp = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0095" } }); // Leo Tan, Contractor, holds BR-LT-0210 on loan

    // Phase 37 (spec §3.3): a policy belongs to a department or client and is edited on the Equipment
    // policies page. EMP-0095 is Operations, which the seed leaves without one, so Operations gets one
    // here: Start empty (one Laptop line), pin it to this laptop's own type, then a second line of the
    // SAME type marked Loan. Phase 37 (spec §3.2): the lines are numbered in policy order, "Laptop" then "Laptop 2".
    const ops = await db.department.findFirstOrThrow({ where: { name: "Operations" } });
    await login(page, ADMIN);
    await page.goto(`/admin/equipment-policies?tab=internal&group=${ops.id}`);
    const startEmpty = page.getByRole("button", { name: "Start empty" });
    await waitForHydration(startEmpty);
    await startEmpty.click();

    const editor = page.getByRole("region", { name: "What their staff should have" });
    await editor.getByLabel("Line 1 kind", { exact: true }).selectOption({ label: laptopType.category.name });
    await editor.getByLabel("Line 1 variant", { exact: true }).selectOption({ label: laptopType.name });
    // A standard (non-loaner) line of the SAME type first, to prove the converse half of this case's
    // title: a plain slot must NOT claim a TEMPORARY device either.
    await editor.getByRole("button", { name: "+ Add slot" }).click();
    await editor.getByLabel("Line 2 kind", { exact: true }).selectOption({ label: laptopType.category.name });
    await editor.getByLabel("Line 2 variant", { exact: true }).selectOption({ label: laptopType.name });
    await editor.getByLabel("Line 2 filled by a lent device").check();
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator('[aria-live="polite"]')).toContainText("Saved", { timeout: 10_000 });
    // Wait for the refreshed page to replace the editor (Save idle and disabled: nothing unsaved) — leaving
    // earlier would meet the editor's beforeunload guard — and for both slots to be in the database.
    const save = editor.getByRole("button", { name: "Save", exact: true });
    await expect(save).not.toHaveAttribute("aria-busy", "true", { timeout: 15_000 });
    await expect(save).toBeDisabled();
    expect(await db.policySlot.count({ where: { policy: { appliesToDepartmentId: ops.id, appliesToTitle: null } } })).toBe(2);

    await page.goto(`/employees/${emp.id}`);
    // Phase 37 (spec §4.3): each tile is a group named by its label; a tile with a device opens the side panel
    // through a button named "{label}: {model} {tag}", and a loan is the tile's status chip.
    const loanerTile = page.getByRole("group", { name: "Laptop 2", exact: true });
    await expect(loanerTile.getByRole("button", { name: /^Laptop 2: .+ BR-LT-0210$/ })).toBeVisible({ timeout: 20_000 });
    await expect(loanerTile).toContainText("On loan");

    // The plain line (same type, not loaner) stays empty — Leo Tan holds nothing else of this type, and
    // BR-LT-0210 is TEMPORARY so the non-loaner slot's own predicate excludes it.
    const standardTile = page.getByRole("group", { name: "Laptop", exact: true });
    await expect(standardTile).toContainText("Nothing assigned");
    await expect(standardTile).toContainText("Missing");
    await expect(standardTile).not.toContainText("BR-LT-0210");
  });

  test("8. waiving a slot updates the progress line and can be restored; adding a slot shows an EXCEPTION pill", async ({ page }) => {
    const emp = await db.employee.findFirstOrThrow({ where: { department: { name: "Finance" }, employment: "ACTIVE" } });
    // No seeded Finance employee holds a headset-type asset (only EMP-0042
    // holds anything, and it's a laptop/monitor/phone/dock) — the headset
    // slot is unfilled for whichever Finance employee this query returns.
    await login(page, IT);
    await page.goto(`/employees/${emp.id}`);

    // Phase 29 (ruling R4): the bare "<filled> / <totalSlots>" element is gone.
    // The left panel now spells the same two numbers out — "{filled} of {total}
    // slots filled · {policy}" — so this reads them out of that sentence
    // instead, and the later assertions re-read it the same way.
    const progress = page.getByText(/^\d+ of \d+ slots filled/);
    const [, filledBefore, totalBefore] = /(\d+) of (\d+)/
      .exec((await progress.textContent())!)!
      .map(Number);

    // Phase 37 (spec §4.3): the ⋯ is "More for {label}", and the label is the derived "Headset".
    await page.getByRole("button", { name: "More for Headset", exact: true }).click();
    // Phase 29 (spec §4.4, ruling R4): the pinned menu label is now the shorter
    // "Waive this slot…" — the menu is already this slot's, so naming the
    // person again said nothing.
    await page.getByRole("menuitem", { name: "Waive this slot…" }).click();
    const waiveDialog = page.getByRole("dialog", { name: "Waive the Headset slot?" });
    await expect(waiveDialog).toBeVisible();
    await expectNoSeriousAxe(page); // D-20: the Waive dialog, open
    await waiveDialog.getByLabel("Reason").fill("piloting a BYOD headset policy");
    await waiveDialog.getByRole("button", { name: "Waive" }).click();
    await expect(page.getByText("Headset waived for this person")).toBeVisible({ timeout: 10_000 });

    // Waiving removes the slot from effectiveSlots entirely — totalSlots
    // drops by one and filled is unchanged (headset was never filled), so
    // the number of missing (total - filled) slots reads one lower.
    await expect(progress).toHaveText(new RegExp(`^${filledBefore} of ${totalBefore - 1} slots filled`));
    const details = page.getByText("Waived for this person (1)");
    await expect(details).toBeVisible();
    await details.click();
    await expect(page.getByText("piloting a BYOD headset policy")).toBeVisible();

    let waives = await db.employeeSlotException.findMany({ where: { employeeId: emp.id, kind: "WAIVE" } });
    expect(waives).toHaveLength(1);
    expect(await db.auditEntry.count({ where: { entityType: "employee", entityId: emp.id, action: "policy.exception.waived" } })).toBe(1);

    await page.getByRole("button", { name: "Restore" }).click();
    await expect(page.getByText("Exception removed")).toBeVisible({ timeout: 10_000 });
    await expect(progress).toHaveText(new RegExp(`^${filledBefore} of ${totalBefore} slots filled`));
    await expect(page.getByText(/Waived for this person/)).toHaveCount(0);

    waives = await db.employeeSlotException.findMany({ where: { employeeId: emp.id, kind: "WAIVE" } });
    expect(waives).toHaveLength(0);
    expect(await db.auditEntry.count({ where: { entityType: "employee", entityId: emp.id, action: "policy.exception.removed" } })).toBe(1);

    // Add a "Speaker" slot for this person only (Phase 37 §4.7: category Other, type Speaker — it shows as the type).
    await page.getByRole("button", { name: "Add a slot for this person…" }).click();
    const addDialog = page.getByRole("dialog", { name: `Add a slot for ${emp.name}` });
    await expect(addDialog).toBeVisible();
    await addDialog.getByLabel("What").selectOption({ label: "Other" });
    await addDialog.getByLabel("Which kind").selectOption({ label: "Speaker" });
    await expect(addDialog.getByText("Shows as “Speaker”")).toBeVisible();
    await expectNoSeriousAxe(page); // D-20: the Add-a-slot dialog, open
    await addDialog.getByLabel("Reason").fill("pilot device for field staff");
    await addDialog.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByText("Speaker added for this person")).toBeVisible({ timeout: 10_000 });

    const tabletTile = page.getByRole("group", { name: "Speaker", exact: true });
    await expect(tabletTile).toBeVisible();
    const exceptionPill = tabletTile.getByText("EXCEPTION");
    await expect(exceptionPill).toBeVisible();
    await expect(exceptionPill).toHaveAttribute("title", "pilot device for field staff");

    const adds = await db.employeeSlotException.findMany({ where: { employeeId: emp.id, kind: "ADD" } });
    expect(adds).toHaveLength(1);
    expect(adds[0].name).toBe("Speaker");
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
    await page.getByRole("button", { name: "Assign", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Assign BR-MN-0910 · LG 27UL500" });
    // The SegmentedControl's radio inputs are visually sr-only — clicking the
    // visible label text is what direct-lifecycle.spec.ts's own "Initial
    // status" case does, and is what an operator actually clicks.
    await dialog.getByRole("radiogroup", { name: "Assignment kind" }).getByText("Loan", { exact: true }).click();
    await expect(dialog.getByLabel("Loan until")).toBeVisible();
    await expectNoSeriousAxe(page); // D-20: the Assign dialog in Loan mode
    const loanDueAt = await dialog.getByLabel("Loan until").inputValue();
    await dialog.getByLabel("Assign to").fill("EMP-0097");
    await dialog.getByRole("option", { name: /EMP-0097/ }).click();
    await dialog.getByRole("button", { name: "Assign", exact: true }).click();
    // Phase 30 (spec §4.3): the toast prints the date through fmtDate, and the
    // header's loan line is "On loan until" beside a DuePill (date + tone text).
    await expect(page.getByText(`BR-MN-0910 on loan to ${nina.name} until ${fmtDate(loanDueAt)}`)).toBeVisible({ timeout: 15_000 });
    const loanLine = page.locator("p", { hasText: "On loan until" });
    await expect(loanLine).toContainText(fmtDate(loanDueAt));
    await expect(loanLine).toContainText(dueStatus(new Date(`${loanDueAt}T00:00:00Z`), localDateISO(new Date())).text);

    let asset = await db.asset.findUniqueOrThrow({ where: { id } });
    expect(asset.status).toBe("TEMPORARY");
    expect(asset.loanDueAt?.toISOString().slice(0, 10)).toBe(loanDueAt);

    await page.getByRole("button", { name: "Return", exact: true }).click();
    const returnDialog = page.getByRole("dialog", { name: `Return BR-MN-0910 · LG 27UL500 from ${nina.name}?` });
    await returnDialog.getByRole("button", { name: "Return", exact: true }).click();
    await expect(page.getByText("BR-MN-0910 returned · now Spare")).toBeVisible({ timeout: 15_000 });

    asset = await db.asset.findUniqueOrThrow({ where: { id } });
    expect(asset.loanDueAt).toBeNull();
    expect(asset.assigneeId).toBeNull();

    // Cleanup so case 11 finds BR-MN-0910 as an ordinary assignable spare,
    // not one "back but not yet triaged" (the default TRIAGE return outcome
    // sets returnedAt, same as direct-lifecycle.spec.ts's own case 3) — the
    // round trip an operator would actually complete.
    await page.getByRole("button", { name: "Triage", exact: true }).click();
    const triageDialog = page.getByRole("dialog", { name: "Triage BR-MN-0910 · LG 27UL500" });
    // Phase 40 §8: no default decision — Keep as spare is chosen, not saved past.
    await expect(triageDialog.getByLabel("Decision")).toHaveValue("");
    await triageDialog.getByLabel("Decision").selectOption("SPARE");
    await triageDialog.getByRole("button", { name: "Save decision", exact: true }).click();
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
    // Phase 32 (spec §5.1): the loan row opens the record's own Set loan date dialog in place.
    await expect(rows.nth(0).getByRole("button", { name: "Set loan date…" })).toBeVisible();
    await expect(rows.nth(1)).toContainText("BR-PH-0287 overdue by 1 d");

    // Phase 37 (spec §4.3): loans are a status, not a card. Marites's Phone slot is covered by BR-PH-0287 (a
    // TEMPORARY iPhone), so the Phone tile shows that loan and its chip carries the due date — now red, overdue.
    const marites = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0042" } });
    await page.goto(`/employees/${marites.id}`);
    const phone = page.getByRole("group", { name: "Phone", exact: true });
    await expect(phone.getByRole("button", { name: /^Phone: .+ BR-PH-0287$/ })).toBeVisible({ timeout: 20_000 });
    await expect(phone).toContainText(`On loan · due ${fmtDayMonth(yesterday)}`);
    await expect(phone.locator('[data-tone="danger"]')).toHaveText(/^On loan/);
    // …and the device is not repeated as a tile of its own, nor in the old cards.
    await expect(page.getByRole("button", { name: /BR-PH-0287$/ })).toHaveCount(1);
    await expect(page.getByRole("heading", { name: "On loan", exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Also holding", exact: true })).toHaveCount(0);
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
    // Phase 30 (spec §6.4): the selection bar's Assign… opens the drawer already in assign mode.
    await page.getByRole("button", { name: "Assign…", exact: true }).click();
    const drawer = page.getByRole("dialog", { name: "Bulk actions" });
    await expect(drawer.getByRole("radiogroup", { name: "Bulk action" }).getByRole("radio", { name: "Assign to a person" })).toBeChecked();
    // The drawer names what it will touch, in page order.
    await expect(drawer.getByText("BR-MN-0910, BR-MN-0911, BR-PH-0301", { exact: true })).toBeVisible();
    // getByRole("combobox", ...), not getByLabel: "Assign to" is otherwise a
    // substring match of the "Assign to a person" radio's own accessible name.
    await drawer.getByRole("combobox", { name: "Assign to" }).fill("EMP-0071");
    await drawer.getByRole("option", { name: /EMP-0071/ }).click();
    await expectNoSeriousAxe(page); // D-20: the bulk drawer in assign mode, before Confirm
    // BR-MN-0910 already carries one lifecycle_assign approval and audit
    // entry from case 9 (its loan to Nina) — scope the "this action wrote
    // two" checks below to writes from this point on, not just this asset.
    const beforeAction = new Date();
    await drawer.getByRole("button", { name: "Confirm" }).click();

    await expect(page.getByText(`2 assets assigned to ${paolo.name}`)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("1 skipped")).toBeVisible();
    await expect(page.getByText("BR-PH-0301 — BR-PH-0301 is back but not yet triaged")).toBeVisible();
    await expectNoSeriousAxe(page); // D-20: the bulk drawer's skipped list
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
    // Phase 39 (spec §2.4): the form lives on the side card's Form tab; ?side=form opens it.
    await page.goto(`/employees/${finance.id}?side=form`);
    await expect(page.getByText("No signed form on file")).toBeVisible();

    await page.getByRole("button", { name: "Record a signed form…" }).click();
    const dialog = page.getByRole("dialog", { name: "Record a signed form" });
    await expect(dialog).toBeVisible();
    await expectNoSeriousAxe(page); // D-20: the Record-a-signed-form dialog, open
    const signedRaw = await dialog.getByLabel("Signed on").inputValue();
    await dialog.getByLabel("Signed form (scan or photo)").setInputFiles({
      name: "signed.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 signed"),
    });
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Signed form recorded")).toBeVisible({ timeout: 15_000 });

    const plural = heldCount === 1 ? "" : "s";
    await expect(page.getByText(`Signed ${fmtDayMonthYear(signedRaw)} · covers ${heldCount} item${plural}`)).toBeVisible();

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
    await page.getByRole("button", { name: "Assign", exact: true }).click();
    const assignDialog = page.getByRole("dialog", { name: "Assign BR-HS-0502 · Jabra Evolve2 40" });
    await assignDialog.getByLabel("Assign to").fill(finance.employeeNo);
    await assignDialog.getByRole("option", { name: new RegExp(finance.employeeNo) }).click();
    await assignDialog.getByRole("button", { name: "Assign", exact: true }).click();
    await expect(page.getByText(`BR-HS-0502 assigned to ${finance.name}`)).toBeVisible({ timeout: 15_000 });

    await page.goto(`/employees/${finance.id}?side=form`);
    // Phase 39 (spec §2.4): "{k} issued since", with the tags on a muted line under it.
    // Scoped to the Form panel: the equipment tiles print the same tag.
    const formPanel = page.getByRole("tabpanel", { name: /^Form/ });
    await expect(formPanel.getByText("1 issued since", { exact: true })).toBeVisible();
    await expect(formPanel.getByText("BR-HS-0502", { exact: true })).toBeVisible();
  });
});
