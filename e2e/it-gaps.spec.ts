import { test, expect, type Locator, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { Prisma, PrismaClient } from "@prisma/client";
import { SEED_PASSWORD } from "../prisma/fixtures";
import { REPAIR_STAGES, REPAIR_STAGE_CASE_SQL, repairStage, type RepairLike } from "@/lib/repairs";
import { fmtDate } from "@/lib/format";

/**
 * Phase 20, Task 8 — the six closed IT gaps from spec §6 (6 cases), each
 * independent (own fixtures, no serial dependency) so a failure in one never
 * cascades into the next:
 *   1 (§6.1) bulk status skipped list names each tag and why.
 *   2 (§6.2) the register form's live identifier check is class-scoped.
 *   3 (§6.3) a loan-covered required slot reads "on loan", not a policy gap.
 *   4 the Replace picker's spare options carry "Same type"/"Other spare".
 *   5 (§6.5) a direct return updates the record's "Last change" line.
 *   6 (§6.6) the repair-stage cut (`repairStage`) matches the DB one row at a time.
 *
 * Seeded fixtures this file depends on (prisma/seed.ts), verified against
 * source rather than assumed from the brief:
 *   BR-HS-0502 (Headset, SPARE), BR-LT-0075 (Laptop, DONATED — closed
 *   family), BR-LT-0181 (Laptop, SPARE, same type as every other seeded
 *   Laptop — `mk()` always uses the category's first AssetType regardless of
 *   model text), BR-MN-0911 (Monitor, SPARE). BR-LT-0148 carries the seeded
 *   APR-2039 (CLAIMED) — an OPEN approval — so its record's Replace/Return
 *   controls are absent (layout.tsx: `canReturn = canMutate && !pending &&
 *   …`); case 4 uses BR-LT-0201 (MacBook Air M3, DEPLOYED, held by EMP-0099
 *   Carlo Dizon) instead, which carries no open approval. BR-DK-0071 (Dock,
 *   DEPLOYED, held by EMP-0042) carries none either. EMP-0095 Leo Tan,
 *   title "Contractor", Operations (no department policy), holds BR-LT-0210
 *   as a TEMPORARY loan. BR-VH-0001 is the seeded Vehicle (Purchasing class)
 *   tag. `it@thebackroomop.com` is seeded as User.name "J. Sarmiento"
 *   (prisma/seed.ts:38) — the same string both the "Last change" line's
 *   `AuditEntry.actorLabel` (R9) and, in the sibling offboarding-v2.spec.ts,
 *   the offboarding Decision's `claimedBy.name` resolve to for this user.
 */

const db = new PrismaClient();

test.beforeAll(() => {
  execSync("npm run db:seed", { timeout: 120_000 });
});
test.afterAll(async () => {
  await db.$disconnect();
});

// Copied from e2e/transfers.spec.ts:34-40 — house rule: never import helpers
// across spec files, since each file reseeds independently.
async function login(page: Page, email: string) {
  await page.goto("/logout");
  await page.getByLabel(/Email/).fill(email);
  await page.getByLabel(/Password/).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

// Copied from e2e/transfers.spec.ts:43-47.
async function expectNoSeriousAxe(page: Page) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(700);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
}

// Copied from e2e/transfers.spec.ts:49-58.
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

test.describe("it gaps", () => {
  test("1. bulk status change on two IT tags, one in a closed status, lists the skip in the drawer and the toast", async ({ page }) => {
    await login(page, IT);
    // status=SPARE,DONATED (comma-joined multi-value facet, url-state.ts) so
    // both candidates are on the page at once without touching BR-LT-0181 /
    // BR-MN-0911, which case 4 still needs untouched.
    await page.goto("/inventory?status=SPARE,DONATED");
    // This is the first hit of /inventory's selectable table in this file —
    // hydrating before the first `.check()` avoids a real flake seen while
    // writing this test: a checkbox clicked before the client island
    // attaches its own listeners visually toggles (the native input fires
    // its default behaviour) but never reaches `toggleRow`, so the drawer
    // opens reading zero selected.
    await waitForHydration(page.getByLabel(/Select BR-HS-0502/));
    await page.getByLabel(/Select BR-HS-0502/).check();
    await page.getByLabel(/Select BR-LT-0075/).check();
    await page.getByRole("button", { name: "Bulk actions…" }).click();
    const drawer = page.getByRole("dialog", { name: "Bulk actions" });
    await waitForHydration(drawer);
    await expectNoSeriousAxe(page);

    await drawer.getByLabel(/Target status/).selectOption("DISPOSE");
    await drawer.getByRole("button", { name: "Confirm" }).click();

    // The toast (bulk-drawer.tsx): count, destination, then the skip suffix.
    // "Success: " is toast.tsx's own tone label for "settled" (TONE_LABEL),
    // the same prefix e2e/transfers.spec.ts's own toast assertions include.
    await expect(page.getByText("Success: 1 asset now DISPOSE · 1 skipped", { exact: true })).toBeVisible({ timeout: 10_000 });
    // The drawer stays open on the skipped banner rather than auto-closing.
    await expect(drawer.getByText("1 skipped", { exact: true })).toBeVisible();
    const skippedRow = drawer.getByRole("listitem").filter({ hasText: "BR-LT-0075" });
    await expect(skippedRow).toContainText("closed status DONATED — cannot change");

    const [hs, lt] = await Promise.all([
      db.asset.findUniqueOrThrow({ where: { tag: "BR-HS-0502" } }),
      db.asset.findUniqueOrThrow({ where: { tag: "BR-LT-0075" } }),
    ]);
    expect(hs.status).toBe("DISPOSE");
    expect(lt.status).toBe("DONATED"); // untouched — the skip really skipped
  });

  test("2. register form: a Purchasing-class tag produces no live hint (class-scoped), but the server's own tag uniqueness still refuses it at submit", async ({ page }) => {
    await login(page, IT);
    await page.goto("/inventory/register");
    await page.getByLabel("Category").selectOption({ label: "Laptop" });
    await page.getByLabel("Model").fill("e2e class-scoped check");
    await expect(page.getByLabel("Tag 1")).not.toHaveValue("");
    const tag1 = page.getByLabel("Tag 1");
    // BR-VH-0001 is a real, already-registered tag — but it belongs to the
    // Vehicle category (Purchasing class), not this Laptop (IT) run.
    await tag1.fill("BR-VH-0001");
    await tag1.blur();

    // register-form.tsx:173 debounces the live identifier check
    // (`setTimeout(runIdentifierCheck, 300)`) on blur; `checkIdentifiers` is
    // class-scoped (spec §6.2), so a cross-class match must never surface as
    // "already registered" here. NEGATIVE assertion (absence of a hint), so
    // per e2e/purchasing-ext.spec.ts case 1's precedent the settle is sized
    // to the 300ms debounce plus round-trip headroom, not a weaker wait.
    await page.waitForTimeout(3_000);
    await expect(page.getByText(/Already registered/)).toHaveCount(0);

    // The server's own `tag String @unique` (schema.prisma:372) is global,
    // not class-scoped — submitting anyway is still refused, just with a
    // plain banner rather than a field-level error (registerAssets,
    // src/server/modules/purchases/receiving.ts, catches the P2002 on
    // `tag` with a generic conflict — NOT the field-scoped "That tag is
    // already registered" that a *different* action, createAsset in
    // src/server/modules/inventory/actions.ts:347, returns for the
    // single-asset /inventory/new form. That message does not apply to this
    // page, verified against source).
    await page.getByRole("button", { name: "Register asset" }).click();
    await expect(page.getByText("One of those tags was just taken. Reload and try again.")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("3. a title policy's loan-covered required slot reads \"on loan\", not a policy gap, and the employees list agrees", async ({ page }) => {
    const leo = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0095" } });
    const loanLaptop = await db.asset.findUniqueOrThrow({ where: { tag: "BR-LT-0210" } }); // Leo's TEMPORARY loan
    // R11: created via Prisma, not the admin UI. `assetTypeId` is the exact
    // typeId BR-LT-0210 already carries — every seeded Laptop asset shares
    // ONE typeId regardless of its own model text (prisma/seed.ts's `mk`
    // helper always assigns the category's first AssetType) — so this IS
    // "the Laptop category's first AssetType id" the brief names, read
    // directly off the held asset rather than assumed from AssetType
    // creation/query order.
    const policy = await db.equipmentPolicy.create({
      data: { name: "Contractor kit", appliesToTitle: "Contractor" },
    });
    await db.policySlot.create({
      data: { policyId: policy.id, name: "laptop", assetTypeId: loanLaptop.typeId, required: true },
    });

    await login(page, IT);
    await page.goto(`/employees/${leo.id}`);
    const tile = page.getByRole("button", { name: /^laptop slot, on loan, required$/ });
    await expect(tile).toBeVisible({ timeout: 15_000 });
    await expect(tile.getByText("LOAN", { exact: true })).toBeVisible();
    await expect(tile.getByText("policy gap")).toHaveCount(0);

    // src/app/(app)/employees/page.tsx: `missingRequired === 0` renders
    // "complete" — the per-employee progress line the brief names. Verified
    // against source: the record page itself (loadout-view.tsx,
    // employees/[id]/page.tsx) carries no "missing"/"complete" text at all,
    // so this is where `missingRequired` (computeLoadout, src/lib/loadout.ts)
    // actually surfaces.
    await page.goto("/employees");
    const row = page.getByRole("row", { name: /EMP-0095/ });
    await expect(row).toContainText("complete");
  });

  test("4. the Replace picker's spare options carry \"Same type\" and \"Other spare\" notes", async ({ page }) => {
    // BR-LT-0148 (the brief's own suggestion) carries the seeded APR-2039
    // (CLAIMED) — an OPEN approval — so `canReturn`/`canReplace`
    // (layout.tsx: `!pending`) are both false there and no Replace button
    // renders at all. BR-LT-0201 is a held IT laptop with no open approval.
    const laptop = await db.asset.findUniqueOrThrow({ where: { tag: "BR-LT-0201" } });

    await login(page, IT);
    await page.goto(`/inventory/${laptop.id}`);
    await page.getByRole("button", { name: "Replace" }).click();
    const dialog = page.getByRole("dialog", { name: "Replace BR-LT-0201" });
    await waitForHydration(dialog);

    const combo = dialog.getByRole("combobox", { name: "Replacement" });
    await combo.click();
    // spareOptions (src/server/modules/inventory/queries.ts:386) notes every
    // IT spare "Same type" or "Other spare" against the replaced asset's own
    // type — BR-LT-0181 (Laptop) is the only same-type spare, so it matches
    // uniquely; every non-laptop spare (BR-HS-0502, BR-MN-0911, BR-PH-0301)
    // reads "Other spare", so that query is scoped to one tag to avoid a
    // strict-mode multiple-match error.
    await expect(dialog.getByRole("option", { name: /BR-LT-0181.*Same type/ })).toBeVisible();
    await expect(dialog.getByRole("option", { name: /BR-MN-0911.*Other spare/ })).toBeVisible();

    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
  });

  test("5. a direct return updates the record's Last change line", async ({ page }) => {
    const dock = await db.asset.findUniqueOrThrow({ where: { tag: "BR-DK-0071" } }); // held by EMP-0042

    await login(page, IT);
    await page.goto(`/inventory/${dock.id}`);
    await page.getByRole("button", { name: "Return" }).click();
    const dialog = page.getByRole("dialog", { name: "Return BR-DK-0071" });
    await waitForHydration(dialog);
    // Default outcome is "Back for triage" (TRIAGE -> SPARE), reason optional.
    await dialog.getByRole("button", { name: "Confirm" }).click();
    // "Success: " is toast.tsx's own tone label for "settled" (TONE_LABEL).
    await expect(page.getByText("Success: BR-DK-0071 returned · now SPARE", { exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await expect(dialog).toBeHidden();

    // layout.tsx's "Last change" line (R9): the AUDIT ENTRY'S actorLabel —
    // the seeded IT user's name "J. Sarmiento" — not a role label like
    // "IT Staff". Rendered only once nothing is pending, which holds here.
    const lastChange = page.locator("p", { hasText: "Last change:" });
    await expect(lastChange).toBeVisible({ timeout: 10_000 });
    await expect(lastChange).toContainText(fmtDate(new Date()));
    await expect(lastChange).toContainText("by J. Sarmiento");
    await expectNoSeriousAxe(page);

    const asset = await db.asset.findUniqueOrThrow({ where: { id: dock.id } });
    expect(asset.status).toBe("SPARE");
    expect(asset.assigneeId).toBeNull();
  });

  test("6. repair-stage parity: the SQL CASE (repairStageIds) matches repairStage() over every seeded IT asset, and the chip total matches too", async ({ page }) => {
    const assets = await db.asset.findMany({
      where: { cls: "IT" },
      select: { id: true, tag: true, status: true, vendorId: true, rmaRef: true, repairQuote: true, cost: true, defectiveSince: true },
    });

    // Phase 20 (spec §6.6, plan P-1): the real parity proof — run the exact
    // CASE expression `repairStageIds` executes as `$queryRaw`, over the same
    // candidate predicate ("cls"='IT' AND (status='DEFECTIVE' OR
    // defectiveSince IS NOT NULL)), and assert per asset that the SQL stage
    // equals repairStage() in JS. Correcting an earlier draft's comment:
    // `listAssets` (src/server/modules/inventory/queries.ts) does NOT page
    // this SQL cut — it fetches the repair candidate set and filters in JS
    // via toRow -> stageOf -> repairStage; only `repairStageIds` (reached by
    // the export route and the two bulk actions) ever executes
    // REPAIR_STAGE_CASE_SQL. This block is the one place in the whole
    // battery that reads the raw SQL for every stage, including
    // beyond-repair's arithmetic and centavo rule (BR-LT-0090 in the seed).
    const sqlRows = await db.$queryRaw<Array<{ id: string; stage: string }>>(Prisma.sql`
      SELECT "id", ${Prisma.raw(REPAIR_STAGE_CASE_SQL)} AS stage
      FROM "Asset"
      WHERE "cls" = 'IT'::"AssetClass" AND ("status" = 'DEFECTIVE' OR "defectiveSince" IS NOT NULL)
    `);
    const sqlStageById = new Map(sqlRows.map((r) => [r.id, r.stage]));

    const byStage = new Map<string, number>();
    let candidateCount = 0;
    for (const a of assets) {
      const like: RepairLike = {
        status: a.status,
        vendorId: a.vendorId,
        rmaRef: a.rmaRef,
        repairQuote: a.repairQuote === null ? null : Number(a.repairQuote),
        cost: a.cost === null ? null : Number(a.cost),
        defectiveSince: a.defectiveSince,
      };
      const stage = repairStage(like);
      if (stage) byStage.set(stage, (byStage.get(stage) ?? 0) + 1);

      const isCandidate = a.status === "DEFECTIVE" || a.defectiveSince !== null;
      expect(sqlStageById.has(a.id), `asset ${a.tag} candidate membership`).toBe(isCandidate);
      if (isCandidate) {
        candidateCount += 1;
        expect(sqlStageById.get(a.id), `asset ${a.tag} SQL stage vs repairStage()`).toBe(stage);
      }
    }
    // No row in the raw cut outside what repairStage's own candidate rule expects.
    expect(sqlStageById.size).toBe(candidateCount);

    await login(page, IT);
    for (const stage of REPAIR_STAGES) {
      // A second, screen-facing agreement point: the toolbar's own "N
      // assets" total (aria-live="polite") is `listAssets`' JS-filtered
      // count for this stage. RepairChips itself
      // (src/components/inventory/repair-chips.tsx) renders no numeric
      // badge on the chips — verified against source — so the total-assets
      // label is the real, visible parity point, not a per-chip count. The
      // SQL agreement is already proven above; this only re-confirms the
      // screen matches the same JS rule.
      await page.goto(`/inventory?stage=${stage}`);
      const total = page.getByText(/^\d+ assets?$/);
      await expect(total).toBeVisible({ timeout: 15_000 });
      const text = await total.textContent();
      const shown = Number(text!.match(/\d+/)![0]);
      expect(shown, `stage ${stage}`).toBe(byStage.get(stage) ?? 0);
    }
  });
});
