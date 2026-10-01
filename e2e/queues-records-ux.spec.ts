import { test, expect, type Locator, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient, type ApprovalState, type ApprovalType, type Prisma } from "@prisma/client";
import { SEED_PASSWORD } from "../prisma/fixtures";
import { localDateISO } from "@/lib/format";
import { addDays, dayFromISO } from "@/lib/deadlines";

/**
 * Phase 33 — Laws of UX on the IT queues and records (spec §11), fourteen
 * cases, each independent:
 *   1–6  approvals: a PENDING request's header (one-step Approve, a visible
 *        Reject…, Claim and Escalate in More); Approve in one step writing
 *        claim + approve and offering Next in queue past someone else's claim;
 *        Reject… from the header; a failed execution's plain banner; the queue
 *        row menu's one-step Approve; an admin on someone else's claim (P-2).
 *   7    the queue's search by tag and its Type facet, value-only chips.
 *   8–10 labels: the Tags box (2 labels · 1 skipped, the named other-class
 *        tag) and an axe pass on the bare page; Start at label 5 (four blank
 *        slots); the Purchasing crumb, reached from the Purchasing list's
 *        Print labels and inferred for an admin from the assets' class.
 *   11   /reservations: the hint line, the Active columns, the count line with
 *        a hold expiring tomorrow.
 *   12   /audit: search by tag and by a person's name, the When "Today" pill,
 *        sentences with the action slug in mono.
 *   13   /inventory/activity: search by tag narrows the feed; paging keeps q.
 *   14   approvals: Approve on a request someone else approved after the page
 *        opened — the house conflict copy survives the refresh.
 *
 * Plan P-18: approval fixtures are created fresh per case (never the seeded
 * APR-20xx rows other specs rely on) and closed by state in `finally` — set to
 * REJECTED, never deleted, since audit rows reference them; the EXECUTE_APPROVAL
 * jobs an Approve enqueues are removed (no worker runs here, and a later
 * `worker:once` must not pick them up). Audit rows are only ever added, never
 * deleted; reservations created here carry no audit row and are deleted.
 */

const db = new PrismaClient();

const ADMIN = "admin@thebackroomop.com";
const IT = "it@thebackroomop.com";
const PURCHASING = "purchasing@thebackroomop.com";
const IT_NAME = "J. Sarmiento";
/**
 * IT laptops no seeded approval points at — the fresh approvals' assets. An asset may carry
 * only one open approval (PENDING, CLAIMED or APPROVED: `Approval_one_open_per_asset`), so a
 * case that needs two open at once puts the second on SECOND_TAG.
 */
const FIXTURE_TAG = "BR-LT-0201";
const SECOND_TAG = "BR-LT-0210";
/** A tag prefix both fixtures share (and no seeded open request's asset does). */
const SHARED_PREFIX = "BR-LT-02";

test.beforeAll(async () => {
  execSync("npm run db:seed", { timeout: 120_000 });
});
test.afterAll(async () => {
  await db.$disconnect();
});

// Copied from e2e/it-work-ux.spec.ts — house rule: never import helpers across spec files.
async function login(page: Page, email: string) {
  await page.goto("/logout");
  await page.getByLabel(/Email/).fill(email);
  await page.getByLabel(/Password/).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

// Copied from e2e/it-work-ux.spec.ts.
async function expectNoSeriousAxe(page: Page) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(700);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
}

// Copied from e2e/it-work-ux.spec.ts.
async function waitForHydration(target: Locator) {
  const el = target.first();
  await el.waitFor({ state: "attached", timeout: 20_000 });
  await expect(async () => {
    expect(await el.evaluate((node) => Object.keys(node).some((k) => k.startsWith("__reactFiber$")))).toBe(true);
  }).toPass({ timeout: 20_000 });
}

/** Opens a ⋯ menu (retried until its island has hydrated) and returns the open menu. */
async function openMenu(page: Page, trigger: Locator) {
  const menu = page.getByRole("menu");
  await expect(async () => {
    if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click();
    await expect(menu).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  return menu;
}

const userId = async (email: string) => (await db.user.findUniqueOrThrow({ where: { email } })).id;
const assetId = async (tag: string) => (await db.asset.findUniqueOrThrow({ where: { tag } })).id;

/** A fresh approval (on FIXTURE_TAG unless told otherwise) with a real ref no from the sequence; the caller closes it in `finally`. */
async function freshApproval(over: {
  state?: ApprovalState; type?: ApprovalType; claimedBy?: string; slaInDays?: number; workerError?: string; tag?: string;
} = {}) {
  const [{ nextval }] = await db.$queryRaw<[{ nextval: bigint }]>`SELECT nextval('approval_ref_seq')`;
  const type = over.type ?? "lifecycle_change_status";
  const payload: Prisma.InputJsonValue = type === "lifecycle_return"
    ? { to: { assigneeId: null, status: "SPARE" }, reason: "e2e phase 33" }
    : { from: { status: "DEPLOYED" }, to: { status: "TEMPORARY" }, reason: "e2e phase 33" };
  return db.approval.create({
    data: {
      refNo: `APR-${nextval}`, type, state: over.state ?? "PENDING", priority: "NORMAL",
      slaAt: new Date(Date.now() + (over.slaInDays ?? 1) * 86_400_000),
      requestedById: await userId(IT), assetId: await assetId(over.tag ?? FIXTURE_TAG),
      ...(over.claimedBy ? { claimedById: await userId(over.claimedBy), claimedAt: new Date() } : {}),
      ...(over.workerError ? { workerError: over.workerError } : {}),
      payload,
    },
  });
}

/** P-18: close by state, never delete (audit rows reference them); drop any job an Approve enqueued. */
async function closeApprovals(ids: string[]) {
  for (const id of ids) {
    await db.job.deleteMany({ where: { type: "EXECUTE_APPROVAL", payload: { path: ["approvalId"], equals: id } } });
  }
  await db.approval.updateMany({
    where: { id: { in: ids }, state: { notIn: ["REJECTED", "EXECUTED"] } },
    data: { state: "REJECTED", resolvedAt: new Date(), resolutionReason: "e2e phase 33 cleanup" },
  });
}

test.describe("queues-records-ux — approvals", () => {
  test("1. a PENDING request's header: Approve, a visible Reject…, Claim and Escalate in More", async ({ page }) => {
    test.setTimeout(90_000);
    const a = await freshApproval();
    try {
      await login(page, IT);
      await page.goto(`/approvals/${a.id}`);
      await expect(page.getByRole("heading", { name: a.refNo, level: 1 })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Reject…", exact: true })).toBeVisible();
      // Claim is not a visible button any more — it lives in More.
      await expect(page.getByRole("button", { name: "Claim", exact: true })).toHaveCount(0);
      // A primary is on offer, so the goal-gradient link waits until a decision (P-8).
      await expect(page.getByRole("link", { name: /^Next in queue →/ })).toHaveCount(0);
      const menu = await openMenu(page, page.getByRole("button", { name: "More actions", exact: true }));
      await expect(menu.getByRole("menuitem")).toHaveText(["Claim", "Escalate"]);
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
      await expectNoSeriousAxe(page);
    } finally {
      await closeApprovals([a.id]);
    }
  });

  test("2. Approve in one step: claim + approve audited; Next in queue skips a request someone else claimed", async ({ page }) => {
    test.setTimeout(90_000);
    const created: string[] = [];
    try {
      const a = await freshApproval();
      created.push(a.id);
      // Claimed by admin and the most overdue thing in IT's queue: without the skip it would be "next".
      const othersClaim = await freshApproval({ state: "CLAIMED", claimedBy: ADMIN, slaInDays: -5, tag: SECOND_TAG });
      created.push(othersClaim.id);
      // The expected next: the seeded APR-2040 (PENDING, a day overdue) — the earliest SLA IT may act on.
      const expected = await db.approval.findUniqueOrThrow({ where: { refNo: "APR-2040" } });
      expect(expected.state).toBe("PENDING");
      expect(othersClaim.slaAt.getTime()).toBeLessThan(expected.slaAt.getTime());

      await login(page, IT);
      await page.goto(`/approvals/${a.id}`);
      const approve = page.getByRole("button", { name: "Approve", exact: true });
      await waitForHydration(approve);
      await approve.click();
      await expect(page.getByText(`${a.refNo} approved`)).toBeVisible({ timeout: 15_000 });
      await expect(page.locator("header").getByText("APPROVED", { exact: true })).toBeVisible({ timeout: 15_000 });

      const after = await db.approval.findUniqueOrThrow({ where: { id: a.id } });
      expect(after.state).toBe("APPROVED");
      expect(after.claimedById).toBe(await userId(IT));
      const audit = await db.auditEntry.findMany({
        where: { entityType: "approval", entityId: a.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      expect(audit.map((e) => e.action)).toEqual(["claim", "approve"]);
      expect(audit.every((e) => e.actorLabel === IT_NAME)).toBe(true);

      const next = page.getByRole("link", { name: /^Next in queue →/ });
      await expect(next).toBeVisible();
      await expect(next).toContainText(expected.refNo);
      await expect(next).not.toContainText(othersClaim.refNo);
      await expect(next).toHaveAttribute("href", `/approvals/${expected.id}`);
      await expectNoSeriousAxe(page);
    } finally {
      await closeApprovals(created);
    }
  });

  test("3. Reject… from the header: the dialog names the request, a reason, confirm → rejected", async ({ page }) => {
    test.setTimeout(90_000);
    const a = await freshApproval();
    try {
      await login(page, IT);
      await page.goto(`/approvals/${a.id}`);
      const reject = page.getByRole("button", { name: "Reject…", exact: true });
      await waitForHydration(reject);
      await reject.click();
      const dialog = page.getByRole("dialog", { name: `Reject ${a.refNo}?` });
      await expect(dialog).toBeVisible();
      await expectNoSeriousAxe(page);
      await dialog.getByLabel("Reason").fill("e2e: duplicate request");
      await dialog.getByRole("button", { name: "Reject", exact: true }).click();
      await expect(page.getByText(`${a.refNo} rejected`)).toBeVisible({ timeout: 15_000 });
      await expect(dialog).toHaveCount(0);

      const after = await db.approval.findUniqueOrThrow({ where: { id: a.id } });
      expect(after.state).toBe("REJECTED");
      expect(after.resolutionReason).toBe("e2e: duplicate request");
      // Decided: the header offers nothing more, and the page points at the next request.
      await expect(page.getByRole("button", { name: "Reject…", exact: true })).toHaveCount(0);
      await expect(page.getByRole("link", { name: /^Next in queue →/ })).toBeVisible();
    } finally {
      await closeApprovals([a.id]);
    }
  });

  test("4. a failed execution: a plain banner and its cause; the raw worker error waits behind Worker error", async ({ page }) => {
    test.setTimeout(90_000);
    const raw = "Execution guard: BR-LT-0201 reads DEPLOYED, payload expected SPARE — e2e phase 33";
    const a = await freshApproval({ state: "EXECUTION_FAILED", claimedBy: IT, workerError: raw });
    try {
      await login(page, IT);
      await page.goto(`/approvals/${a.id}`);
      await expect(page.getByText("The change could not be applied.")).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText("The asset's status changed since the request.")).toBeVisible();
      const rawText = page.getByText(raw);
      await expect(rawText).toBeHidden();
      await page.getByText("Worker error", { exact: true }).click();
      await expect(rawText).toBeVisible();
      await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Reject…", exact: true })).toBeVisible();
      await expectNoSeriousAxe(page);
    } finally {
      await closeApprovals([a.id]);
    }
  });

  test("5. the queue row menu: Actions for {refNo} → Approve approves a PENDING row in one step", async ({ page }) => {
    test.setTimeout(90_000);
    const a = await freshApproval();
    try {
      await login(page, IT);
      await page.goto("/approvals");
      const row = page.getByRole("row", { name: new RegExp(a.refNo) });
      await expect(row).toContainText("PENDING", { timeout: 20_000 });
      const menu = await openMenu(page, row.getByRole("button", { name: `Actions for ${a.refNo}` }));
      await expect(menu.getByRole("menuitem")).toHaveText(["Approve", "Reject…", "Claim", "Escalate", "Open"]);
      await expectNoSeriousAxe(page);
      await menu.getByRole("menuitem", { name: "Approve", exact: true }).click();
      await expect(page.getByText(`${a.refNo} approved`)).toBeVisible({ timeout: 15_000 });
      // APPROVED is not an Open-tab state: the row leaves the queue.
      await expect(page.getByRole("row", { name: new RegExp(a.refNo) })).toHaveCount(0, { timeout: 15_000 });

      const after = await db.approval.findUniqueOrThrow({ where: { id: a.id } });
      expect(after.state).toBe("APPROVED");
      const actions = (await db.auditEntry.findMany({
        where: { entityType: "approval", entityId: a.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      })).map((e) => e.action);
      expect(actions).toEqual(["claim", "approve"]);
    } finally {
      await closeApprovals([a.id]);
    }
  });

  test("6. an admin on someone else's claim: Claimed by, no Approve, a visible Reject…, More holds Release and Escalate", async ({ page }) => {
    test.setTimeout(90_000);
    const a = await freshApproval({ state: "CLAIMED", claimedBy: IT });
    try {
      await login(page, ADMIN);
      await page.goto(`/approvals/${a.id}`);
      await expect(page.getByText(`Claimed by ${IT_NAME}`)).toBeVisible({ timeout: 20_000 });
      // P-2: no admin override — approving someone else's claim is not offered anywhere.
      await expect(page.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Reject…", exact: true })).toBeVisible();
      const menu = await openMenu(page, page.getByRole("button", { name: "More actions", exact: true }));
      await expect(menu.getByRole("menuitem")).toHaveText(["Release", "Escalate"]);
      await page.keyboard.press("Escape");
      // No primary on this header, so the page offers the next request (P-8).
      await expect(page.getByRole("link", { name: /^Next in queue →/ })).toBeVisible();
      await expectNoSeriousAxe(page);
    } finally {
      await closeApprovals([a.id]);
    }
  });

  test("7. the queue's search by tag narrows the Open tab and its count; the Type facet narrows further; value-only chips", async ({ page }) => {
    test.setTimeout(120_000);
    const created: string[] = [];
    try {
      const change = await freshApproval();
      created.push(change.id);
      const ret = await freshApproval({ type: "lifecycle_return", tag: SECOND_TAG });
      created.push(ret.id);
      await login(page, IT);
      await page.goto("/approvals");
      const tabs = page.getByRole("navigation", { name: "Queue tabs" });
      const rows = page.locator("tbody tr");
      // Unfiltered: the three seeded open requests plus the two fixtures.
      await expect(rows).toHaveCount(5, { timeout: 20_000 });
      await expect(tabs.getByRole("link", { name: /^Open/ })).toHaveText("Open5");

      const search = page.getByRole("searchbox", { name: "Search approvals" });
      await waitForHydration(search);
      await expect(search).toHaveAttribute("placeholder", /· Enter$/);
      await search.fill(SHARED_PREFIX);
      await search.press("Enter");
      await page.waitForURL(new RegExp(`q=${SHARED_PREFIX}`));
      await expect(rows).toHaveCount(2);
      await expect(page.getByRole("row", { name: new RegExp(change.refNo) })).toBeVisible();
      await expect(page.getByRole("row", { name: new RegExp(ret.refNo) })).toBeVisible();
      await expect(tabs.getByRole("link", { name: /^Open/ })).toHaveText("Open2");
      await expect(page.getByRole("link", { name: `Search: ${SHARED_PREFIX} — remove filter` })).toBeVisible();

      const type = page.getByRole("button", { name: "Type", exact: true });
      await waitForHydration(type);
      await type.click();
      const facet = page.getByRole("dialog", { name: "Filter by Type" });
      await facet.getByLabel("Return").check();
      await facet.getByRole("button", { name: "Apply" }).click();
      await page.waitForURL(/type=lifecycle_return/);
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText(ret.refNo);
      // Value-only: the chip is the friendly kind, not "Type: Return".
      await expect(page.getByRole("link", { name: /^Return\s+—\s+remove filter$/ })).toBeVisible();
      await expectNoSeriousAxe(page);

      // Clear × drops the search and keeps the Type pick: every open return (the seeded APR-2040 too).
      await page.getByRole("button", { name: "Clear search" }).click();
      await page.waitForURL((u) => !u.search.includes("q=") && u.search.includes("type=lifecycle_return"));
      await expect(rows).toHaveCount(2);
      await expect(page.getByRole("row", { name: /APR-2040/ })).toBeVisible();
      await page.getByRole("link", { name: "Clear filters" }).click();
      await page.waitForURL((u) => u.pathname === "/approvals" && u.search === "");
      await expect(rows).toHaveCount(5);
    } finally {
      await closeApprovals(created);
    }
  });

  test("14. Approve after someone else approved it: the conflict copy survives the refresh and the page shows APPROVED", async ({ page }) => {
    test.setTimeout(90_000);
    const created: string[] = [];
    try {
      const a = await freshApproval();
      created.push(a.id);
      await login(page, IT);
      await page.goto(`/approvals/${a.id}`);
      const approve = page.getByRole("button", { name: "Approve", exact: true });
      await waitForHydration(approve);

      // Admin decides it while IT's page is still open (claim then approve, as approveNow would).
      await db.approval.update({
        where: { id: a.id },
        data: { state: "APPROVED", claimedById: await userId(ADMIN), claimedAt: new Date() },
      });

      await approve.click();
      await expect(page.getByText("Someone else changed this item first — the page now shows the latest state.", { exact: true }))
        .toBeVisible({ timeout: 15_000 });
      // The refresh landed: the header reads the new state and offers no verbs…
      await expect(page.locator("header").getByText("APPROVED", { exact: true })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Reject…", exact: true })).toHaveCount(0);
      // …and the notice is still there after it.
      await expect(page.getByText("Someone else changed this item first — the page now shows the latest state.", { exact: true })).toBeVisible();
      await expect(page.getByText(`${a.refNo} approved`)).toHaveCount(0);

      // Nothing of IT's was written: still admin's decision, no audit row and no job from IT.
      const after = await db.approval.findUniqueOrThrow({ where: { id: a.id } });
      expect(after.state).toBe("APPROVED");
      expect(after.claimedById).toBe(await userId(ADMIN));
      expect(await db.auditEntry.count({ where: { entityType: "approval", entityId: a.id } })).toBe(0);
      expect(await db.job.count({ where: { type: "EXECUTE_APPROVAL", payload: { path: ["approvalId"], equals: a.id } } })).toBe(0);
      await expectNoSeriousAxe(page);
    } finally {
      await closeApprovals(created);
    }
  });
});

test.describe("queues-records-ux — labels", () => {
  test("8. the Tags box: two IT tags print, the Purchasing one is named as skipped; the bare page passes axe", async ({ page }) => {
    test.setTimeout(90_000);
    await login(page, IT);
    await page.goto("/inventory/labels");
    await expect(page.getByText("Nothing to print")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByLabel("Tags", { exact: true })).toBeVisible();
    await expectNoSeriousAxe(page);

    await page.getByLabel("Tags", { exact: true }).fill("BR-LT-0148, BR-LT-0201\nBR-VH-0001");
    await page.getByRole("button", { name: "Make sheet" }).click();
    await page.waitForURL(/tags=/);
    await expect(page.getByText("2 labels · 1 skipped", { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("BR-VH-0001 — not found or not your class", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Barcode BR-LT-0148")).toHaveCount(1);
    await expect(page.getByLabel("Barcode BR-LT-0201")).toHaveCount(1);
    await expect(page.getByLabel("Barcode BR-VH-0001")).toHaveCount(0);
    await expectNoSeriousAxe(page);
  });

  test("9. Start at label 5 leaves four blank slots on page 1", async ({ page }) => {
    test.setTimeout(90_000);
    await login(page, IT);
    await page.goto("/inventory/labels?tags=BR-LT-0148");
    await expect(page.getByText("1 label · 0 skipped", { exact: true })).toBeVisible({ timeout: 20_000 });
    const sheet = page.locator(".label-page").first();
    await expect(sheet.locator("[data-blank-label]")).toHaveCount(0);

    await page.getByLabel("Start at label").fill("5");
    await page.getByRole("button", { name: "Make sheet" }).click();
    await page.waitForURL(/start=5/);
    await expect(page.locator(".label-page")).toHaveCount(1);
    await expect(sheet.locator("[data-blank-label]")).toHaveCount(4);
    // The four blanks come first; the label lands in slot 5.
    await expect(sheet.locator(":scope > div").nth(4).getByLabel("Barcode BR-LT-0148")).toHaveCount(1);
    await expect(page.getByLabel("Start at label")).toHaveValue("5");
    await expectNoSeriousAxe(page);
  });

  test("10. Purchasing's labels page: the crumb and Back name Purchasing assets — from a real link, and inferred", async ({ page }) => {
    test.setTimeout(90_000);
    await login(page, PURCHASING);
    await page.goto("/inventory/labels?cls=PURCHASING");
    const crumb = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(crumb.getByRole("link", { name: "Purchasing assets", exact: true })).toHaveAttribute("href", "/inventory?cls=PURCHASING", { timeout: 20_000 });
    await expect(crumb.getByText("Print labels", { exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("link", { name: "Back to Purchasing assets" })).toHaveAttribute("href", "/inventory?cls=PURCHASING");
    await expectNoSeriousAxe(page);

    // From a real entry point: the Purchasing list's selection bar carries the class.
    await page.goto("/inventory?cls=PURCHASING");
    const row = page.getByRole("row", { name: /BR-VH-0001/ });
    const box = row.getByRole("checkbox", { name: "Select BR-VH-0001" });
    await waitForHydration(box);
    await box.check();
    const vh = await assetId("BR-VH-0001");
    const print = page.getByRole("link", { name: "Print labels", exact: true });
    await expect(print).toHaveAttribute("href", `/inventory/labels?ids=${vh}&cls=PURCHASING`);
    await print.click();
    await page.waitForURL(/\/inventory\/labels\?ids=.*cls=PURCHASING/);
    await expect(crumb.getByRole("link", { name: "Purchasing assets", exact: true })).toHaveAttribute("href", "/inventory?cls=PURCHASING", { timeout: 20_000 });
    await expect(page.getByLabel("Barcode BR-VH-0001")).toHaveCount(1);

    // No ?cls= at all: an admin (who manages both classes) gets the class of the assets it resolved.
    await login(page, ADMIN);
    await page.goto(`/inventory/labels?ids=${vh}`);
    await expect(crumb.getByRole("link", { name: "Purchasing assets", exact: true })).toHaveAttribute("href", "/inventory?cls=PURCHASING", { timeout: 20_000 });
    await page.goto(`/inventory/labels?ids=${await assetId("BR-LT-0148")}`);
    await expect(crumb.getByRole("link", { name: "Inventory", exact: true })).toHaveAttribute("href", "/inventory", { timeout: 20_000 });
  });
});

test.describe("queues-records-ux — reservations", () => {
  test("11. /reservations: the hint line, the Active columns, and a hold expiring tomorrow in the count line", async ({ page }) => {
    test.setTimeout(90_000);
    const phone = await db.asset.findUniqueOrThrow({ where: { tag: "BR-PH-0301" } });
    const paolo = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0071" } });
    const hold = await db.reservation.create({
      data: {
        assetId: phone.id, employeeId: paolo.id, state: "ACTIVE", reason: "e2e phase 33 — expiring soon",
        expiresAt: dayFromISO(addDays(localDateISO(new Date()), 1)),
      },
    });
    try {
      await login(page, IT);
      await page.goto("/reservations?state=ACTIVE");
      await expect(page.getByText("Held spares still read SPARE · place holds from a record or a profile")).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole("columnheader", { name: "Expires" })).toBeVisible();
      await expect(page.getByRole("columnheader", { name: "Reads" })).toHaveCount(0);
      // The seeded +7 d hold and this one (tomorrow): two live, one within two days.
      await expect(page.getByText(/^2 holds · 1 expires within 2 days$/)).toBeVisible();
      const soon = page.getByRole("link", { name: "1 expires within 2 days" });
      // Soonest first is the Active tab's default sort, so the link needs no sort parameter.
      await expect(soon).toHaveAttribute("href", "/reservations?state=ACTIVE");
      await expectNoSeriousAxe(page);
    } finally {
      await db.reservation.deleteMany({ where: { id: hold.id } });
    }
  });
});

test.describe("queues-records-ux — audit and feeds", () => {
  test("12. /audit: search by a tag and by a person's name; Today narrows; sentences with the action in mono", async ({ page }) => {
    test.setTimeout(120_000);
    const laptop = await assetId("BR-LT-0148");
    const nina = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0097" } });
    // Added, never deleted: an older row on the laptop (so Today has something to drop) and a row about Nina.
    await db.auditEntry.create({
      data: {
        actorLabel: "e2e phase 33 (older)", entityType: "asset", entityId: laptop, action: "update",
        diff: { notes: { from: null, to: "older note" } }, createdAt: new Date(Date.now() - 3 * 86_400_000),
      },
    });
    await db.auditEntry.create({
      data: {
        actorLabel: "e2e phase 33", entityType: "employee", entityId: nina.id, action: "update",
        diff: { title: { from: "Analyst", to: "Senior Analyst" } },
      },
    });
    const rows = page.locator("tbody tr");
    const entries = page.getByText(/^\d+ entr(y|ies)$/);

    await login(page, IT);
    await page.goto("/audit");
    const search = page.getByRole("searchbox", { name: "Search audit log" });
    await waitForHydration(search);
    await search.fill("BR-LT-0148");
    await search.press("Enter");
    await page.waitForURL(/q=BR-LT-0148/);
    const tagTotal = await db.auditEntry.count({ where: { entityId: laptop } });
    expect(tagTotal).toBeGreaterThanOrEqual(4);
    await expect(entries).toHaveText(`${tagTotal} entries`);
    await expect(rows).toHaveCount(tagTotal);
    for (const row of await rows.all()) await expect(row.getByRole("link", { name: "BR-LT-0148" })).toBeVisible();
    // A sentence, and the raw slug beside it in mono.
    const seeded = page.getByRole("row", { name: new RegExp(`${IT_NAME.replace(".", "\\.")} updated`) });
    await expect(seeded).toHaveCount(1);
    const slug = seeded.locator("td").nth(3);
    await expect(slug).toHaveText("update");
    await expect(slug).toHaveClass(/font-mono/);
    await expect(page.getByRole("row", { name: /e2e phase 33 \(older\)/ })).toHaveCount(1);
    await expectNoSeriousAxe(page);

    // Today: the older row goes, the chip reads the value only.
    const when = page.getByRole("group", { name: "When" });
    await when.getByRole("link", { name: "Today", exact: true }).click();
    await page.waitForURL(/when=today/);
    await expect(when.getByRole("link", { name: "Today", exact: true })).toHaveAttribute("aria-current", "true");
    await expect(entries).toHaveText(`${tagTotal - 1} entries`);
    await expect(page.getByRole("row", { name: /e2e phase 33 \(older\)/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^Today\s+—\s+remove filter$/ })).toBeVisible();

    // A person's name: the row about Nina Robles (found through the Entity column), and nothing else.
    await page.goto("/audit?q=Nina%20Robles");
    await expect(rows).toHaveCount(1, { timeout: 20_000 });
    await expect(rows.first().getByRole("link", { name: nina.name })).toBeVisible();
    await expect(rows.first()).toContainText("e2e phase 33 updated");

    // An actor's name: every row is theirs.
    await page.goto(`/audit?q=${encodeURIComponent(IT_NAME)}`);
    await expect(rows.first()).toBeVisible({ timeout: 20_000 });
    for (const row of await rows.all()) await expect(row.locator("td").nth(2)).toHaveText(new RegExp(`^${IT_NAME.replace(".", "\\.")} `));
    await expectNoSeriousAxe(page);
  });

  test("13. /inventory/activity: search by a tag narrows the feed; paging keeps q", async ({ page }) => {
    test.setTimeout(120_000);
    const laptop = await assetId(FIXTURE_TAG);
    // Added, never deleted: enough rows on one asset for a second page (50 a page).
    await db.auditEntry.createMany({
      data: Array.from({ length: 55 }, (_, i) => ({
        actorLabel: "e2e phase 33", entityType: "asset", entityId: laptop, action: "update",
        diff: { notes: { from: null, to: `paging note ${i + 1}` } },
      })),
    });
    const total = await db.auditEntry.count({ where: { entityType: "asset", entityId: laptop } });
    // The unfiltered feed as IT sees it: every asset row except Purchasing's (hidden from IT).
    const purchasingIds = (await db.asset.findMany({ where: { cls: "PURCHASING" }, select: { id: true } })).map((r) => r.id);
    const allAssetRows = await db.auditEntry.count({ where: { entityType: "asset", entityId: { notIn: purchasingIds } } });
    expect(total).toBeGreaterThan(50);
    expect(total).toBeLessThanOrEqual(100);
    expect(allAssetRows).toBeGreaterThan(total);

    await login(page, IT);
    await page.goto("/inventory/activity");
    const entries = page.getByText(/^\d+ entr(y|ies)$/);
    await expect(entries).toHaveText(`${allAssetRows} entries`, { timeout: 20_000 });
    const search = page.getByRole("searchbox", { name: "Search activity" });
    await waitForHydration(search);
    await search.fill(FIXTURE_TAG);
    await search.press("Enter");
    await page.waitForURL(new RegExp(`q=${FIXTURE_TAG}`));
    await expect(entries).toHaveText(`${total} entries`);
    await expect(page.getByText("page 1 of 2", { exact: true })).toBeVisible();
    const feed = page.locator("ol").filter({ has: page.locator("li span.truncate") });
    await expect(feed.locator("li")).toHaveCount(50);
    await expect(feed.getByRole("link", { name: FIXTURE_TAG })).toHaveCount(50);
    await expectNoSeriousAxe(page);

    const nextPage = page.getByRole("navigation", { name: "Pagination" }).getByRole("link", { name: "Next page" });
    await expect(nextPage).toHaveAttribute("href", new RegExp(`q=${FIXTURE_TAG}.*page=2`));
    await nextPage.click();
    await page.waitForURL((u) => u.searchParams.get("page") === "2" && u.searchParams.get("q") === FIXTURE_TAG);
    await expect(page.getByText("page 2 of 2", { exact: true })).toBeVisible();
    await expect(feed.locator("li")).toHaveCount(total - 50);
    await expect(feed.getByRole("link", { name: FIXTURE_TAG })).toHaveCount(total - 50);
    await expect(page.getByRole("searchbox", { name: "Search activity" })).toHaveValue(FIXTURE_TAG);
  });
});
