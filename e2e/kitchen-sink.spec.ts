import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.describe("kitchen sink", () => {
  test("renders and passes axe in light theme", async ({ page }) => {
    await page.goto("/dev/kitchen-sink");
    await expect(page.getByRole("heading", { name: "Kitchen sink" })).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious).toEqual([]);
  });

  test("passes axe in dark theme", async ({ page }) => {
    await page.goto("/dev/kitchen-sink");
    await page.getByRole("button", { name: /Switch to dark/ }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const results = await new AxeBuilder({ page }).analyze();
    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious).toEqual([]);
  });

  test("density toggle changes row height only", async ({ page }) => {
    await page.goto("/dev/kitchen-sink");
    const row = page.getByRole("row").nth(1);
    const before = (await row.boundingBox())!.height;
    await page.getByRole("button", { name: /Switch to compact/ }).click();
    const after = (await row.boundingBox())!.height;
    expect(Math.round(before)).toBe(41);
    expect(Math.round(after)).toBe(33);
  });

  test("dialog traps focus and closes on ESC", async ({ page }) => {
    await page.goto("/dev/kitchen-sink");
    await page.getByRole("button", { name: "Open dialog" }).click();
    await expect(page.getByRole("dialog", { name: "Cancel request PR-0198?" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // focus returned to the trigger
    await expect(page.getByRole("button", { name: "Open dialog" })).toBeFocused();
    // scroll lock fully released (regression guard: saved-overflow clobbering)
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
  });

  test("drawer closes on ESC and releases the scroll lock", async ({ page }) => {
    await page.goto("/dev/kitchen-sink");
    await page.getByRole("button", { name: "Open drawer" }).click();
    await expect(page.getByRole("dialog", { name: "Fill slot — headset" })).toBeVisible();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
  });
});
