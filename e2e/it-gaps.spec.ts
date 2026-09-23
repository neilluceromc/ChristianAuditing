import { test, expect, type Locator, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { Prisma, PrismaClient } from "@prisma/client";
import { SEED_PASSWORD } from "../prisma/fixtures";
import { REPAIR_STAGES, REPAIR_STAGE_CASE_SQL, repairStage, type RepairLike } from "@/lib/repairs";
import { ENTITY_PAGE_SIZE } from "@/lib/paging";
import { RETENTION_DAYS, RETENTION_NOTE } from "@/lib/retention";
import { fmtDate } from "@/lib/format";

/**
 * Phase 20, Task 8 — the six closed IT gaps from spec §6; Phase 24 (spec §4–5)
 * rewrote case 4 and added cases 7–9, so nine in all. Every case is independent
 * (own fixtures, no serial dependency, and each restores what it changed) so a
 * failure in one never cascades into the next:
 *   1 (§6.1) bulk status skipped list names each tag and why.
 *   2 (§6.2) the register form's live identifier check is class-scoped.
 *   3 (§6.3) a loan-covered required slot reads "on loan", not a policy gap.
 *   4 (P24 §4.1) the Replace picker groups spares under "Same type" and
 *     "Other spares" headings, with no per-row note left behind; since
 *     Phase 30 it also says how many spares it leaves out.
 *   5 (§6.5) a direct return updates the record's "Last change" line.
 *   6 (§6.6) the repair-stage cut (`repairStage`) matches the DB one row at a time.
 *   7 (P24 §4.1) with no same-type spare in reach, only "Other spares" renders.
 *   8 (P24 §5.1) the repairs view pages that same SQL cut: the toolbar total is
 *     the cut size, a page holds at most ENTITY_PAGE_SIZE rows, in
 *     defectiveSince order, and page 2 reads off the same cut.
 *   9 (P24 §4.2) `npm run worker:prune` removes only finished deliveries and
 *     jobs older than RETENTION_DAYS, and the deliveries page states the rule.
 *
 * Seeded fixtures this file depends on (prisma/seed.ts), verified against
 * source rather than assumed from the brief:
 *   BR-HS-0502 (Headset, SPARE), BR-LT-0075 (Laptop, DONATED — closed
 *   family), BR-LT-0181 (Laptop, SPARE, same type as every other seeded
 *   Laptop — `mk()` always uses the category's first AssetType regardless of
 *   model text), BR-MN-0911 (Monitor, SPARE). BR-LT-0148 carries the seeded
 *   APR-2039 (CLAIMED) — an OPEN approval — so its record offers no Replace
 *   or Return at all (`recordActions`: a pending approval suppresses every
 *   lifecycle action); case 7 uses BR-LT-0201 (MacBook Air M3, DEPLOYED, held
 *   by EMP-0099 Carlo Dizon) instead, which carries no open approval, and
 *   case 4 uses BR-MN-0902 (Monitor, DEPLOYED, held by EMP-0042). BR-DK-0071
 *   (Dock, DEPLOYED, held by EMP-0042) carries none either. EMP-0095 Leo Tan,
 *   title "Contractor", Operations (no department policy), holds BR-LT-0210
 *   as a TEMPORARY loan. BR-VH-0001 is the seeded Vehicle (Purchasing class)
 *   tag. `it@thebackroomop.com` is seeded as User.name "J. Sarmiento"
 *   (prisma/seed.ts:38) — the same string both the "Last change" line's
 *   `AuditEntry.actorLabel` (R9) and, in the sibling offboarding-v2.spec.ts,
 *   the offboarding Decision's `claimedBy.name` resolve to for this user.
 *
 * Phase 24 fixture facts, likewise read off the seeded database rather than
 * assumed:
 *   The seed's assignable IT spares are BR-LT-0181 (Laptop), BR-MN-0910 and
 *   BR-MN-0911 (Monitors), BR-PH-0301 (Phone) and BR-HS-0502 (Headset).
 *   `spareOptions` offers three of the five: BR-MN-0910 carries an ACTIVE
 *   reservation and, since Phase 30 (spec §4.3), BR-LT-0181 is queued by the
 *   seeded APR-2041 — both are left out and counted in the dialog's
 *   "2 more spares are held or queued for someone else" line.
 *   Phase 30 made BR-LT-0201 useless for the "Same type" heading (its one
 *   same-type spare, BR-LT-0181, is the queued one), so case 4 replaces
 *   BR-MN-0902 instead, whose one free same-type spare is BR-MN-0911. Case 7
 *   keeps BR-LT-0201 and still stamps `returnedAt` on BR-LT-0181 (plan P-3 —
 *   `spareOptions` filters `returnedAt: null`), restoring it in a `finally`:
 *   a returned spare is neither offered nor counted, so its line reads "1 more
 *   spare is held or queued". Case 1 moves BR-HS-0502 to DISPOSE (and, since
 *   Phase 27 M-11, back in a `finally`), so cases 4 and 7 assert on heading
 *   ORDER and on named rows, never on the whole option list. The counted line
 *   is immune to that round trip: BR-HS-0502 is never held or queued, so it
 *   leaves the pool and the offered rows together.
 *   The seeded repair cut is small: its four stages hold 2/3/1/1 IT assets,
 *   well under one page, so case 8's `?page=2` exercises `pageOf`'s clamp
 *   inside `pagedSnapshot` (it asserts a real second page the moment a cut
 *   outgrows ENTITY_PAGE_SIZE).
 *   Every seeded WebhookDelivery is fresh (2 DELIVERED, 1 RETRYING, 2 DEAD)
 *   and the only seeded Job is PENDING, so in case 9 the 91-day-old DELIVERED
 *   delivery and DONE job it creates are the only rows the prune may take —
 *   which is what lets that case assert exact before/after counts.
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

const IT = "it@thebackroomop.com";
// The seeded admin, as e2e/admin.spec.ts spells it — /admin/webhooks/deliveries
// is `requireRole("admin")`, so case 9's page check cannot run as IT.
const ADMIN = "admin@thebackroomop.com";

test.describe("it gaps", () => {
  test("1. bulk status change on two IT tags, one in a closed status, lists the skip in the drawer and the toast", async ({ page }) => {
    // Phase 27 (M-11): the original status is captured BEFORE anything moves,
    // the case-7 way, so the `finally` can put BR-HS-0502 back instead of
    // leaving it at DISPOSE for the rest of the file and the next run.
    const hsBefore = await db.asset.findUniqueOrThrow({ where: { tag: "BR-HS-0502" } });
    try {
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
    } finally {
      // The bulk change's audit row stays (R3, append-only); the status goes back.
      await db.asset.update({ where: { id: hsBefore.id }, data: { status: hsBefore.status } });
    }
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
    // Phase 27 fix wave (M-4): both fixtures are created INSIDE the try, so a
    // throw from the slot create still leaves the policy to the `finally` —
    // with migration 26's EquipmentPolicy_name_lower_key a leaked "Contractor
    // kit" would fail every later run of this case until a reseed.
    let policy: { id: string } | null = null;

    try {
      policy = await db.equipmentPolicy.create({
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
    } finally {
      // Phase 27 (M-11): the policy and its slot were this case's own fixtures,
      // so they leave with it. Slot before policy — PolicySlot.policyId is an FK.
      if (policy) {
        await db.policySlot.deleteMany({ where: { policyId: policy.id } });
        await db.equipmentPolicy.delete({ where: { id: policy.id } });
      }
    }
  });

  test("4. the Replace picker groups spares under \"Same type\" and \"Other spares\" headings", async ({ page }) => {
    // BR-LT-0148 (the brief's own suggestion) carries the seeded APR-2039
    // (CLAIMED) — an OPEN approval — so its record offers no Replace at all.
    // Ruling R5 (Phase 30): BR-LT-0201's only same-type spare, BR-LT-0181, is
    // queued by APR-2041 and so no longer offered; BR-MN-0902 is a held IT
    // monitor with no open approval whose same-type spare BR-MN-0911 is free.
    const monitor = await db.asset.findUniqueOrThrow({ where: { tag: "BR-MN-0902" }, include: { assignee: true } });

    await login(page, IT);
    await page.goto(`/inventory/${monitor.id}`);
    // Phase 30: a held device's primary is Return — Replace sits in More.
    await (await openMore(page)).getByRole("menuitem", { name: "Replace…", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: `Replace BR-MN-0902 · Dell P2422H for ${monitor.assignee!.name}` });
    await waitForHydration(dialog);

    // Phase 30 (spec §4.3): the two spares left out — BR-MN-0910 (held for
    // Nina Robles) and BR-LT-0181 (queued by APR-2041) — are counted, not hidden.
    await expect(dialog.getByText("2 more spares are held or queued for someone else", { exact: true })).toBeVisible();

    const combo = dialog.getByRole("combobox", { name: "Replacement" });
    await combo.click();
    // Phase 24 (spec §4.1): `spareOptions` now hands every IT spare a `group`
    // ("Same type" / "Other spares") against the replaced asset's own type and
    // EntityCombobox renders a `role="presentation"` heading row whenever that
    // group changes (headingBefore). The listbox carries no `recent` prop here
    // (replace-control.tsx), so the Recent block is empty and these two are the
    // only headings. Asserted on DOM text, not on what the eye reads: the
    // heading's own class uppercases it in CSS only.
    const list = dialog.getByRole("listbox");
    const headings = list.locator('li[role="presentation"]');
    await expect(headings).toHaveText(["Same type", "Other spares"]);

    // DOM order, which is the whole point of a heading: heading, BR-MN-0911
    // (the only offered same-type spare), heading, then the rest by tag.
    const texts = await list.locator("li").allTextContents();
    const sameAt = texts.indexOf("Same type");
    const otherAt = texts.indexOf("Other spares");
    const mn0911 = texts.findIndex((t) => t.startsWith("BR-MN-0911"));
    const ph0301 = texts.findIndex((t) => t.startsWith("BR-PH-0301"));
    expect(sameAt).toBeGreaterThanOrEqual(0);
    expect(sameAt).toBeLessThan(mn0911);
    expect(mn0911).toBeLessThan(otherAt);
    expect(otherAt).toBeLessThan(ph0301);
    // Neither spare the line counts is offered.
    await expect(dialog.getByRole("option", { name: /BR-MN-0910|BR-LT-0181/ })).toHaveCount(0);

    // The per-row note that carried this before the headings is gone (spec
    // decision 4) — the grouping is said once per block, never once per row.
    await expect(dialog.getByRole("option", { name: /Same type|Other spare/ })).toHaveCount(0);

    // R3 (final review I-2): options under a grouped heading describe themselves by it, so
    // aria-activedescendant users still hear the group; the heading row itself is presentation-only.
    const firstOption = dialog.getByRole("option").first();
    const describedBy = await firstOption.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    await expect(dialog.locator(`[id="${describedBy}"]`)).toHaveText("Same type");

    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
  });

  test("5. a direct return updates the record's Last change line", async ({ page }) => {
    const dock = await db.asset.findUniqueOrThrow({ where: { tag: "BR-DK-0071" } }); // held by EMP-0042

    await login(page, IT);
    await page.goto(`/inventory/${dock.id}`);
    await page.getByRole("button", { name: "Return", exact: true }).click();
    const holder = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0042" } });
    const dialog = page.getByRole("dialog", { name: `Return BR-DK-0071 · WD19S Dock from ${holder.name}?` });
    await waitForHydration(dialog);
    // Default outcome is "Back for triage" (TRIAGE -> SPARE), reason optional.
    await dialog.getByRole("button", { name: "Return", exact: true }).click();
    // "Success: " is toast.tsx's own tone label for "settled" (TONE_LABEL).
    await expect(page.getByText("Success: BR-DK-0071 returned · now SPARE", { exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await expect(dialog).toBeHidden();

    // layout.tsx's "Last change" line (R9): the AUDIT ENTRY'S actorLabel —
    // the seeded IT user's name "J. Sarmiento" — not a role label like
    // "IT Staff". Rendered only once nothing is pending, which holds here.
    // Phase 30 (spec §4.4): `{verb phrase} · {date} · {actor}` — the phrase
    // (auditPhrase) repeats neither the tag nor the actor.
    const lastChange = page.locator("p", { hasText: "Last change:" });
    await expect(lastChange).toBeVisible({ timeout: 10_000 });
    await expect(lastChange).toHaveText(`Last change: returned for triage · ${fmtDate(new Date())} · J. Sarmiento`);
    await expectNoSeriousAxe(page);

    const asset = await db.asset.findUniqueOrThrow({ where: { id: dock.id } });
    expect(asset.status).toBe("SPARE");
    expect(asset.assigneeId).toBeNull();
  });

  test("6. repair-stage parity: the SQL CASE (repairStageIds) matches repairStage() over every seeded IT asset, and the chip total matches too", async ({ page }) => {
    const assets = await db.asset.findMany({
      where: { cls: "IT" },
      select: { id: true, tag: true, status: true, vendorId: true, rmaRef: true, repairQuote: true, cost: true, defectiveSince: true, repairEndedAt: true },
    });

    // Phase 20 (spec §6.6, plan P-1): the real parity proof — run the exact
    // CASE expression `repairStageIds` executes as `$queryRaw`, over the same
    // candidate predicate ("cls"='IT' AND (status='DEFECTIVE' OR
    // defectiveSince IS NOT NULL)), and assert per asset that the SQL stage
    // equals repairStage() in JS. Since Phase 24 (spec §5.1) `listAssets`
    // (src/server/modules/inventory/queries.ts) pages this very SQL id set
    // through `pagedSnapshot` instead of filtering the candidate rows in JS,
    // so the screen and the actions now read one cut — but `repairStageIds`
    // remains the ONE executor of REPAIR_STAGE_CASE_SQL (listAssets, the
    // export route and the two bulk actions all reach the SQL through it).
    // Case 8 is where the paging of that cut is asserted; this block is the
    // one place in the whole battery that reads the raw SQL for every stage,
    // including beyond-repair's arithmetic and centavo rule (BR-LT-0090 in
    // the seed).
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
        repairEndedAt: a.repairEndedAt,
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
      // assets" total (aria-live="polite") is the count of `listAssets`' cut
      // for this stage — since Phase 24 the SQL id set itself, counted in
      // `pagedSnapshot`. RepairChips itself
      // (src/components/inventory/repair-chips.tsx) renders no numeric
      // badge on the chips — verified against source — so the total-assets
      // label is the real, visible parity point, not a per-chip count. The
      // SQL agreement is already proven above; this only re-confirms the
      // screen shows the same number repairStage() derives in JS.
      await page.goto(`/inventory?stage=${stage}`);
      const total = page.getByText(/^\d+ assets?$/);
      await expect(total).toBeVisible({ timeout: 15_000 });
      const text = await total.textContent();
      const shown = Number(text!.match(/\d+/)![0]);
      expect(shown, `stage ${stage}`).toBe(byStage.get(stage) ?? 0);
    }
  });

  test("7. with no same-type spare the Replace picker shows only the \"Other spares\" heading", async ({ page }) => {
    // Plan P-3: the seed's ONLY same-type spare for BR-LT-0201 is BR-LT-0181,
    // so making that one row ineligible is the whole experiment. `returnedAt`
    // is the reversible lever — `spareOptions` filters `returnedAt: null`
    // (a returned-untriaged spare is not offerable yet) — and it changes no
    // status, so the `finally` puts the seed back exactly as it was for the
    // cases after this one, and for a second run of the whole file.
    // (Since Phase 30 BR-LT-0181's queue by APR-2041 already keeps it out of
    // the picker; the lever still decides whether the hidden line counts it.)
    const spare = await db.asset.findUniqueOrThrow({ where: { tag: "BR-LT-0181" } });
    await db.asset.update({ where: { id: spare.id }, data: { returnedAt: new Date() } });
    try {
      const laptop = await db.asset.findUniqueOrThrow({ where: { tag: "BR-LT-0201" } });
      await login(page, IT);
      await page.goto(`/inventory/${laptop.id}`);
      await (await openMore(page)).getByRole("menuitem", { name: "Replace…", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Replace BR-LT-0201 · MacBook Air M3 for Carlo Dizon" });
      await waitForHydration(dialog);

      // A returned, untriaged spare is neither offered nor counted: only
      // BR-MN-0910's hold is left for the line to name.
      await expect(dialog.getByText("1 more spare is held or queued for someone else", { exact: true })).toBeVisible();

      await dialog.getByRole("combobox", { name: "Replacement" }).click();
      // One heading, not an empty "Same type" block above it: headingBefore
      // only emits a heading for a group that actually has a row.
      await expect(dialog.getByRole("listbox").locator('li[role="presentation"]')).toHaveText(["Other spares"]);
      await expect(dialog.getByRole("option", { name: /BR-LT-0181/ })).toHaveCount(0);

      // R3 (final review I-2): the one grouped heading here describes every option under it.
      const describedBy = await dialog.getByRole("option").first().getAttribute("aria-describedby");
      await expect(dialog.locator(`[id="${describedBy}"]`)).toHaveText("Other spares");

      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(dialog).toBeHidden();
    } finally {
      await db.asset.update({ where: { id: spare.id }, data: { returnedAt: null } });
    }
  });

  test("8. the repairs view pages the SQL cut: the total is the cut size, a page holds at most ENTITY_PAGE_SIZE rows, in defectiveSince order", async ({ page }) => {
    // The same raw cut case 6 proves correct, reused here as the ORACLE for
    // what the screen owes: Phase 24 (spec §5.1) made `listAssets` page that
    // id set through `pagedSnapshot`'s count/skip/take, so the toolbar total
    // is the size of the cut and the table holds one page of it — where the
    // pre-Phase-24 list loaded every candidate row and sliced in memory.
    const sqlRows = await db.$queryRaw<Array<{ id: string; stage: string }>>(Prisma.sql`
      SELECT "id", ${Prisma.raw(REPAIR_STAGE_CASE_SQL)} AS stage
      FROM "Asset"
      WHERE "cls" = 'IT'::"AssetClass" AND ("status" = 'DEFECTIVE' OR "defectiveSince" IS NOT NULL)
    `);
    const idsByStage = new Map<string, string[]>();
    for (const r of sqlRows) idsByStage.set(r.stage, [...(idsByStage.get(r.stage) ?? []), r.id]);

    await login(page, IT);
    for (const stage of REPAIR_STAGES) {
      const ids = idsByStage.get(stage) ?? [];
      if (ids.length === 0) continue;
      // `[{ defectiveSince: "asc" }, { id: "asc" }]` is exactly what
      // buildAssetOrderBy(sort=defectiveSince) hands Prisma (its id tiebreak
      // is appended to every sort), so the expected order is produced by the
      // same rule the page uses — including PostgreSQL's NULLS LAST on an
      // ascending column, which a hand-written expectation would get wrong.
      const expected = (
        await db.asset.findMany({
          where: { id: { in: ids } },
          orderBy: [{ defectiveSince: "asc" }, { id: "asc" }],
          select: { tag: true },
        })
      ).map((a) => a.tag);

      await page.goto(`/inventory?stage=${stage}&sort=defectiveSince`);
      const total = page.getByText(/^\d+ assets?$/);
      await expect(total).toBeVisible({ timeout: 15_000 });
      expect(Number((await total.textContent())!.match(/\d+/)![0]), `stage ${stage} total`).toBe(ids.length);

      await expect(page.locator("tbody tr"), `stage ${stage} rows on page 1`).toHaveCount(
        Math.min(ids.length, ENTITY_PAGE_SIZE),
      );
      // The tag cell is the only link inside a row (inventory-table.tsx:
      // model, category, assignee, status… are plain text), so this reads the
      // first column without depending on the checkbox / status-dot offsets.
      const tagCells = page.locator('tbody tr td a[href^="/inventory/"]');
      expect(await tagCells.allTextContents(), `stage ${stage} order on page 1`).toEqual(
        expected.slice(0, ENTITY_PAGE_SIZE),
      );

      // Page 2 of the same cut. Every seeded stage cut is far smaller than a
      // page (3 rows at most), so today `?page=2` is out of range and the
      // clamp `pageOf` applies INSIDE pagedSnapshot's snapshot — on the SQL
      // cut's own count — lands back on page 1 with the total unchanged. The
      // first branch is the real second page the moment a cut outgrows a page.
      await page.goto(`/inventory?stage=${stage}&sort=defectiveSince&page=2`);
      await expect(total).toBeVisible({ timeout: 15_000 });
      expect(Number((await total.textContent())!.match(/\d+/)![0]), `stage ${stage} total on page 2`).toBe(ids.length);
      expect(await tagCells.allTextContents(), `stage ${stage} page 2`).toEqual(
        ids.length > ENTITY_PAGE_SIZE
          ? expected.slice(ENTITY_PAGE_SIZE, 2 * ENTITY_PAGE_SIZE)
          : expected.slice(0, ENTITY_PAGE_SIZE),
      );
    }
  });

  test("9. retention: worker:prune removes finished deliveries and jobs older than 90 days and nothing else; the deliveries page states the rule", async ({ page }) => {
    const endpoint = await db.webhookEndpoint.findFirstOrThrow({ where: { active: true } });
    const old = new Date(Date.now() - (RETENTION_DAYS + 1) * 86_400_000);
    // Counted here, not off the seed: cases 1 and 5 above may have enqueued
    // work of their own, and all of it is fresh, so it must survive the prune.
    const before = { deliveries: await db.webhookDelivery.count(), jobs: await db.job.count() };
    // Plan P-5: an EXECUTE_APPROVAL job, never DELIVER_WEBHOOK — the latter
    // carries the `Job_deliver_payload_shape` check and the one-live-job-per-
    // delivery index, neither of which is what retention is about. Prisma
    // keeps an explicitly supplied `@updatedAt` value on create, which is what
    // makes the 91-day-old job possible at all (jobs prune by updatedAt, P-4).
    const oldD = await db.webhookDelivery.create({
      data: { endpointId: endpoint.id, event: "approval.executed", payload: { e2e: "old" }, status: "DELIVERED", attempts: 1, deliveredAt: old, createdAt: old },
    });
    const freshD = await db.webhookDelivery.create({
      data: { endpointId: endpoint.id, event: "approval.executed", payload: { e2e: "fresh" }, status: "DELIVERED", attempts: 1, deliveredAt: new Date() },
    });
    const oldJ = await db.job.create({
      data: { type: "EXECUTE_APPROVAL", payload: { approvalId: "e2e-old" }, status: "DONE", attempts: 1, createdAt: old, updatedAt: old },
    });
    const freshJ = await db.job.create({
      data: { type: "EXECUTE_APPROVAL", payload: { approvalId: "e2e-fresh" }, status: "DONE", attempts: 1 },
    });
    try {
      // The npm script the operator runs, not pruneRetention() imported here:
      // this case owes the whole path — tsx entry, relative worker imports,
      // its own PrismaClient against this worktree's database — not just the
      // function's logic (which src/lib/retention.test.ts already unit-tests).
      // M-7 (final review): capture the one-shot's stdout and pin the operator-facing
      // line spec §5.4 prescribes verbatim — exit code 0 alone said nothing about it.
      const out = execSync("npm run worker:prune", { timeout: 120_000, encoding: "utf8" });
      expect(out).toMatch(/\[prune\] removed 1 deliveries and 1 jobs older than 90 days/);

      expect(await db.webhookDelivery.findUnique({ where: { id: oldD.id } })).toBeNull();
      expect(await db.job.findUnique({ where: { id: oldJ.id } })).toBeNull();
      expect(await db.webhookDelivery.findUnique({ where: { id: freshD.id } })).not.toBeNull();
      expect(await db.job.findUnique({ where: { id: freshJ.id } })).not.toBeNull();
      // "and nothing else": every pre-existing row (fresh DELIVERED, RETRYING
      // and DEAD deliveries; the PENDING job) plus the one fresh fixture each.
      expect(await db.webhookDelivery.count()).toBe(before.deliveries + 1);
      expect(await db.job.count()).toBe(before.jobs + 1);

      // The rule is also stated where the attempts are read. RETENTION_NOTE is
      // imported, never retyped, so this cannot drift from RETENTION_DAYS.
      await login(page, ADMIN);
      await page.goto("/admin/webhooks/deliveries");
      await expect(page.getByText(RETENTION_NOTE, { exact: true })).toBeVisible();
      await expectNoSeriousAxe(page);
    } finally {
      await db.webhookDelivery.deleteMany({ where: { id: { in: [oldD.id, freshD.id] } } });
      await db.job.deleteMany({ where: { id: { in: [oldJ.id, freshJ.id] } } });
    }
  });
});
