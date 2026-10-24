import { test, expect, type Browser, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import bcrypt from "bcryptjs";
import { execSync } from "node:child_process";
import path from "node:path";
import { PrismaClient, type Role } from "@prisma/client";
import { SEED_PASSWORD } from "../prisma/fixtures";
import { login, submitSignIn } from "./fixtures/login";

/**
 * Users & access (spec docs/superpowers/specs/2026-10-24-access-management-design.md §4, §7; Task 5):
 *  1. create → first sign-in → choose a password → the Finance workspace; a deep link while a password is owed;
 *  2. reset → the person's other browser is signed out; Reset's ask step and the temporary password take focus;
 *     closing early while the reset runs keeps the dialog (and the password) on screen;
 *  3. role change IT → Finance → signed out, and the old IT page sends them to the Finance landing;
 *  4. turn off → signed out, and sign-in is refused; the inline confirm takes focus and gives it back;
 *  5. sign-up → waits → PENDING copy → approve with a role and employee → signs in; decline → DECLINED copy;
 *  6. three wrong passwords → the pause, the same for an unknown email; it lifts after the window;
 *  7. Account settings: Show/Hide, a wrong current password, a change (focus back on Change password; the other
 *     browser signed out); the empty status region leaves no gap;
 *  8. the permanent admin's panel is locked;
 *  9. focus: the Edit form, the discard prompt raised by a row pick; Add user's password; closing Add user early;
 * 10. layout at 1440 (side by side), 1024 (a drawer), 375 (cards, a full-screen sheet, a bottom dialog): no sideways
 *     scroll, and every visible panel button at least 44 px tall; screenshots for the owner;
 * 11. axe: Users & access, Add user, Account settings and /welcome/password, light and dark, 1440 and 375 px.
 *
 * Fixture accounts are made straight in the database with the seed password (bcrypt cost 10), named E2E … so the
 * list's search finds them; each test makes its own, so none depends on another's leftovers.
 */

const db = new PrismaClient();
const ADMIN = "admin@thebackroomop.com";
const DOMAIN = "thebackroomop.com";
const TEMP_SHAPE = /^[A-Z][a-z]{3,6}-[2-9]{4}-[a-z]{4,7}$/;
const NEW_PASSWORD = "harbour-lights-42";
/**
 * Where the owner's screenshots go: the test's own output folder under test-results/ (gitignored, per test), or the
 * folder in E2E_SHOT_DIR when set, e.g. `E2E_SHOT_DIR=../shots npx playwright test e2e/access-management.spec.ts`.
 */
function shotPath(name: string): string {
  const dir = process.env.E2E_SHOT_DIR;
  return dir ? path.resolve(dir, name) : test.info().outputPath(name);
}

const COPY = {
  wrong: /Wrong email or password — or the account is disabled\./,
  paused: /Too many tries — wait 15 minutes or ask an admin to reset your password\./,
  pending: /Your account is waiting for an admin to approve it\./,
  declined: /Your sign-up wasn't approved\. Ask an admin if you think this is a mistake\./,
  lock: "The permanent admin's account can only be changed by its owner.",
  changed: "Password changed. You stay signed in here; your other devices are signed out.",
  wrongCurrent: "That isn't your current password",
};

// Spec files share one database and run alphabetically: each reseeds so none inherits another's mutations.
test.beforeAll(() => {
  execSync("npm run db:seed", { timeout: 120_000 });
});
test.afterAll(async () => {
  await db.$disconnect();
});

let serial = 0;
/** A fresh account straight in the database: the seed password, APPROVED, owing nothing. */
async function fixtureUser(role: Role, label: string, data: { mustChangePassword?: boolean } = {}) {
  const stamp = `${Date.now().toString(36)}${serial++}`;
  const name = `E2E ${label} ${stamp}`;
  const email = `e2e.${label.toLowerCase().replace(/\W+/g, "-")}.${stamp}@${DOMAIN}`;
  const user = await db.user.create({
    data: { email, name, role, passwordHash: await bcrypt.hash(SEED_PASSWORD, 10), ...data },
    select: { id: true },
  });
  return { id: user.id, name, email };
}

/** Copied from e2e/admin.spec.ts (house rule: no helpers across spec files): a click can't race hydration. */
async function waitForHydration(target: Locator) {
  const el = target.first();
  await el.waitFor({ state: "attached", timeout: 30_000 });
  await expect(async () => {
    expect(await el.evaluate((node) => Object.keys(node).some((k) => k.startsWith("__reactFiber$")))).toBe(true);
  }).toPass({ timeout: 30_000 });
}

/** Signs in with a password and waits to leave /login (to Home, or /welcome/password while one is owed). */
async function signIn(page: Page, email: string, password: string) {
  await page.goto("/logout");
  await submitSignIn(page, email, password);
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
}

/** A second browser for the same person (their "other device"). */
async function otherBrowser(browser: Browser, email: string, password: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, email, password);
  return { context, page };
}

/** A refused sign-in: the message is read through Password's accessible description, as login-cris.spec.ts does. */
async function expectSignInRefused(page: Page, email: string, password: string, copy: RegExp) {
  await page.goto("/logout"); // signed in, /login would bounce to Home
  await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });
  await submitSignIn(page, email, password);
  await expect(page.getByLabel("Password", { exact: true })).toHaveAccessibleDescription(copy, { timeout: 30_000 });
  await expect(page).toHaveURL(/\/login/);
}

/** Users & access, hydrated. */
async function openUsers(page: Page, query = "") {
  await page.goto(`/admin/users${query}`);
  await expect(page.getByRole("heading", { name: "Users & access", level: 1 })).toBeVisible({ timeout: 30_000 });
  await waitForHydration(page.getByRole("button", { name: "Add user", exact: true }));
}

/** One person's details beside the list (1180 px and wider), opened through ?sel=. */
async function openPanel(page: Page, who: { id: string; name: string }, query = "") {
  await openUsers(page, `?sel=${who.id}${query ? `&${query}` : ""}`);
  const panel = page.getByRole("complementary", { name: `${who.name}'s details` });
  await expect(panel).toBeVisible();
  await waitForHydration(panel.getByRole("heading", { name: who.name, level: 2 }));
  return panel;
}

/** Holds the next server-action POST (it carries a Next-Action header) for `ms`, once. Returns how many were held. */
async function holdNextAction(page: Page, ms: number) {
  const held = { count: 0 };
  await page.route(
    () => true,
    async (route) => {
      const req = route.request();
      if (held.count === 0 && req.method() === "POST" && req.headers()["next-action"]) {
        held.count++;
        await new Promise((r) => setTimeout(r, ms));
      }
      await route.fallback();
    },
  );
  return held;
}

const focusInside = (target: Locator) => target.evaluate((el) => el.contains(document.activeElement));

/** Serious and critical axe findings, with what they hit; the pointer settled first, as axe-sweep.spec.ts does. */
async function seriousViolations(page: Page) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(700);
  const results = await new AxeBuilder({ page }).analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
}

/**
 * Every control in `scope`, scrolled into view the way the keyboard brings it (nearest, honouring scroll padding),
 * lies clear of Cris's mascot. Returns the ones that would sit under it. Empty when Cris isn't shown.
 */
async function controlsUnderCris(scope: Locator, scroll = true): Promise<string[]> {
  return scope.evaluate((root, scroll) => {
    const dock = document.querySelector("[data-cris-dock]");
    if (!dock) return [];
    const under: string[] = [];
    for (const el of root.querySelectorAll<HTMLElement>('button, a[href], input, [role="switch"]')) {
      if (el.getClientRects().length === 0 || getComputedStyle(el).visibility === "hidden") continue;
      if (scroll) el.scrollIntoView({ block: "nearest", behavior: "instant" });
      // What is actually painted: the control's box clipped by every scrolling box it sits in (a control scrolled out
      // of the panel's scroll area is hidden, wherever its box is) and by the window.
      let r = el.getBoundingClientRect();
      for (let p = el.parentElement; p; p = p.parentElement) {
        const o = getComputedStyle(p).overflowY;
        if (o !== "auto" && o !== "scroll" && o !== "hidden") continue;
        const b = p.getBoundingClientRect();
        const left = Math.max(r.left, b.left);
        const top = Math.max(r.top, b.top);
        r = new DOMRect(left, top, Math.min(r.right, b.right) - left, Math.min(r.bottom, b.bottom) - top);
      }
      if (r.width <= 0 || r.height <= 0 || r.top >= window.innerHeight) continue;
      const c = dock.getBoundingClientRect();
      const overlaps = r.left < c.right && r.right > c.left && r.top < c.bottom && r.bottom > c.top;
      if (overlaps) under.push((el.getAttribute("aria-label") ?? el.textContent ?? el.tagName).trim().slice(0, 40));
    }
    return under;
  }, scroll);
}

/** No sideways scroll on the page. */
async function expectNoSidewaysScroll(page: Page, label: string) {
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(scroll, `${label}: page scrollWidth ${scroll} > ${client}`).toBeLessThanOrEqual(client);
}

/** Every visible button inside `scope` is at least 44 px tall (the switch's 44 px hit area is its wrapper). */
async function expectTallTargets(scope: Locator, label: string) {
  const short = await scope.evaluate((root) => {
    const out: string[] = [];
    for (const el of root.querySelectorAll<HTMLElement>('button:not([role="switch"]), a[href], [data-focus="switch"]')) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || cs.visibility === "hidden") continue;
      if (r.height < 44 - 0.5) out.push(`${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40)}: ${r.height.toFixed(1)}px`);
    }
    return out;
  });
  expect(short, `${label}: targets under 44 px`).toEqual([]);
}

test.describe("users & access: the flows", () => {
  test("1. create → first sign-in (a deep link waits) → choose a password → the Finance workspace", async ({ page, browser }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page, ADMIN);
    await openUsers(page);

    const stamp = Date.now().toString(36);
    const name = `E2E Created ${stamp}`;
    const email = `e2e.created.${stamp}@${DOMAIN}`;
    await page.getByRole("button", { name: "Add user", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "Add user" });
    await expect(sheet).toBeVisible();
    await sheet.getByLabel("Full name").fill(name);
    await sheet.getByLabel("Work email").fill(email);
    await sheet.getByRole("radio", { name: /^Finance staff/ }).check();
    await sheet.getByRole("button", { name: "Create account", exact: true }).click();

    await expect(sheet.getByRole("status").filter({ hasText: `Account created for ${name} — give them the temporary password` }))
      .toBeVisible({ timeout: 30_000 });
    const temp = sheet.locator("[data-temp-password]");
    // Focus lands on the password field as it appears (Task 4 fix round 2, N-1).
    await expect(temp).toBeFocused();
    const tempPassword = await temp.inputValue();
    expect(tempPassword).toMatch(TEMP_SHAPE);
    // Done works at once, while the page still moves to the new account (a bug this test found: the sheet ignored
    // every close until that navigation finished).
    await sheet.getByRole("button", { name: "Done", exact: true }).click();
    await expect(sheet).toHaveCount(0);
    // Wide: the new account is selected beside the list, as Must set password.
    const panel = page.getByRole("complementary", { name: `${name}'s details` });
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await expect(panel.locator('[data-user-status="MUST_SET_PASSWORD"]')).toBeVisible();

    // Their first sign-in, in their own browser.
    const them = await browser.newContext();
    const p = await them.newPage();
    try {
      await signIn(p, email, tempPassword);
      await expect(p).toHaveURL(/\/welcome\/password$/);
      await expect(p.getByRole("heading", { name: "Choose your own password", level: 1 })).toBeVisible();
      await expect(p.getByText(`Signed in as ${email}`)).toBeVisible();

      // A deep link while a password is owed still lands here.
      await p.goto("/inventory");
      await expect(p).toHaveURL(/\/welcome\/password$/);
      await p.goto("/finance/assets");
      await expect(p).toHaveURL(/\/welcome\/password$/);

      const fresh = p.getByLabel("New password", { exact: true });
      await waitForHydration(fresh);
      // Show/Hide changes the input's type (Task 2: the click needed a browser).
      const show = p.getByRole("button", { name: "Show new password" });
      await expect(fresh).toHaveAttribute("type", "password");
      await show.click();
      await expect(fresh).toHaveAttribute("type", "text");
      await expect(show).toHaveAttribute("aria-pressed", "true");
      await show.click();
      await expect(fresh).toHaveAttribute("type", "password");

      // The temporary password itself is refused, on the server.
      await fresh.fill(tempPassword);
      await p.getByLabel("Type it again", { exact: true }).fill(tempPassword);
      await p.getByRole("button", { name: "Save and continue" }).click();
      await expect(fresh).toHaveAccessibleDescription(/Choose your own password, not the temporary one\./, { timeout: 30_000 });

      await fresh.fill(NEW_PASSWORD);
      await p.getByLabel("Type it again", { exact: true }).fill(NEW_PASSWORD);
      await expect(p.getByText("2 of 2 rules met")).toBeAttached();
      await p.getByRole("button", { name: "Save and continue" }).click();
      // Home, still signed in; nothing is owed any more.
      await expect(p).toHaveURL((u) => u.pathname === "/", { timeout: 30_000 });
      await p.goto("/welcome/password");
      await expect(p).toHaveURL((u) => u.pathname === "/");
      // Their role's workspace opens; an IT page sends them to the Finance landing.
      await p.goto("/finance/assets");
      await expect(p).toHaveURL(/\/finance\/assets/);
      // (Finance shares the inventory list; the IT-only import page is the one it can't open.)
      await p.goto("/inventory/import");
      await expect(p).toHaveURL(/\/finance\/assets/);
    } finally {
      await them.close();
    }
  });

  test("2. reset: focus in the ask step and back; closing early keeps the password; the other browser is signed out", async ({ page, browser }) => {
    test.setTimeout(180_000);
    const nina = await fixtureUser("it_staff", "Reset");
    const other = await otherBrowser(browser, nina.email, SEED_PASSWORD);
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await login(page, ADMIN);
      const panel = await openPanel(page, nina);
      const trigger = panel.getByRole("button", { name: "Reset password…" });

      // The ask step takes focus; Cancel gives it back to Reset password….
      await trigger.click();
      const dialog = page.getByRole("dialog", { name: `Reset ${nina.name}'s password?` });
      await expect(dialog).toBeVisible();
      await expect.poll(() => focusInside(dialog)).toBe(true);
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
      // Escape too.
      await trigger.click();
      await expect(dialog).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();

      // Closing early: while the reset runs, Escape and Cancel do nothing (Task 4 fix round 1, Minor 1), so the new
      // password still shows once it lands.
      await trigger.click();
      await expect(dialog).toBeVisible();
      const held = await holdNextAction(page, 2500);
      await dialog.getByRole("button", { name: "Reset password", exact: true }).click();
      await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeVisible();
      const temp = dialog.locator("[data-temp-password]");
      await expect(temp).toBeVisible({ timeout: 30_000 });
      expect(held.count).toBe(1);
      await page.unroute(() => true);
      await expect(temp).toBeFocused();
      const tempPassword = await temp.inputValue();
      expect(tempPassword).toMatch(TEMP_SHAPE);
      await dialog.getByRole("button", { name: "Done", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(panel.locator('[data-user-status="MUST_SET_PASSWORD"]')).toBeVisible({ timeout: 30_000 });

      // Their other browser is signed out at its next navigation.
      await other.page.goto("/inventory");
      await expect(other.page).toHaveURL(/\/login/, { timeout: 30_000 });
      // The old password no longer works; the temporary one leads to the first-sign-in page.
      await expectSignInRefused(other.page, nina.email, SEED_PASSWORD, COPY.wrong);
      await signIn(other.page, nina.email, tempPassword);
      await expect(other.page).toHaveURL(/\/welcome\/password$/);
    } finally {
      await other.context.close();
    }
  });

  test("3. role change IT → Finance: the note, Save, signed out; the old IT page sends them to Finance", async ({ page, browser }) => {
    test.setTimeout(180_000);
    const ito = await fixtureUser("it_staff", "Role");
    const other = await otherBrowser(browser, ito.email, SEED_PASSWORD);
    try {
      const IT_ONLY = "/inventory/import"; // Finance shares the inventory list, but not this
      await other.page.goto(IT_ONLY);
      await expect(other.page).toHaveURL(/\/inventory\/import/);

      await page.setViewportSize({ width: 1440, height: 900 });
      await login(page, ADMIN);
      const panel = await openPanel(page, ito);
      await panel.getByRole("radio", { name: /^Finance staff/ }).check();
      const first = ito.name.split(" ")[0];
      await expect(panel.getByText(`Moves ${first} from IT staff to Finance staff: opens Finance instead of IT. They're signed out when you save.`))
        .toBeVisible();
      const bar = panel.getByRole("region", { name: "Unsaved changes" });
      await bar.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page.getByText(`${ito.name} is now Finance staff · signed out`)).toBeVisible({ timeout: 30_000 });
      await expect(bar).toHaveCount(0);

      await other.page.goto("/inventory");
      await expect(other.page).toHaveURL(/\/login/, { timeout: 30_000 });
      await signIn(other.page, ito.email, SEED_PASSWORD);
      await other.page.goto(IT_ONLY);
      await expect(other.page).toHaveURL(/\/finance\/assets/, { timeout: 30_000 });
    } finally {
      await other.context.close();
    }
  });

  test("4. turn off: the confirm takes focus and gives it back; signed out; sign-in refused", async ({ page, browser }) => {
    test.setTimeout(180_000);
    const off = await fixtureUser("viewer", "Off");
    const other = await otherBrowser(browser, off.email, SEED_PASSWORD);
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await login(page, ADMIN);
      const panel = await openPanel(page, off);
      const toggle = panel.getByRole("switch", { name: "Account active" });
      await expect(toggle).toHaveAttribute("aria-checked", "true");

      await toggle.click();
      const confirm = panel.getByRole("group").filter({ hasText: `Turn off ${off.name}'s account? They're signed out now and can't sign in. Their history stays.` });
      await expect(confirm).toBeVisible();
      await expect(confirm.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
      await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(confirm).toHaveCount(0);
      await expect(toggle).toBeFocused();
      await expect(toggle).toHaveAttribute("aria-checked", "true");

      await toggle.click();
      await expect(confirm).toBeVisible();
      await confirm.getByRole("button", { name: "Turn off account", exact: true }).click();
      await expect(page.getByText(`${off.name}'s account is off · signed out`)).toBeVisible({ timeout: 30_000 });
      await expect(toggle).toHaveAttribute("aria-checked", "false");
      await expect(panel.locator('[data-user-status="DISABLED"]')).toBeVisible();

      await other.page.goto("/inventory");
      await expect(other.page).toHaveURL(/\/login/, { timeout: 30_000 });
      await expectSignInRefused(other.page, off.email, SEED_PASSWORD, COPY.wrong);
    } finally {
      await other.context.close();
    }
  });

  test("5. sign-up waits; PENDING copy; approve with a role and employee, then sign-in works; decline → DECLINED copy", async ({ page, browser }) => {
    test.setTimeout(240_000);
    // An active employee without an account, whose name the sign-up uses, so Approve's picker finds them.
    const employee = await db.employee.findFirstOrThrow({
      where: { employment: "ACTIVE", user: { is: null } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    const email = `e2e.signup.${Date.now().toString(36)}@${DOMAIN}`;
    const password = "signup-pass-77";

    const them = await browser.newContext();
    const p = await them.newPage();
    try {
      await p.goto("/signup");
      await p.locator('[data-login-ready="true"]').waitFor();
      await p.getByLabel("Full name").fill(employee.name);
      await p.getByLabel("Work email", { exact: true }).fill(email);
      await p.getByRole("button", { name: "Continue", exact: true }).click();
      await expect(p.getByRole("heading", { name: "Choose a password" })).toBeVisible();
      await p.getByLabel("Password", { exact: true }).fill(password);
      await p.getByRole("button", { name: "Create account", exact: true }).click();
      await expect(p.getByRole("heading", { name: "Wait for an admin to approve your account." })).toBeVisible({ timeout: 30_000 });
      await expect(p.getByText("You can sign in once it's approved.")).toBeVisible();
      await expectSignInRefused(p, email, password, COPY.pending);

      // The admin approves it from the waiting list, as Finance staff, linked to the employee.
      await page.setViewportSize({ width: 1440, height: 900 });
      await login(page, ADMIN);
      await openUsers(page);
      const chip = page.getByRole("link", { name: /^Waiting for approval · 2/ });
      await expect(chip).toBeVisible();
      await chip.click();
      await expect(page).toHaveURL(/status=PENDING/);
      const row = page.locator("tr[data-user-row]").filter({ hasText: email });
      await waitForHydration(row);
      await row.click();
      const panel = page.getByRole("complementary", { name: `${employee.name}'s details` });
      await expect(panel.getByRole("heading", { name: "Approve sign-up" })).toBeVisible({ timeout: 30_000 });
      await expect(panel.locator('[data-user-status="PENDING"]')).toBeVisible();
      await panel.getByRole("radio", { name: /^Finance staff/ }).check();
      const matches = panel.getByRole("list", { name: "Matching employees" });
      await matches.getByRole("button", { name: new RegExp(`^${employee.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) }).first().click();
      await panel.getByRole("button", { name: "Approve", exact: true }).click();
      await expect(page.getByText(`${employee.name} approved as Finance staff — they can sign in now`)).toBeVisible({ timeout: 30_000 });
      const approved = await db.user.findUniqueOrThrow({ where: { email }, select: { approvalState: true, disabled: true, role: true, employeeId: true } });
      expect(approved).toEqual({ approvalState: "APPROVED", disabled: false, role: "finance_staff", employeeId: employee.id });

      // Now the password they chose works, and nothing is owed.
      await signIn(p, email, password);
      await expect(p).toHaveURL((u) => u.pathname === "/");

      // The seed's waiting sign-up is declined: sign-in then shows the DECLINED copy.
      await openUsers(page, "?status=PENDING");
      const pending = page.locator("tr[data-user-row]").filter({ hasText: "pending@thebackroomop.com" });
      await waitForHydration(pending);
      await pending.click();
      const pendingPanel = page.getByRole("complementary", { name: "P. Navarro's details" });
      await pendingPanel.getByRole("button", { name: "Decline", exact: true }).click();
      await expect(pendingPanel.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
      await pendingPanel.getByRole("button", { name: "Decline sign-up", exact: true }).click();
      await expect(page.getByText("P. Navarro's sign-up declined")).toBeVisible({ timeout: 30_000 });
      await expectSignInRefused(p, "pending@thebackroomop.com", SEED_PASSWORD, COPY.declined);
    } finally {
      await them.close();
    }
  });

  test("6. three wrong passwords pause sign-in, for a real or an unknown email; the pause lifts after the window", async ({ page }) => {
    test.setTimeout(180_000);
    const paused = await fixtureUser("viewer", "Pause");
    for (const email of [paused.email, `e2e.nobody.${Date.now().toString(36)}@${DOMAIN}`]) {
      for (let i = 0; i < 3; i++) await expectSignInRefused(page, email, `not-it-${i}-x9`, COPY.wrong);
      // The fourth try is paused before the password is checked: even the right one.
      await expectSignInRefused(page, email, SEED_PASSWORD, COPY.paused);
    }
    // 16 minutes later (the window moved back in the database), the right password works.
    await db.signInAttempt.updateMany({
      where: { emailKey: paused.email },
      data: { createdAt: new Date(Date.now() - 16 * 60_000) },
    });
    await signIn(page, paused.email, SEED_PASSWORD);
    await expect(page).toHaveURL((u) => u.pathname === "/");
  });

  test("7. Account settings: Show/Hide, a wrong current password, a change; focus back on Change password; no gap", async ({ page, browser }) => {
    test.setTimeout(180_000);
    const me = await fixtureUser("purchasing_staff", "Account");
    const other = await otherBrowser(browser, me.email, SEED_PASSWORD);
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await signIn(page, me.email, SEED_PASSWORD);
      // From the account menu.
      await page.goto("/purchases");
      const menu = page.getByRole("button", { name: "Account menu" });
      await waitForHydration(menu);
      await menu.click();
      await page.getByRole("menuitem", { name: "Account settings" }).click();
      await expect(page).toHaveURL(/\/settings\/account$/, { timeout: 30_000 });
      await expect(page.getByRole("heading", { name: "Account settings", level: 1 })).toBeVisible();
      await expect(page.getByText("Something here wrong? Ask an admin to change it.")).toBeVisible();

      // The empty status region leaves no gap above "Not changed / Last changed".
      const status = page.getByTestId("password-status");
      const gap = await status.evaluate((el) => {
        const body = el.parentElement!;
        const next = el.nextElementSibling as HTMLElement;
        const pad = parseFloat(getComputedStyle(body).paddingTop);
        return next.getBoundingClientRect().top - (body.getBoundingClientRect().top + pad);
      });
      expect(gap, "space above the first line of the Password card").toBeLessThan(1);

      const change = page.getByRole("button", { name: "Change password", exact: true });
      await waitForHydration(change);
      await change.click();
      const current = page.getByLabel("Current password", { exact: true });
      await expect(current).toHaveAttribute("type", "password");
      await page.getByRole("button", { name: "Show current password" }).click();
      await expect(current).toHaveAttribute("type", "text");
      await page.getByRole("button", { name: "Show current password" }).click();
      await expect(current).toHaveAttribute("type", "password");

      await current.fill("not-my-password-1");
      await page.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
      await page.getByLabel("Type it again", { exact: true }).fill(NEW_PASSWORD);
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(current).toHaveAccessibleDescription(new RegExp(COPY.wrongCurrent), { timeout: 30_000 });

      await current.fill(SEED_PASSWORD);
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(status).toContainText(COPY.changed, { timeout: 30_000 });
      await expect(change).toBeFocused();
      await expect(page.getByText(/^Last changed /)).toBeVisible();

      // This browser stays signed in; the other one is signed out.
      await page.goto("/settings/account");
      await expect(page).toHaveURL(/\/settings\/account$/);
      await other.page.goto("/purchases");
      await expect(other.page).toHaveURL(/\/login/, { timeout: 30_000 });
      await signIn(other.page, me.email, NEW_PASSWORD);
      await expect(other.page).toHaveURL((u) => u.pathname === "/");
    } finally {
      await other.context.close();
    }
  });

  test("8. the permanent admin's panel is locked", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page, ADMIN);
    const admin = await db.user.findUniqueOrThrow({ where: { email: ADMIN }, select: { id: true, name: true } });
    const panel = await openPanel(page, admin);
    await expect(panel.getByRole("paragraph").filter({ hasText: COPY.lock })).toBeVisible();
    for (const radio of await panel.getByRole("radio").all()) await expect(radio).toBeDisabled();
    await expect(panel.getByRole("switch", { name: "Account active" })).toBeDisabled();
    await expect(panel.getByRole("switch", { name: "Account active" })).toHaveAccessibleDescription(COPY.lock);
    await expect(panel.getByRole("button", { name: "Reset password…" })).toBeDisabled();
    await expect(panel.getByRole("button", { name: "Edit name and email" })).toHaveCount(0);
    await expect(panel.getByRole("button", { name: /^(Change|Unlink|Link…)$/ })).toHaveCount(0);
    // The list marks it too.
    await expect(page.locator(`tr[data-user-row="${admin.id}"]`)).toContainText("Permanent");
  });

  test("9. focus: the Edit form, the discard prompt from a row pick; closing Add user early keeps its password", async ({ page }) => {
    test.setTimeout(180_000);
    const a = await fixtureUser("viewer", "Focus A");
    const b = await fixtureUser("viewer", "Focus B");
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page, ADMIN);
    const panel = await openPanel(page, a, "q=E2E+Focus");

    // Edit: focus on Full name; Cancel gives it back to Edit.
    const edit = panel.getByRole("button", { name: "Edit name and email" });
    await edit.click();
    await expect(panel.getByLabel("Full name")).toBeFocused();
    await panel.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(edit).toBeFocused();

    // A draft, then a pick of another row: the discard prompt takes focus (Task 4 fix round 2, N-2).
    await panel.getByRole("radio", { name: /^Finance staff/ }).check();
    await expect(panel.getByRole("region", { name: "Unsaved changes" })).toBeVisible();
    await page.locator(`tr[data-user-row="${b.id}"]`).click();
    // Final review M-6: an inline, labelled group (not a dialog); focus still moves into it.
    const prompt = panel.getByRole("group", { name: "Discard unsaved changes?" });
    await expect(prompt).toBeVisible();
    await expect(prompt.getByRole("button", { name: "Keep editing" })).toBeFocused();
    await prompt.getByRole("button", { name: "Keep editing" }).click();
    await expect(prompt).toHaveCount(0);
    await expect(panel.getByRole("button", { name: "Save", exact: true })).toBeFocused();
    await expect(page).toHaveURL(new RegExp(`sel=${a.id}`));
    // Discard moves on to the row picked.
    await page.locator(`tr[data-user-row="${b.id}"]`).click();
    await prompt.getByRole("button", { name: "Discard", exact: true }).click();
    await expect(page.getByRole("complementary", { name: `${b.name}'s details` })).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(new RegExp(`sel=${b.id}`));

    // Add user: closing early while Create account runs does nothing, so the password is never lost unseen.
    await page.getByRole("button", { name: "Add user", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "Add user" });
    const stamp = Date.now().toString(36);
    await sheet.getByLabel("Full name").fill(`E2E Early ${stamp}`);
    await sheet.getByLabel("Work email").fill(`e2e.early.${stamp}@${DOMAIN}`);
    const held = await holdNextAction(page, 2500);
    await sheet.getByRole("button", { name: "Create account", exact: true }).click();
    await expect(sheet.getByRole("button", { name: "Close", exact: true })).toBeDisabled();
    await expect(sheet.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
    await page.keyboard.press("Escape");
    await page.mouse.click(20, 450); // the veil
    await expect(sheet).toBeVisible();
    const temp = sheet.locator("[data-temp-password]");
    await expect(temp).toBeVisible({ timeout: 30_000 });
    expect(held.count).toBe(1);
    await page.unroute(() => true);
    await expect(temp).toBeFocused();
    expect(await temp.inputValue()).toMatch(TEMP_SHAPE);
    await sheet.getByRole("button", { name: "Done", exact: true }).click();
    await expect(sheet).toHaveCount(0);
  });
});

test.describe("users & access: layout, screenshots and axe", () => {
  test("10. 1440 side by side, 1024 a drawer, 375 cards + full-screen sheet + bottom dialog; no sideways scroll; 44 px", async ({ page }) => {
    test.setTimeout(240_000);
    const who = await fixtureUser("it_staff", "Layout");
    await login(page, ADMIN);

    // 1440: the list and the details side by side.
    await page.setViewportSize({ width: 1440, height: 900 });
    let panel = await openPanel(page, who);
    const list = page.getByRole("region", { name: "Users" }).or(page.locator('section[aria-label="Users"]')).first();
    const lb = (await list.boundingBox())!;
    const pb = (await panel.boundingBox())!;
    expect(pb.x, "the panel sits to the right of the list").toBeGreaterThanOrEqual(lb.x + lb.width - 1);
    expect(Math.abs(pb.y - lb.y), "side by side, tops aligned").toBeLessThan(4);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // Names keep their room beside the panel (found here: the Person column was ~100 px, the Permanent pill over Role).
    const person = page.getByRole("columnheader", { name: "Person" });
    expect((await person.boundingBox())!.width, "Person column at 1440").toBeGreaterThanOrEqual(200);
    await expect(page.getByRole("columnheader", { name: "Employee record" })).toBeHidden();
    const permanent = page.locator("tr[data-user-row]").first().getByText("Permanent", { exact: true });
    const role = page.locator("tr[data-user-row]").first().getByText("Admin", { exact: true });
    const [pill, chip] = [(await permanent.boundingBox())!, (await role.boundingBox())!];
    expect(pill.x + pill.width, "the Permanent pill stays left of the Role chip").toBeLessThanOrEqual(chip.x);
    await expectNoSidewaysScroll(page, "1440");
    await expectTallTargets(panel, "1440 panel");
    await page.screenshot({ path: shotPath("access-1440.png") }); // before any draft or scrolling below
    // Cris's corner (the controller's finding on the first 1440 screenshot: Cris sat over the panel's Edit): every
    // panel control, brought into view, is clear of Cris; so are the Unsaved changes bar's.
    await expect(page.locator("[data-cris-dock]")).toBeVisible();
    // At rest (nothing scrolled), and with each control brought into view, nothing in the panel is under Cris.
    await expect.poll(() => controlsUnderCris(panel, false), { message: "panel controls under Cris at rest" }).toEqual([]);
    expect(await controlsUnderCris(panel), "panel controls under Cris at 1440x900").toEqual([]);
    await panel.getByRole("radio", { name: /^Viewer/ }).check();
    await expect(panel.getByRole("region", { name: "Unsaved changes" })).toBeVisible();
    expect(await controlsUnderCris(panel), "the Save bar under Cris at 1440x900").toEqual([]);
    await panel.getByRole("region", { name: "Unsaved changes" }).getByRole("button", { name: "Discard", exact: true }).click();
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      document.querySelector("[data-panel-scroll]")?.scrollTo(0, 0);
    });

    // 1024: no side panel; picking a row opens a drawer, Close removes ?sel=.
    await page.setViewportSize({ width: 1024, height: 900 });
    await openUsers(page, "?q=E2E+Layout");
    await expect(page.getByRole("complementary", { name: /'s details$/ })).toHaveCount(0);
    // Beside the sidebar the list is under 900 px, so Employee record gives way and names keep their room.
    await expect(page.getByRole("columnheader", { name: "Employee record" })).toBeHidden();
    expect((await page.getByRole("columnheader", { name: "Person" }).boundingBox())!.width, "Person at 1024").toBeGreaterThanOrEqual(200);
    await page.locator(`tr[data-user-row="${who.id}"]`).click();
    panel = page.getByRole("dialog", { name: `${who.name}'s details` });
    await expect(panel).toBeVisible({ timeout: 30_000 });
    // A right-hand drawer, once its slide-in has settled.
    await expect.poll(async () => {
      const r = (await panel.boundingBox())!;
      return [Math.round(r.x + r.width), r.width <= 441];
    }).toEqual([1024, true]);
    await expectNoSidewaysScroll(page, "1024");
    await expectTallTargets(panel, "1024 drawer");
    await panel.getByRole("button", { name: "Close details" }).click();
    await expect(panel).toHaveCount(0);
    await expect(page).not.toHaveURL(/sel=/);

    // 834 (tablet portrait) for the owner's screenshot, with the drawer open.
    await page.setViewportSize({ width: 834, height: 1112 });
    await openUsers(page, `?sel=${who.id}`);
    const drawer834 = page.getByRole("dialog", { name: `${who.name}'s details` });
    await expect(drawer834).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => Math.round(((await drawer834.boundingBox())!).x + ((await drawer834.boundingBox())!).width)).toBe(834);
    expect((await page.getByRole("columnheader", { name: "Person" }).boundingBox())!.width, "Person at 834").toBeGreaterThanOrEqual(200);
    await expect(page.getByRole("columnheader", { name: "Employee record" })).toBeHidden();
    await expectNoSidewaysScroll(page, "834");
    await page.screenshot({ path: shotPath("access-834.png") });

    // 375: cards instead of the table; the details full screen; Reset a bottom dialog; Add user full screen.
    await page.setViewportSize({ width: 375, height: 812 });
    await openUsers(page, "?q=E2E+Layout");
    await expect(page.getByRole("table")).toBeHidden();
    const cards = page.getByRole("list", { name: "User cards" });
    await expect(cards).toBeVisible();
    await expectNoSidewaysScroll(page, "375 list");
    await cards.locator(`[data-user-card="${who.id}"]`).click();
    panel = page.getByRole("dialog", { name: `${who.name}'s details` });
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => {
      const r = (await panel.boundingBox())!;
      return [Math.round(r.x), Math.round(r.width)];
    }).toEqual([0, 375]);
    await expectNoSidewaysScroll(page, "375 sheet");
    await expectTallTargets(panel, "375 sheet");
    // Scroll the sheet through, so the lower sections' targets are measured on screen too.
    await panel.getByRole("button", { name: "Reset password…" }).scrollIntoViewIfNeeded();
    await expectTallTargets(panel, "375 sheet, scrolled");
    await panel.getByRole("button", { name: "Reset password…" }).click();
    const reset = page.getByRole("dialog", { name: `Reset ${who.name}'s password?` });
    await expect(reset).toBeVisible();
    await expect.poll(async () => {
      const r = (await reset.boundingBox())!;
      return [Math.round(r.y + r.height), Math.round(r.width)];
    }).toEqual([812, 375]);
    await expectTallTargets(reset, "375 reset dialog");
    await reset.getByRole("button", { name: "Cancel", exact: true }).click();
    await panel.getByRole("button", { name: "Close details" }).click();
    await expect(panel).toHaveCount(0);

    await page.getByRole("button", { name: "Add user", exact: true }).click();
    const add = page.getByRole("dialog", { name: "Add user" });
    await expect(add).toBeVisible();
    await expect.poll(async () => {
      const r = (await add.boundingBox())!;
      return [Math.round(r.x), Math.round(r.width)];
    }).toEqual([0, 375]);
    await expectNoSidewaysScroll(page, "375 Add user");
    await expectTallTargets(add, "375 Add user");
    await add.getByRole("button", { name: "Cancel", exact: true }).click();

    // The owner's phone screenshots: Users & access and Account settings at 390 × 844.
    await page.setViewportSize({ width: 390, height: 844 });
    await openUsers(page);
    await expectNoSidewaysScroll(page, "390");
    await page.screenshot({ path: shotPath("access-390.png") });
    await page.goto("/settings/account");
    await expect(page.getByRole("heading", { name: "Account settings", level: 1 })).toBeVisible({ timeout: 30_000 });
    await expectNoSidewaysScroll(page, "390 account");
    await page.screenshot({ path: shotPath("account-390.png") });
  });

  test("11. axe: Users & access, Add user, Account settings and /welcome/password; light and dark; 1440 and 375", async ({ page, browser, baseURL }) => {
    test.setTimeout(300_000);
    const owes = await fixtureUser("finance_staff", "Axe", { mustChangePassword: true });
    const them = await browser.newContext();
    const p = await them.newPage();
    try {
      await login(page, ADMIN);
      await signIn(p, owes.email, SEED_PASSWORD);
      await expect(p).toHaveURL(/\/welcome\/password$/);
      for (const theme of ["light", "dark"] as const) {
        await page.context().addCookies([{ name: "br.theme", value: theme, url: baseURL! }]);
        await them.addCookies([{ name: "br.theme", value: theme, url: baseURL! }]);
        for (const width of [1440, 375]) {
          const at = `${theme}, ${width} px`;
          await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
          await p.setViewportSize({ width, height: width === 375 ? 812 : 900 });

          await openUsers(page, width === 375 ? "" : `?sel=${owes.id}`);
          await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
          expect(await seriousViolations(page), `axe on Users & access (${at})`).toEqual([]);

          await page.getByRole("button", { name: "Add user", exact: true }).click();
          await expect(page.getByRole("dialog", { name: "Add user" })).toBeVisible();
          expect(await seriousViolations(page), `axe on Add user (${at})`).toEqual([]);
          await page.getByRole("dialog", { name: "Add user" }).getByRole("button", { name: "Cancel", exact: true }).click();

          await page.goto("/settings/account");
          await waitForHydration(page.getByRole("button", { name: "Change password", exact: true }));
          await page.getByRole("button", { name: "Change password", exact: true }).click();
          await expect(page.getByLabel("Current password", { exact: true })).toBeVisible();
          expect(await seriousViolations(page), `axe on Account settings (${at})`).toEqual([]);

          await p.goto("/welcome/password");
          await expect(p.locator("html")).toHaveAttribute("data-theme", theme);
          await expect(p.getByRole("heading", { name: "Choose your own password", level: 1 })).toBeVisible();
          expect(await seriousViolations(p), `axe on /welcome/password (${at})`).toEqual([]);
          await expectNoSidewaysScroll(p, `/welcome/password (${at})`);
        }
      }
    } finally {
      await them.close();
    }
  });
});
