import { test, expect, type Locator, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { SEED_PASSWORD } from "../prisma/fixtures";

/**
 * Phase 40 (spec §6, Work and approvals):
 *   1. requests waiting for IT's review (SUBMITTED) are a "Purchase reviews" group on the worklist, whose heading opens
 *      /purchases?state=SUBMITTED, and the IT nav's "Purchase reviews" item (a view under Approvals since Phase 42)
 *      carries their count;
 *   2. each approval check says "Passed" or "Failed" in words beside its dot;
 *   3. the A key in the queue runs the row's primary action, so a PENDING row approves in one step.
 *
 * Seed facts: PR-0198 is the seed's one SUBMITTED request ("27-inch monitors" + "USB-C docks"); APR-2041 is PENDING
 * (assign BR-LT-0181 to Nina Robles). Case 2 files its own change-status request whose recorded from-status no longer
 * matches the asset, so one check passes and one fails, and removes it afterwards.
 */

const db = new PrismaClient();
const IT = "it@thebackroomop.com";
const CHECK_REF = "APR-9402";

test.beforeAll(() => {
  execSync("npm run db:seed", { timeout: 120_000 });
});
test.afterAll(async () => {
  await db.approval.deleteMany({ where: { refNo: CHECK_REF } });
  await db.$disconnect();
});

// Copied from e2e/phase-40.spec.ts — house rule: never import helpers across spec files.
async function login(page: Page, email: string) {
  await page.goto("/logout");
  await page.getByRole("link", { name: /^Log in/ }).click();
  await page.locator('[data-login-ready="true"]').waitFor();
  await page.getByLabel("Work email", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Password", { exact: true }).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  // Phase 47 (spec §5.4): the first page after a sign-in rewrites the settings cookies from the person's saved prefs
  // (UiPrefsSync → restoreUiPrefs, stamping br.uid) and refreshes; wait for it, so the next step never races that refresh.
  const { id } = await db.user.findUniqueOrThrow({ where: { email: email.toLowerCase() }, select: { id: true } });
  await expect
    .poll(async () => (await page.context().cookies()).find((c) => c.name === "br.uid")?.value, { timeout: 30_000 })
    .toBe(id);
}
async function waitForHydration(target: Locator) {
  const el = target.first();
  await el.waitFor({ state: "attached", timeout: 20_000 });
  await expect(async () => {
    expect(await el.evaluate((node) => Object.keys(node).some((k) => k.startsWith("__reactFiber$")))).toBe(true);
  }).toPass({ timeout: 20_000 });
}

test.describe.serial("phase 40 — work and approvals", () => {
  test("1. a SUBMITTED request is a Purchase review on the worklist; the group opens the list; the nav item counts them", async ({ page }) => {
    test.setTimeout(90_000);
    const pr = await db.purchaseRequest.findUniqueOrThrow({ where: { refNo: "PR-0198" } });
    expect(pr.state).toBe("SUBMITTED");
    const waiting = await db.purchaseRequest.count({ where: { state: "SUBMITTED" } });

    await login(page, IT);
    await page.goto("/inventory/work");
    const group = page.locator("section#purchases");
    await expect(group.getByRole("heading", { name: /^Purchase reviews/ })).toBeVisible({ timeout: 20_000 });
    const row = group.locator("ol > li").filter({ hasText: "PR-0198" });
    await expect(row).toContainText("PR-0198 · 27-inch monitors +1 more");
    await expect(row).toContainText("from ");
    await expect(row.getByRole("link", { name: "Review", exact: true })).toHaveAttribute("href", `/purchases/${pr.id}`);

    // The group's heading is the link to the whole list.
    const open = group.getByRole("link", { name: "Purchase reviews", exact: true });
    await expect(open).toHaveAttribute("href", "/purchases?state=SUBMITTED");
    await open.click();
    await expect(page).toHaveURL(/\/purchases\?state=SUBMITTED$/, { timeout: 20_000 });
    await expect(page.getByRole("navigation", { name: "Request states" }).getByRole("link", { name: /Awaiting IT/ }))
      .toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("link", { name: "PR-0198" }).first()).toBeVisible();
    // Only SUBMITTED requests: the seed's draft (PR-0201) and its IT_REVIEWED one (PR-0195) are filtered out.
    await expect(page.getByRole("link", { name: "PR-0201" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "PR-0195" })).toHaveCount(0);

    // The nav item's badge: every request waiting for IT, the same count the list's Awaiting IT tab shows.
    // Phase 42 (spec §3.1, §4.2): Purchase reviews is a view under Approvals, rendered only while Approvals is the
    // current link — so it is here (the view is the current page) and on /approvals.
    const navItem = page.getByRole("navigation", { name: "Workspace" }).first().locator('a[href="/purchases?state=SUBMITTED"]');
    await expect(navItem).toHaveAttribute("aria-current", "page");
    await page.goto("/approvals");
    const badge = navItem.locator('[aria-label$="waiting for IT"]');
    await expect(badge).toHaveText(String(waiting));
    await expect(badge).toHaveAttribute("aria-label", `${waiting} waiting for IT`);

    // The worklist carries the same group. (Phase 46: Home's worklist sections became the Overview's Needs you; the
    // full worklist is where the group's heading link lives.)
    await page.goto("/inventory/work");
    await expect(page.locator("section#purchases").getByRole("link", { name: "Purchase reviews", exact: true }))
      .toHaveAttribute("href", "/purchases?state=SUBMITTED");
  });

  test("2. each approval check says Passed or Failed in words, not only by its dot", async ({ page }) => {
    const it = await db.user.findUniqueOrThrow({ where: { email: IT } });
    // An idle IT spare with no open request, so this request is the asset's one open approval.
    const asset = await db.asset.findFirstOrThrow({
      where: { cls: "IT", status: "SPARE", returnedAt: null, approvals: { none: { state: { in: ["PENDING", "CLAIMED", "APPROVED"] } } } },
      orderBy: { tag: "asc" },
    });
    // The request recorded DEFECTIVE as the from-status, but the asset reads SPARE: "Status unchanged since
    // request" fails while "Asset exists" and "Target status" pass.
    const approval = await db.approval.create({
      data: {
        refNo: CHECK_REF, type: "lifecycle_change_status", state: "PENDING", slaAt: new Date(Date.now() + 86_400_000),
        requestedById: it.id, assetId: asset.id,
        payload: { from: { status: "DEFECTIVE" }, to: { status: "DISPOSE" }, reason: "e2e phase 40 checks" },
      },
    });
    try {
      await login(page, IT);
      await page.goto(`/approvals/${approval.id}`);
      await expect(page.getByRole("heading", { name: CHECK_REF })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText("What the system checked", { exact: true })).toBeVisible();
      // One check = the innermost element holding both its label and its verdict.
      const line = (label: string) =>
        page.locator("div").filter({ has: page.getByText(label, { exact: true }) }).filter({ hasText: /Passed|Failed/ }).last();
      await expect(line("Asset exists")).toContainText("Passed");
      await expect(line("Status unchanged since request")).toContainText("Failed");
      await expect(line("Status unchanged since request")).toContainText("request expected Defective, reads Spare");
      await expect(line("Target status")).toContainText("Passed");
      await expect(line("Target status")).toContainText("Dispose");
      await expect(page.getByText("Passed", { exact: true })).toHaveCount(2);
      await expect(page.getByText("Failed", { exact: true })).toHaveCount(1);
      // Words, never the internal code: "Change status request", not lifecycle.change-status.
      await expect(page.getByText(/Change status request · requested by/)).toBeVisible();
      await expect(page.getByText(/lifecycle\./)).toHaveCount(0);
    } finally {
      await db.approval.deleteMany({ where: { refNo: CHECK_REF } });
    }
  });

  test("3. the A key on a PENDING row approves it — no Claim it first; Ctrl+A never does", async ({ page }) => {
    test.setTimeout(90_000);
    const it = await db.user.findUniqueOrThrow({ where: { email: IT } });
    const before = await db.approval.findUniqueOrThrow({ where: { refNo: "APR-2041" } });
    expect(before.state).toBe("PENDING");

    try {
      await login(page, IT);
      await page.goto("/approvals?q=APR-2041");
      const queue = page.getByRole("group", { name: /Approval queue/ });
      await expect(queue.getByRole("row", { name: /APR-2041/ })).toBeVisible({ timeout: 20_000 });
      // The queue's change cell reads in words too.
      await expect(queue.getByRole("row", { name: /APR-2041/ })).toContainText("Assign · BR-LT-0181");
      await waitForHydration(queue);
      await queue.focus();

      // Fix round 1: Ctrl+A is the browser's select-all, never "approve" — the request stays PENDING.
      await queue.press("Control+a");
      await page.waitForTimeout(1_000);
      await expect(page.getByText("APR-2041 approved")).toHaveCount(0);
      expect((await db.approval.findUniqueOrThrow({ where: { refNo: "APR-2041" } })).state).toBe("PENDING");

      await queue.focus();
      await queue.press("a");
      await expect(page.getByText("APR-2041 approved")).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(/Claim it first/)).toHaveCount(0);
      await expect(async () => {
        const after = await db.approval.findUniqueOrThrow({ where: { refNo: "APR-2041" } });
        expect(after.state).not.toBe("PENDING");
        expect(after.claimedById).toBe(it.id);
      }).toPass({ timeout: 15_000 });
    } finally {
      // House style (queues-records-ux closeApprovals): drop the job an approve enqueued and put the request back
      // by state; the claim/approve audit rows stay (append-only, R3).
      await db.job.deleteMany({ where: { type: "EXECUTE_APPROVAL", payload: { path: ["approvalId"], equals: before.id } } });
      await db.approval.update({
        where: { id: before.id },
        data: { state: "PENDING", claimedById: null, claimedAt: null, resolvedAt: null, resolutionReason: null },
      });
    }
  });
});
