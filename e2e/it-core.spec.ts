import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

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

  test("CSV export honors filters and is typed", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    const res = await page.request.get("/inventory/export?status=DEPLOYED");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/csv");
    const body = await res.text();
    expect(body).toContain("BR-LT-0148");
    expect(body).not.toContain("BR-LT-0181"); // SPARE — filtered out
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
    await expect(page.getByRole("button", { name: "✓ Saved" })).toBeVisible();
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

  // BUG (app, not test): axe reports ~6 "serious" color-contrast violations
  // on this page. text-fg-faint (--text-faint: #98a2b3 in light mode, see
  // src/app/globals.css:16) renders at 10-10.5px in several LoadoutView
  // slot-tile labels — e.g. the "{typeName} · required/optional" line and
  // the "{age} · − return" hint in src/components/employees/loadout-view.tsx
  // (around lines 219-236) — against white/near-white tile backgrounds
  // (#ffffff, #faf8f3, #f6f7f9). Measured ratios are ~2.4:1-2.57:1; WCAG 2 AA
  // requires 4.5:1 for normal-size text. Repro: log in as it@thebackroomop.com,
  // open /employees/<Marites Bautista's id> (any employee with a policy works),
  // run an axe scan — violations list multiple color-contrast nodes inside
  // the "Equipment slots" grid — tile microcopy moved from --text-faint to
  // --text-muted (2.5:1 -> 4.7:1) after axe flagged 6 serious violations here.
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
