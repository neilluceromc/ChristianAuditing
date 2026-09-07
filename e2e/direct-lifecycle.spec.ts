import { test, expect, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { SEED_PASSWORD } from "../prisma/fixtures";

/**
 * Phase 15 — direct IT lifecycle. Ten cases per spec §8.2: a status change, an
 * assignment, a return, a replacement, a bulk change and a deploy-at-creation
 * all apply the moment IT confirms them (no approval queue); an offboarding
 * decision on an IT asset applies the same way; Home's Worklist replaces
 * "Your shift"; and the boundaries hold — Purchasing keeps its queue, and a
 * legacy open approval still blocks a direct action with its refNo.
 *
 * Cases 1–6 and 9–10 share one asset each and never touch BR-LT-0148 or
 * BR-LT-0181 (both carry a seeded open approval — case 10 uses BR-LT-0148's
 * seeded APR-2039 on purpose). Cases 1–6 run serial: case 3 returns
 * BR-LT-0210 to the spare pool and case 4 spends it as the replacement, so
 * later cases depend on earlier ones.
 *
 * Never reference a raw cuid — the DB reseeds and cuids change every run.
 * Assets are referenced by tag, employees by employeeNo, approvals by refNo.
 */

const db = new PrismaClient();

test.beforeAll(() => {
  execSync("npm run db:seed", { timeout: 120_000 });
});
test.afterAll(async () => {
  await db.$disconnect();
});

// Copied from e2e/asset-classes.spec.ts — the helper that actually works
// against the real login form.
async function login(page: Page, email: string) {
  await page.goto("/logout");
  await page.getByLabel(/Email/).fill(email);
  await page.getByLabel(/Password/).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

const idOf = async (tag: string) => (await db.asset.findUniqueOrThrow({ where: { tag }, select: { id: true } })).id;

/** Highest number in use under a prefix — never hardcode a literal; an earlier test may have registered more. */
async function highestNumber(prefix: string): Promise<number> {
  const rows = await db.asset.findMany({ where: { tag: { startsWith: `BR-${prefix}-` } }, select: { tag: true } });
  return rows.reduce((max, r) => Math.max(max, Number(r.tag.slice(6))), 0);
}
const tagOf = (prefix: string, n: number) => `BR-${prefix}-${String(n).padStart(4, "0")}`;

const IT = "it@thebackroomop.com";
const P = "purchasing@thebackroomop.com";

const OPEN_STATES = ["PENDING", "CLAIMED", "APPROVED"] as const;

test.describe.serial("direct changes", () => {
  test("1. Change status applies on confirm and is audited under IT's name", async ({ page }) => {
    const id = await idOf("BR-MN-0910"); // SPARE
    await login(page, IT);
    await page.goto(`/inventory/${id}`);
    await page.getByRole("button", { name: "Change status" }).click();
    await page.getByLabel("New status").selectOption("DEFECTIVE");
    await page.getByRole("dialog", { name: "Change status" }).getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText("BR-MN-0910 is now DEFECTIVE")).toBeVisible();
    expect((await db.asset.findUniqueOrThrow({ where: { id } })).status).toBe("DEFECTIVE");
    expect(await db.approval.count({ where: { assetId: id, state: { in: [...OPEN_STATES] } } })).toBe(0);
    const rec = await db.approval.findFirstOrThrow({ where: { assetId: id, type: "lifecycle_change_status" } });
    expect(rec.state).toBe("EXECUTED");
    const audit = await db.auditEntry.findFirst({
      where: { entityId: id, action: "lifecycle.change-status" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit?.actorLabel).toBe("J. Sarmiento");
  });

  test("2. Assign from the record; the employee's tile shows it without a PENDING pill", async ({ page }) => {
    const id = await idOf("BR-PH-0301"); // SPARE phone
    const nina = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0097" } }); // Nina Robles
    await login(page, IT);
    await page.goto(`/inventory/${id}`);
    await page.getByRole("button", { name: "Assign" }).click();
    const dialog = page.getByRole("dialog", { name: "Assign BR-PH-0301" });
    await dialog.getByRole("combobox").fill("EMP-0097");
    await dialog.getByRole("option", { name: /EMP-0097/ }).click();
    await dialog.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText("BR-PH-0301 assigned to Nina Robles")).toBeVisible();

    const asset = await db.asset.findUniqueOrThrow({ where: { id } });
    expect(asset.status).toBe("DEPLOYED");
    expect(asset.assigneeId).toBe(nina.id);
    expect(await db.approval.count({ where: { assetId: id, state: { in: [...OPEN_STATES] } } })).toBe(0);
    const rec = await db.approval.findFirstOrThrow({ where: { assetId: id, type: "lifecycle_assign" } });
    expect(rec.state).toBe("EXECUTED");

    // Nina is Finance, whose one policy (Finance standard) carries a required
    // "phone" slot of BR-PH-0301's own type — the direct assign lands
    // straight in that tile, not just "somewhere on her holdings".
    await page.goto(`/employees/${nina.id}`);
    const tile = page.getByRole("button", { name: /phone slot/ });
    await expect(tile).toContainText("BR-PH-0301");
    await expect(tile.getByText("PENDING")).toHaveCount(0);
  });

  test("3. Return for triage → BACK · NOT CHECKED, out of the picker; triage keep-as-spare clears it and it reappears", async ({ page }) => {
    const id = await idOf("BR-LT-0210"); // TEMPORARY, on loan to Leo Tan (EMP-0095)
    const spareWhere = { cls: "IT" as const, status: "SPARE" as const, returnedAt: null, reservations: { none: { state: "ACTIVE" as const } } };

    await login(page, IT);
    await page.goto(`/inventory/${id}`);
    await page.getByRole("button", { name: "Return" }).click();
    const dialog = page.getByRole("dialog", { name: "Return BR-LT-0210" });
    await expect(dialog.getByLabel("What happens to it")).toHaveValue("TRIAGE"); // default: Back for triage
    await dialog.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText("BR-LT-0210 returned · now SPARE")).toBeVisible();

    let asset = await db.asset.findUniqueOrThrow({ where: { id } });
    expect(asset.status).toBe("SPARE");
    expect(asset.assigneeId).toBeNull();
    expect(asset.returnedAt).not.toBeNull();
    await expect(page.getByText("BACK · NOT CHECKED")).toBeVisible();

    // absent from the spare picker while unchecked — spareOptions' own where clause
    let spareIds = (await db.asset.findMany({ where: spareWhere, select: { id: true } })).map((a) => a.id);
    expect(spareIds).not.toContain(id);

    await page.getByRole("button", { name: "Triage" }).click();
    const triageDialog = page.getByRole("dialog", { name: "Triage BR-LT-0210" });
    await expect(triageDialog.getByLabel("Decision")).toHaveValue("SPARE"); // default: Keep as spare
    await triageDialog.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText("BR-LT-0210 triaged · Keep as spare")).toBeVisible();

    asset = await db.asset.findUniqueOrThrow({ where: { id } });
    expect(asset.status).toBe("SPARE");
    expect(asset.returnedAt).toBeNull();
    await expect(page.getByText("BACK · NOT CHECKED")).toHaveCount(0);
    // Keep-as-spare only flips the flag — nothing about the lifecycle changed,
    // so no new approval row records it.
    expect(await db.approval.count({ where: { assetId: id, state: { in: [...OPEN_STATES] } } })).toBe(0);

    spareIds = (await db.asset.findMany({ where: spareWhere, select: { id: true } })).map((a) => a.id);
    expect(spareIds).toContain(id);
  });

  test("4. Replace: the old device goes back for triage, the new one is DEPLOYED, both Histories cross-reference", async ({ page }) => {
    const oldId = await idOf("BR-LT-0201"); // Carlo Dizon, DEPLOYED
    const newId = await idOf("BR-LT-0210"); // freed as a spare by case 3
    const carlo = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0099" } });

    await login(page, IT);
    await page.goto(`/inventory/${oldId}`);
    await page.getByRole("button", { name: "Replace" }).click();
    const dialog = page.getByRole("dialog", { name: "Replace BR-LT-0201" });
    // Scoped by name: the dialog also carries a plain <select> ("What happens
    // to BR-LT-0201") that is not a combobox by role name but IS matched by a
    // bare getByRole("combobox") once labelled — "Replacement" disambiguates.
    await dialog.getByRole("combobox", { name: "Replacement" }).fill("BR-LT-0210");
    await dialog.getByRole("option", { name: /BR-LT-0210/ }).click();
    await dialog.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText("BR-LT-0201 replaced by BR-LT-0210 for Carlo Dizon")).toBeVisible();

    const [oldAsset, newAsset] = await Promise.all([
      db.asset.findUniqueOrThrow({ where: { id: oldId } }),
      db.asset.findUniqueOrThrow({ where: { id: newId } }),
    ]);
    expect(oldAsset.status).toBe("SPARE");
    expect(oldAsset.assigneeId).toBeNull();
    expect(oldAsset.returnedAt).not.toBeNull(); // back for triage
    expect(newAsset.status).toBe("DEPLOYED");
    expect(newAsset.assigneeId).toBe(carlo.id);

    await page.goto(`/inventory/${oldId}/history`);
    await expect(page.getByRole("row", { name: /replacedBy/ })).toContainText("BR-LT-0210");
    await page.goto(`/inventory/${newId}/history`);
    await expect(page.getByRole("row", { name: /replaces/ })).toContainText("BR-LT-0201");
  });

  test("5. Bulk change status applies at once", async ({ page }) => {
    const [hsId, mnId] = await Promise.all([idOf("BR-HS-0502"), idOf("BR-MN-0911")]); // both SPARE

    await login(page, IT);
    await page.goto("/inventory?status=SPARE");
    await page.getByLabel(/Select BR-HS-0502/).check();
    await page.getByLabel(/Select BR-MN-0911/).check();
    await page.getByRole("button", { name: "Bulk actions…" }).click();
    await page.getByLabel(/Target status/).selectOption("DISPOSE");
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText("2 assets now DISPOSE")).toBeVisible();

    const [hs, mn] = await Promise.all([
      db.asset.findUniqueOrThrow({ where: { id: hsId } }),
      db.asset.findUniqueOrThrow({ where: { id: mnId } }),
    ]);
    expect(hs.status).toBe("DISPOSE");
    expect(mn.status).toBe("DISPOSE");
    expect(await db.approval.count({ where: { assetId: { in: [hsId, mnId] }, state: { in: [...OPEN_STATES] } } })).toBe(0);
  });

  test("6. Deploy at creation lands DEPLOYED with a holder and no pending approval", async ({ page }) => {
    const tag = tagOf("LT", (await highestNumber("LT")) + 1);
    const paolo = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0071" } }); // Paolo Santos, IT Support

    await login(page, IT);
    await page.goto("/inventory/new");
    await page.getByLabel(/Asset tag/).fill(tag);
    await page.getByLabel(/Model/).fill("ThinkPad X1 (e2e deploy)");
    await page.getByLabel("Category").selectOption({ label: "Laptop" });
    const initialStatus = page.getByRole("radiogroup", { name: "Initial status" });
    await initialStatus.getByText("DEPLOYED").click();
    // Phase 15 copy: direct registration never mentions an approval.
    await expect(page.getByText("Deployed to the chosen person at registration — recorded in the audit trail.")).toBeVisible();
    await page.getByLabel("Assign to").fill("EMP-0071");
    await page.getByRole("option", { name: /EMP-0071/ }).click();
    await page.getByRole("button", { name: "Register asset" }).click();
    await expect(page.getByRole("heading", { name: tag })).toBeVisible({ timeout: 20_000 });

    const asset = await db.asset.findUniqueOrThrow({ where: { tag } });
    expect(asset.status).toBe("DEPLOYED");
    expect(asset.assigneeId).toBe(paolo.id);
    expect(await db.approval.count({ where: { assetId: asset.id, state: { in: [...OPEN_STATES] } } })).toBe(0);
    const rec = await db.approval.findFirstOrThrow({ where: { assetId: asset.id, type: "lifecycle_assign" } });
    expect(rec.state).toBe("EXECUTED");
  });
});

test.describe.serial("offboarding", () => {
  test("7. three decisions apply immediately; Continue unblocks; the leaver's laptop is in Triage; the report lists all three", async ({ page }) => {
    const dennis = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0090" } });

    await login(page, IT);
    await page.goto(`/offboarding/${dennis.id}?step=collect`);

    const decide = async (tag: string, outcome: string, reason: string) => {
      const card = page.getByRole("group", { name: `Decide ${tag}` });
      await card.getByRole("radiogroup", { name: new RegExp(`Outcome for ${tag}`) }).getByText(outcome).click();
      if (reason) await card.getByLabel(/Reason/).fill(reason);
      await card.getByRole("button", { name: "Confirm decision" }).click();
      await expect(page.getByText(new RegExp(`${tag} → `))).toBeVisible();
    };

    // "Returned" for the laptop is the one that lands it back for triage
    // (spec §4.1: an IT return landing on the default status is unchecked).
    await decide("BR-LT-0166", "Returned", "");
    await decide("BR-PH-0312", "Missing", "never handed back — investigation open");
    await decide("BR-HS-0510", "Defective", "speaker crackling");

    // Two identical "Continue to Accounts & M365" links render at once (a
    // mobile/desktop action-bar duplicate) — .first() disambiguates without
    // weakening the assertion, matching offboarding.spec.ts's own fix.
    await expect(page.getByRole("link", { name: /Continue to Accounts/ }).first()).toBeVisible();
    await expect(page.getByRole("list", { name: "Offboarding steps" }).getByRole("link")).toHaveCount(4);

    // All three decisions write to the DB, not just the one that lands in
    // Triage — the sibling test in offboarding.spec.ts ("each decision…")
    // checks all three rows; carry that in here too.
    const [laptop, phone, headset] = await Promise.all([
      db.asset.findUniqueOrThrow({ where: { tag: "BR-LT-0166" } }),
      db.asset.findUniqueOrThrow({ where: { tag: "BR-PH-0312" } }),
      db.asset.findUniqueOrThrow({ where: { tag: "BR-HS-0510" } }),
    ]);
    expect(laptop.status).toBe("SPARE");
    expect(laptop.assigneeId).toBeNull();
    expect(laptop.returnedAt).not.toBeNull(); // "Returned" lands on the default status, back for triage
    expect(phone.status).toBe("MISSING");
    expect(phone.assigneeId).toBeNull();
    expect(headset.status).toBe("DEFECTIVE");
    expect(headset.assigneeId).toBeNull();
    for (const a of [laptop, phone, headset]) {
      const approval = await db.approval.findFirstOrThrow({ where: { assetId: a.id, type: "lifecycle_return" } });
      expect(approval.state).toBe("EXECUTED");
    }

    await page.goto(`/inventory/${laptop.id}`);
    await expect(page.getByText("BACK · NOT CHECKED")).toBeVisible();

    await page.goto(`/offboarding/${dennis.id}/report`);
    await expect(page.getByText("Offboarding farewell report")).toBeVisible();
    for (const tag of ["BR-LT-0166", "BR-PH-0312", "BR-HS-0510"]) {
      await expect(page.getByText(tag)).toBeVisible();
    }
  });
});

test.describe("worklist", () => {
  test("8. Home sections and /inventory/work; clearing a row hides it", async ({ page }) => {
    await login(page, IT);

    // Worklist.tsx renders each section as `<h3>{title} <span>{total}</span></h3>`
    // (src/components/home/worklist.tsx); the Triage section's total is every
    // IT asset back for triage (src/server/modules/home/queries.ts's `triage`
    // query: `{ cls: "IT", returnedAt: { not: null } }`), uncapped by either
    // page's row limit. Computed once, before either page load below, since
    // nothing in this test changes a `returnedAt` before both checks run.
    const expectedTriage = await db.asset.count({ where: { cls: "IT", returnedAt: { not: null } } });
    const triageHeadingText = new RegExp(`^Triage\\s+${expectedTriage}$`);

    await page.goto("/");

    const worklistCard = page.locator("main > div > *").filter({
      has: page.getByRole("heading", { name: "Worklist", level: 2 }),
    });
    // Sections with real rows by this point in the file: case 4's replace
    // sent BR-LT-0201 back for triage (BR-LT-0210 is the one that came OUT
    // of triage, DEPLOYED to Carlo — it does not reappear here), and the
    // seed's own Karen Uy/Nina Robles are still short a required slot.
    // "Awaiting IT check" never has a row anywhere in this suite — every
    // seed IT asset (and case 6's own registration) is born checked — so
    // its heading is never asserted here.
    for (const heading of ["Triage", "Repairs to chase", "New hires"]) {
      await expect(worklistCard.getByRole("heading", { name: heading })).toBeVisible();
    }
    await expect(worklistCard.getByRole("heading", { name: /^Triage/ })).toHaveText(triageHeadingText);
    await expect(worklistCard).toContainText("BR-LT-0201");

    await page.goto("/inventory/work");
    await expect(page.getByRole("heading", { name: "Worklist", level: 1 })).toBeVisible();
    for (const heading of ["Triage", "Repairs to chase", "New hires", "Loans", "Missing & records", "Approvals & leavers"]) {
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    }
    await expect(page.getByRole("heading", { name: /^Triage/ })).toHaveText(triageHeadingText);
    // BR-MN-0910 (case 1's fresh repair, 0 days down) sorts last among the
    // section's 8 real DEFECTIVE rows and never makes Home's own 2-row cap —
    // the uncapped Worklist page is where it has to show up.
    await expect(page.getByText("BR-MN-0910")).toBeVisible();

    const row = page.locator("li").filter({ hasText: "BR-MN-0910" });
    await expect(row).toHaveCount(1);
    await row.getByRole("button", { name: /^Clear "/ }).click();
    await expect(page.locator("li").filter({ hasText: "BR-MN-0910" })).toHaveCount(0, { timeout: 15_000 });
  });
});

test.describe("boundaries", () => {
  test("9. A Purchasing car still goes through the queue and IT's direct controls are absent", async ({ page }) => {
    const id = await idOf("BR-VH-0002"); // STORED, unassigned
    await login(page, P);
    await page.goto(`/inventory/${id}`);

    await expect(page.getByRole("button", { name: "Request status change" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Change status" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Assign holder" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Assign", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Replace" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Triage" })).toHaveCount(0);

    await page.getByRole("button", { name: "Request status change" }).click();
    await page.getByLabel("New status").selectOption("OPERATIONAL");
    await page.getByLabel("Reason").fill("e2e — boundary check");
    await page.getByRole("dialog", { name: "Request a status change" })
      .getByRole("button", { name: "Request", exact: true }).click();
    await expect(page.getByText(/created — waiting in the approval queue/)).toBeVisible();

    const approval = await db.approval.findFirstOrThrow({ where: { assetId: id, type: "lifecycle_change_status" } });
    expect(approval.state).toBe("PENDING");
    expect((await db.asset.findUniqueOrThrow({ where: { id } })).status).toBe("STORED");
  });

  test("10. A legacy open approval blocks direct actions with its refNo", async ({ page }) => {
    // BR-LT-0148 carries the seed's own APR-2039 (CLAIMED, an open state) —
    // no fixture to manufacture, and this asset is deliberately untouched by
    // every earlier case in this file for exactly this reason.
    const id = await idOf("BR-LT-0148");
    await login(page, IT);
    await page.goto(`/inventory/${id}`);
    await page.getByRole("button", { name: "Change status" }).click();
    await page.getByLabel("New status").selectOption("SPARE");
    await page.getByRole("dialog", { name: "Change status" }).getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText("BR-LT-0148 is held by APR-2039 — resolve it in Approvals first.")).toBeVisible();

    expect((await db.asset.findUniqueOrThrow({ where: { id } })).status).toBe("DEPLOYED");
  });
});
