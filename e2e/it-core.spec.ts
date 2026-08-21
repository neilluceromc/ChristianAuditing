import { test, expect, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { readSheet } from "read-excel-file/node";

async function login(page: Page, email: string) {
  // /logout clears the session cookie and redirects to /login (see
  // src/app/logout/route.ts) — going there directly, rather than /login,
  // keeps this helper safe to call a second time mid-test to switch users
  // (e.g. it_staff → viewer on the same record). Visiting /login while
  // already authenticated just bounces back to the role's landing page
  // (middleware.ts) and the Email field never appears.
  await page.goto("/logout");
  await page.getByLabel(/Email/).fill(email);
  await page.getByLabel(/Password/).fill("ChangeMe123!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

async function expectNoSeriousAxe(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
}

// Spec files share one database and run in alphabetical order — each file
// reseeds so no file inherits another's mutations (approvals-audit deploys
// BR-LT-0181 and drains the badge, which broke auth-shell/it-core).
test.beforeAll(() => {
  execSync("npm run db:seed", { timeout: 120_000 });
});

test.describe("inventory list", () => {
  test("axe passes", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/inventory");
    await expectNoSeriousAxe(page);
  });

  test("sort clicks rewrite the URL contract", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/inventory");
    await page.getByRole("button", { name: "Model" }).click();
    await expect(page).toHaveURL(/sort=model/);
    await page.getByRole("button", { name: "Model" }).click();
    await expect(page).toHaveURL(/sort=-model/);
  });

  test("facets update the URL only on Apply, and chips echo it", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/inventory");
    // "Status" also matches the sortable column header button in the table
    // below — scope to the facet trigger (aria-haspopup="dialog") to avoid a
    // strict-mode violation across the two matches.
    const statusFacetTrigger = page.getByRole("button", { name: /^Status/ }).and(page.locator("[aria-haspopup]"));
    await statusFacetTrigger.click();
    await page.getByRole("dialog", { name: /Filter by Status/ }).getByLabel(/^DEFECTIVE/i).check();
    await expect(page).not.toHaveURL(/status=/);
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/status=DEFECTIVE/);
    await expect(page.getByRole("link", { name: /status: DEFECTIVE/i })).toBeVisible();
  });

  test("an exact tag search opens the record (scanner contract)", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/inventory");
    await page.getByLabel("Search assets").fill("BR-LT-0148");
    await page.getByLabel("Search assets").press("Enter");
    await expect(page.getByRole("heading", { name: "BR-LT-0148" })).toBeVisible();
  });

  test("viewer is read-only: no checkboxes, no New asset, badge shown", async ({ page }) => {
    await login(page, "viewer@thebackroomop.com");
    await page.goto("/inventory");
    await expect(page.getByText("READ-ONLY · VIEWER")).toBeVisible();
    await expect(page.getByRole("link", { name: "New asset" })).toHaveCount(0);
    await expect(page.getByRole("checkbox")).toHaveCount(0);
  });

  test("bulk selection creates one approval per asset", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    // The plan's original combo (DONATED + BUYOUT → DISPOSE) is a no-op by
    // design: bulkRequestStatusChange skips any source asset whose CURRENT
    // status is already "closed" family (DONATED/BUYOUT/DISPOSE) — reviving
    // off-the-books stock is deliberately a single-record action, never a
    // bulk one (src/server/modules/inventory/actions.ts, statusFamily check).
    // Both seeded assets are closed-family, so targets.length would be 0 and
    // the drawer would report "0 approvals created" instead of 2. Use two
    // SPARE (neutral-family) assets with no open approval in the seed
    // instead — BR-MN-0911 and BR-PH-0301 are untouched by any other test in
    // this file, so this stays isolated.
    await page.goto("/inventory?status=SPARE");
    await page.getByLabel(/Select BR-MN-0911/).check();
    await page.getByLabel(/Select BR-PH-0301/).check();
    await page.getByRole("button", { name: "Bulk actions…" }).click();
    await page.getByLabel(/Target status/).selectOption("DISPOSE");
    await page.getByLabel(/Reason/).fill("e2e bulk disposal run");
    await page.getByRole("button", { name: "Request status change" }).click();
    await expect(page.getByText(/2 approvals created/)).toBeVisible();
  });

  // Was a CSV assertion until Phase 9 Task 3 converted this route to .xlsx
  // (the brief specifies Excel downloads). Kept as a ROUND TRIP rather than a
  // header check: parsing the buffer back is the only thing that proves a real
  // spreadsheet was written, and a text-substring assertion cannot be made
  // against a zipped binary at all.
  test("xlsx export honors filters and is typed", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    const res = await page.request.get("/inventory/export?status=DEPLOYED");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("spreadsheetml.sheet");
    expect(res.headers()["content-disposition"]).toMatch(/attachment; filename="assets-\d{4}-\d{2}-\d{2}\.xlsx"/);

    const grid = (await readSheet(Buffer.from(await res.body()))) as unknown[][];
    expect(grid[0][0]).toBe("Tag");
    const tags = grid.slice(1).map((r) => r[0]);
    expect(tags).toContain("BR-LT-0148");
    expect(tags).not.toContain("BR-LT-0181"); // SPARE — filtered out
  });
});

test.describe("asset record", () => {
  test("create → duplicate tag is an inline error, valid create lands on the record", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/inventory/new");
    await page.getByLabel(/Asset tag/).fill("BR-LT-0148");
    await page.getByLabel(/Model/).fill("e2e duplicate probe");
    await page.getByLabel(/Category/).selectOption({ label: "Laptop" });
    await page.getByRole("button", { name: "Register asset" }).click();
    await expect(page.getByText("That tag is already registered")).toBeVisible();

    const tag = `BR-ZZ-${String(Date.now() % 10000).padStart(4, "0")}`;
    await page.getByLabel(/Asset tag/).fill(tag);
    await page.getByRole("button", { name: "Register asset" }).click();
    await expect(page.getByRole("heading", { name: tag })).toBeVisible();
  });

  test("edit writes field-level history rows", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/inventory?q=BR-MN-0910");
    await expect(page.getByRole("heading", { name: "BR-MN-0910" })).toBeVisible();
    await page.getByRole("link", { name: "Edit" }).click();
    await page.getByLabel(/Model/).fill("LG 27UL500-W");
    await page.getByRole("button", { name: "Save changes" }).click();
    // The save confirmation is a 3-second self-clearing flash (setSaved(true)
    // plus a 3000ms timer, src/components/inventory/asset-form.tsx:96), so the
    // default 5s budget has to cover the WHOLE server-action round trip before
    // the flash even starts — while the round trip runs, this button reads
    // "Loading" and disabled. A dev server several minutes into the full suite
    // occasionally spends longer than 5s on it, which failed this line once in
    // three full runs with the button still mid-flight and no error banner.
    // Reproduced exactly by delaying updateAsset 7s. Same headroom as the cold
    // compile above; the flash lasts 3s, which no polling interval can miss.
    await expect(page.getByRole("button", { name: "✓ Saved" })).toBeVisible({ timeout: 20_000 });
    await page.goto(page.url().replace(/\/edit$/, "/history"));
    await expect(page.getByRole("row", { name: /model/ }).first()).toContainText("LG 27UL500-W");
  });

  test("secrets: reveal is audited and counts down; viewer can't reveal", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/inventory?q=BR-LT-0201");
    // The exact-tag redirect (scanner contract) fires as a client-side
    // redirect after the initial response on a hard navigation — page.url()
    // read immediately after goto() can still show the pre-redirect
    // "/inventory?q=..." URL. Wait for the record URL to settle first.
    await page.waitForURL(/\/inventory\/[^/?]+$/);
    const recordUrl = page.url();
    await page.goto(`${recordUrl}/secrets`);
    // A fixed label of "bios" collides with the Label field's own hint text
    // ("e.g. BIOS password, local admin" — getByText matches case-
    // insensitively), and a fixed label also fails addSecret's per-asset
    // uniqueness check on any rerun that isn't preceded by a reseed. A
    // Date.now() suffix sidesteps both, matching the unique-tag pattern used
    // elsewhere in this file.
    const label = `bios-e2e-${Date.now()}`;
    await page.getByLabel(/Label/).fill(label);
    await page.getByLabel(/Value/).fill("hunter2-e2e");
    await page.getByRole("button", { name: "Store encrypted" }).click();
    await expect(page.getByText(label)).toBeVisible();
    // Scope to this secret's own row: BR-LT-0201 can accumulate secrets from
    // earlier (reseed-separated) runs, and a bare "Reveal" button query would
    // be a strict-mode violation once more than one is listed.
    const secretRow = page.getByRole("listitem").filter({ hasText: label });
    await secretRow.getByRole("button", { name: "Reveal" }).click();
    await expect(page.getByText("hunter2-e2e")).toBeVisible();
    await expect(page.getByText(/hides in \d+s/)).toBeVisible();
    await page.goto(`${recordUrl}/history`);
    await expect(page.getByRole("row", { name: /SECRET_READ/ }).first()).toBeVisible();

    await login(page, "viewer@thebackroomop.com");
    await page.goto(`${recordUrl}/secrets`);
    await expect(page.getByRole("button", { name: "Reveal" })).toHaveCount(0);
  });

  test("documents: type allowlist rejects, PNG uploads", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/inventory?q=BR-LT-0201");
    // See the comment in the secrets test above — wait for the client-side
    // exact-tag redirect to settle before reading page.url().
    await page.waitForURL(/\/inventory\/[^/?]+$/);
    await page.goto(`${page.url()}/documents`);
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    await page.getByLabel("Upload document").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hi") });
    await expect(page.getByText(/Accepted: PDF, PNG, JPG/)).toBeVisible();
    // A fixed "photo.png" name means a rerun's assertion below is satisfied
    // trivially by a PREVIOUS run's leftover document link — the test would
    // report green without this run's own upload ever completing (observed:
    // the request can still be in flight when a stale same-named link
    // already satisfies toBeVisible(), and the test then tears down the page
    // before the write lands). A unique name makes the assertion prove THIS
    // run's upload actually landed.
    const fileName = `photo-${Date.now()}.png`;
    await page.getByLabel("Upload document").setInputFiles({ name: fileName, mimeType: "image/png", buffer: png });
    await expect(page.getByRole("link", { name: fileName })).toBeVisible();
  });
});

test.describe("employees & loadout", () => {
  // The LIST, which nothing axe-checked until Phase 8's Task 14 — and it was
  // carrying 10 serious colour-contrast violations the whole time, one per row's
  // employeeNo, from `--text-faint` failing WCAG AA at 2.57:1. Only
  // /employees/[id] was ever scanned (below), which is why the suite stayed
  // green. This is the assertion that stops the token regressing.
  test("axe passes on the list, not just the detail page", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/employees");
    await expectNoSeriousAxe(page);
  });

  test("list shows loadout gaps; the gaps filter narrows", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/employees");
    const marites = page.getByRole("row", { name: /Marites Bautista/ });
    await expect(marites).toContainText("1 missing");
    await page.getByRole("link", { name: "Policy gaps only" }).click();
    await expect(page).toHaveURL(/gaps=1/);
    await expect(page.getByRole("row", { name: /Marites Bautista/ })).toBeVisible();
    await expect(page.getByRole("row", { name: /Carlo Dizon/ })).toHaveCount(0); // Operations — no policy
  });

  test("loadout view shows the policy gap", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/employees");
    await page.getByRole("link", { name: /Marites Bautista/ }).click();
    // First hit of /employees/[id] in the whole suite (auth-shell and the
    // earlier it-core tests never visit an employee record page): next dev
    // JIT-compiles that route bundle on first request, which occasionally
    // outruns the default 5s timeout on a cold cache. Every later visit to
    // this same route in this file resolves quickly once it's warm — give
    // just this first one more headroom rather than loosening the rest.
    await expect(page.getByRole("button", { name: /headset slot, empty, required/ })).toBeVisible({ timeout: 20_000 });
  });

  // FIXED, twice — kept as the record of how, because the two fixes are a
  // useful contrast in approach. Axe once reported ~6 serious colour-contrast
  // violations here: `--text-faint` at 10-10.5px in LoadoutView's slot-tile
  // microcopy (the "{typeName} · required/optional" line, the "{age} · − return"
  // hint) against near-white tile backgrounds, at ~2.4:1-2.57:1 where WCAG AA
  // wants 4.5:1.
  //
  // Phase 7 fixed it at the CALL SITE, moving that microcopy to
  // `--text-muted`. Phase 8's Task 14 then found the same defect on ~24 other
  // usages — including ten on the /employees LIST, which nothing axe-checked —
  // and fixed it at the TOKEN instead (`--text-faint` is now #667085 light /
  // #868f9c dark; see the reasoning beside the declaration in
  // src/app/globals.css). Neither hex in the original note survives, which is
  // why this comment no longer quotes a line number for it: a citation that
  // drifts is worse than a name you can grep.
  test("loadout view passes axe", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/employees");
    // hard-navigate like every other axe test: a client-side transition can be
    // scanned mid-stream (missing <title>) and produce phantom violations
    const href = await page.getByRole("link", { name: /Marites Bautista/ }).getAttribute("href");
    await page.goto(href!);
    await expectNoSeriousAxe(page);
  });

  test("filling a slot creates an assign approval and a pending tile", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/employees");
    await page.getByRole("link", { name: /Marites Bautista/ }).click();
    await page.getByRole("button", { name: /headset slot, empty, required/ }).click();
    await page.getByRole("radiogroup", { name: "Pick a spare" }).getByText("BR-HS-0502").click();
    await page.getByRole("button", { name: "Request assign" }).click();
    await expect(page.getByText(/APR-\d+ created/)).toBeVisible();
  });

  test("a leaver's grid is frozen", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/employees?q=Dennis");
    await page.getByRole("link", { name: /Dennis Ong/ }).click();
    await expect(page.getByText(/slots are frozen/i)).toBeVisible();
  });

  test("employee edit keeps custom M365 values", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/employees?q=Leo");
    await page.getByRole("link", { name: /Leo Tan/ }).click();
    await page.getByRole("link", { name: "Edit" }).click();
    await expect(page.getByLabel(/Account status/)).toHaveValue("__custom");
    await expect(page.getByLabel(/Custom value/)).toHaveValue("contractor");
  });

  test("accountability form renders the held items", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/employees?q=Marites");
    await page.getByRole("link", { name: /Marites Bautista/ }).click();
    await page.getByRole("link", { name: "Accountability form" }).click();
    await expect(page.getByText("Equipment accountability form")).toBeVisible();
    await expect(page.getByText("BR-LT-0148")).toBeVisible();
  });
});

test.describe("reference data", () => {
  test("inline add, locked row, in-use delete refusal; axe passes", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/admin/asset-categories");
    await expectNoSeriousAxe(page);

    const locked = page.getByRole("row", { name: /Uncategorised/ });
    await expect(locked).toContainText("LOCKED");
    await expect(locked.getByRole("button")).toHaveCount(0);

    const name = `E2E Cat ${Date.now() % 100000}`;
    await page.getByLabel("New category name").fill(name);
    await page.getByRole("button", { name: "Add" }).click();
    await expect(page.getByRole("row", { name: new RegExp(name) })).toBeVisible();

    await page.getByRole("row", { name: /^Laptop/ }).getByLabel(/Actions for Laptop/).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await expect(page.getByText(/is in use by .* — move them first/)).toBeVisible();
  });
});
