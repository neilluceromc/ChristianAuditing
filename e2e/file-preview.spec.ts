import { test, expect, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { login } from "./fixtures/login";
import { fillMinimalPo, INVOICE_PNG, invoiceFile, RECEIPT_PDF, savePo, waitForPoForm } from "./fixtures/po-form";

/**
 * Document preview and upload times (plan docs/superpowers/plans/2026-10-23-document-preview.md, Task 3), in a real
 * browser. One file is uploaded through its own page on each of the five download routes — a PO's sales invoice (PNG),
 * a vendor's registration record (PDF), a car's receipt (PDF), a stock lot's delivery receipt (PDF) and an
 * employee's signed form (PNG) — and then:
 *   1  every route answers `?inline=1` with `inline` and `nosniff`, and plain with `attachment`
 *   2  on each page, Preview opens a real modal dialog named after the file, described by its "Uploaded …" line, with
 *      focus inside; the frame or image loads (200, inline); a real PDF stays shown; Esc closes it and focus goes
 *      back to Preview
 *   3  a stored object that has gone missing shows "Couldn't load this file" and Download (a PDF frame and an image)
 *   4  a file held on the new-PO form previews with "Not saved yet", and closing revokes its object URL
 *   5  at 375 px, Open in new tab and Download are on screen
 *   6  axe passes on the open dialog in light, dark and at 375 px
 *
 * Headless Chromium may have no PDF viewer, so a PDF frame may stay blank; that is not an error, and the test only
 * asserts that "Couldn't load this file" never shows for one. Esc is pressed with focus on the dialog itself: inside a
 * PDF frame the viewer owns the keyboard (a known iframe limit).
 *
 * Fixtures are made through the UI after the reseed; ids are read back from the database, never hard-coded.
 */

const db = new PrismaClient();

const PURCHASING = "purchasing@thebackroomop.com";
const IT = "it@thebackroomop.com";

const PDF_BYTES = readFileSync(RECEIPT_PDF);
const PNG_BYTES = readFileSync(INVOICE_PNG);
const UPLOADED = /Uploaded \d{1,2} \w{3} \d{4} \d{2}:\d{2}/;
const FAILED = "Couldn't load this file";

type Key = "po" | "vendor" | "asset" | "lot" | "form";

/** One previewable file: where its Preview button lives, who sees it, and its download route. */
interface Surface {
  key: Key;
  user: string;
  /** The page with the Preview button. */
  page: string;
  /** The Preview button on that page. */
  button: (page: Page) => Locator;
  /** The dialog's name: the file's title. */
  title: string;
  fileName: string;
  kind: "pdf" | "image";
  /** The download route (no query). */
  href: string;
}

const surfaces = {} as Record<Key, Surface>;
/** The rows the "missing object" case points elsewhere (and puts back). */
const rows = { assetDocId: "", ackId: "" };

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  execSync("npm run db:seed", { timeout: 120_000 });
  await db.userPreference.deleteMany({ where: { key: "ui:prefs" } });
});

test.afterAll(async () => {
  await db.userPreference.deleteMany({ where: { key: "ui:prefs" } });
  await db.$disconnect();
});

async function waitForHydration(target: Locator) {
  const el = target.first();
  await el.waitFor({ state: "attached", timeout: 30_000 });
  await expect(async () => {
    expect(await el.evaluate((node) => Object.keys(node).some((k) => k.startsWith("__reactFiber$")))).toBe(true);
  }).toPass({ timeout: 30_000 });
}

async function setCookie(page: Page, name: string, value: string) {
  await page.context().addCookies([{ name, value, url: new URL(page.url()).origin }]);
}

/** The Card whose own h2 reads `title` (as e2e/stock-lots.spec.ts finds the Lots card). */
const cardSection = (page: Page, title: string) =>
  page.getByRole("heading", { name: title, exact: true, level: 2 }).locator("xpath=../..");

const viewer = (page: Page, title: string) => page.getByRole("dialog", { name: title, exact: true });

/** Goes to the surface's page and opens its Preview; returns the dialog. */
async function openPreview(page: Page, s: Surface): Promise<Locator> {
  await page.goto(s.page);
  const button = s.button(page);
  await waitForHydration(button);
  await button.click();
  const dialog = viewer(page, s.title);
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  return dialog;
}

const PROMOTED_RULES = new Set<string>(["empty-table-header", "page-has-heading-one", "heading-order", "landmark-unique"]);
/**
 * axe on the open dialog only: moderate and above count, and so does any promoted rule. The PDF frame's own document
 * is the browser's own (headless Chromium: an empty text/html page with no PDF viewer; a desktop browser: its viewer),
 * not the app's markup, so what axe reports inside it is set aside; the frame element itself (its title) still counts.
 */
async function axeProblems(page: Page, label: string): Promise<string[]> {
  await page.waitForTimeout(700);
  const results = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  return results.violations
    .filter((v) =>
      v.impact === "moderate" || v.impact === "serious" || v.impact === "critical" || PROMOTED_RULES.has(v.id))
    // a node inside the frame has a target of two selectors (the frame, then the node): the browser's page, not ours
    .map((v) => ({ ...v, nodes: v.nodes.filter((n) => n.target.length === 1) }))
    .filter((v) => v.nodes.length > 0)
    .map((v) => `${label}: ${v.id} (${v.impact}) ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

test("0 · setup: one file uploaded through each of the five pages", async ({ page }) => {
  test.setTimeout(300_000);

  // a PO's sales invoice (PNG), saved with the new PO
  await login(page, PURCHASING);
  await page.goto("/purchases/new");
  await waitForPoForm(page);
  await fillMinimalPo(page, {
    vendor: "TechServe PH", poNumber: "2025-0701", si: "SI-90701", date: "2026-10-21",
    items: [{ description: "USB headsets", category: "Headset", qty: 2, unitPrice: "1,250.00" }],
    totalAmountDue: "2,500.00",
  });
  const po = await savePo(page);
  const poDoc = await db.requestDocument.findFirstOrThrow({ where: { orderId: po.id, kind: "invoice" } });
  surfaces.po = {
    key: "po", user: PURCHASING, page: `/purchases/${po.id}`,
    button: (p) => p.locator('[data-po-field="doc:invoice"]').getByRole("button", { name: "Preview" }),
    title: "Sales invoice", fileName: poDoc.fileName, kind: "image",
    href: `/purchases/${po.id}/documents/${poDoc.id}/download`,
  };

  // a vendor's registration record (PDF)
  const vendor = await db.vendor.findFirstOrThrow({ where: { name: "TechServe PH" } });
  await page.goto(`/purchases/suppliers/${vendor.id}`);
  const docKind = page.getByLabel("Document kind");
  await waitForHydration(docKind);
  await docKind.selectOption("registration");
  await page.getByLabel("Document file").setInputFiles({ name: "bir-2303.pdf", mimeType: "application/pdf", buffer: PDF_BYTES });
  await expect(page.getByRole("row", { name: /Registration record/ })).toBeVisible({ timeout: 15_000 });
  const vendorDoc = await db.vendorDocument.findFirstOrThrow({ where: { vendorId: vendor.id, fileName: "bir-2303.pdf" } });
  surfaces.vendor = {
    key: "vendor", user: PURCHASING, page: `/purchases/suppliers/${vendor.id}`,
    button: (p) => p.getByRole("row", { name: /Registration record/ }).getByRole("button", { name: "Preview bir-2303.pdf" }),
    title: "Registration record", fileName: "bir-2303.pdf", kind: "pdf",
    href: `/purchases/suppliers/${vendor.id}/documents/${vendorDoc.id}/download`,
  };

  // a car's receipt (PDF), on its Documents tab
  const car = await db.asset.findUniqueOrThrow({ where: { tag: "BR-VH-0001" } });
  await page.goto(`/inventory/${car.id}/documents`);
  // a file chosen before hydration never reaches React: choose again until the staged row shows (department-owned.spec.ts)
  await expect(async () => {
    await page.locator('input[type="file"]').setInputFiles({ name: "orcr-scan.pdf", mimeType: "application/pdf", buffer: PDF_BYTES });
    await expect(page.getByLabel("Document kind")).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await page.getByLabel("Document kind").selectOption("receipt");
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(page.getByRole("button", { name: "orcr-scan.pdf" })).toBeVisible({ timeout: 15_000 });
  const assetDoc = await db.assetDocument.findFirstOrThrow({ where: { assetId: car.id, fileName: "orcr-scan.pdf" } });
  rows.assetDocId = assetDoc.id;
  surfaces.asset = {
    key: "asset", user: PURCHASING, page: `/inventory/${car.id}/documents`,
    button: (p) => p.getByRole("button", { name: "orcr-scan.pdf", exact: true }),
    title: "Receipt", fileName: "orcr-scan.pdf", kind: "pdf",
    href: `/inventory/${car.id}/documents/${assetDoc.id}/download`,
  };

  // a stock lot's delivery receipt (PDF): OS-0001's seeded lot DR-1101
  const os0001 = await db.stockItem.findUniqueOrThrow({ where: { code: "OS-0001" } });
  await page.goto(`/stock/items/${os0001.id}`);
  const attach = cardSection(page, "Lots").getByRole("row", { name: /DR-1101/ }).getByRole("button", { name: "Attach document" });
  await waitForHydration(attach);
  await attach.click();
  const attachDialog = page.getByRole("dialog", { name: "Attach document" });
  await expect(attachDialog).toBeVisible({ timeout: 10_000 });
  await attachDialog.getByLabel("Kind").selectOption({ label: "Delivery receipt" });
  await attachDialog.getByLabel("File").setInputFiles({ name: "dr-1101.pdf", mimeType: "application/pdf", buffer: PDF_BYTES });
  await attachDialog.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByText("Success: Document attached", { exact: true })).toBeVisible({ timeout: 15_000 });
  const lot = await db.stockLot.findFirstOrThrow({ where: { itemId: os0001.id, reference: "DR-1101" } });
  const lotDoc = await db.stockLotDocument.findFirstOrThrow({ where: { lotId: lot.id } });
  surfaces.lot = {
    key: "lot", user: PURCHASING, page: `/stock/items/${os0001.id}`,
    button: (p) => cardSection(p, "Lots").getByRole("list", { name: "Lot documents" }).getByRole("button", { name: "Preview dr-1101.pdf" }),
    title: "Delivery receipt", fileName: "dr-1101.pdf", kind: "pdf",
    href: `/stock/lots/${lot.id}/documents/${lotDoc.id}/download`,
  };

  // an employee's signed form (PNG), recorded by IT on the side card's Form tab
  const person = await db.employee.findFirstOrThrow({ where: { department: { name: "Finance" }, employment: "ACTIVE" }, orderBy: { employeeNo: "asc" } });
  await login(page, IT);
  await page.goto(`/employees/${person.id}?side=form`);
  const record = page.getByRole("button", { name: "Record a signed form…" });
  await waitForHydration(record);
  await record.click();
  const recordDialog = page.getByRole("dialog", { name: "Record a signed form" });
  await expect(recordDialog).toBeVisible();
  await recordDialog.getByLabel("Signed form (scan or photo)").setInputFiles({ name: "signed-form.png", mimeType: "image/png", buffer: PNG_BYTES });
  await recordDialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Signed form recorded")).toBeVisible({ timeout: 15_000 });
  const ack = await db.acknowledgement.findFirstOrThrow({ where: { employeeId: person.id } });
  rows.ackId = ack.id;
  surfaces.form = {
    key: "form", user: IT, page: `/employees/${person.id}?side=form`,
    button: (p) => p.getByRole("button", { name: "Preview signed-form.png" }),
    title: "Signed form", fileName: "signed-form.png", kind: "image",
    href: `/employees/${person.id}/acknowledgements/${ack.id}/download`,
  };
});

test("1 · every download route: ?inline=1 is inline and nosniff; without it, an attachment", async ({ page }) => {
  await login(page, PURCHASING);
  for (const s of Object.values(surfaces)) {
    const inline = await page.request.get(`${s.href}?inline=1`);
    expect(inline.status(), `${s.key} inline`).toBe(200);
    expect(inline.headers()["content-type"], `${s.key} inline type`).toBe(s.kind === "pdf" ? "application/pdf" : "image/png");
    expect(inline.headers()["content-disposition"], `${s.key} inline disposition`).toMatch(/^inline;/);
    expect(inline.headers()["content-disposition"]).toContain(s.fileName);
    expect(inline.headers()["x-content-type-options"], `${s.key} inline nosniff`).toBe("nosniff");

    const plain = await page.request.get(s.href);
    expect(plain.status(), `${s.key} plain`).toBe(200);
    expect(plain.headers()["content-disposition"], `${s.key} plain disposition`).toMatch(/^attachment;/);
    expect(plain.headers()["x-content-type-options"], `${s.key} plain nosniff`).toBe("nosniff");
  }
});

for (const key of ["po", "vendor", "asset", "lot", "form"] as const) {
  test(`2 · ${key}: Preview is a real dialog with the upload time; the file loads inline; Esc closes it and focus returns`, async ({ page }) => {
    test.setTimeout(120_000);
    const s = surfaces[key];
    await login(page, s.user);
    const inlineHref = `${s.href}?inline=1`;
    // the frame's own navigation (an image's bytes may come from the thumbnail's cache, so it is checked below instead)
    const frameResponse = s.kind === "pdf"
      ? page.waitForResponse((r) => { const u = new URL(r.url()); return u.pathname + u.search === inlineHref; }, { timeout: 30_000 })
      : null;
    const dialog = await openPreview(page, s);

    // real dialog semantics: modal, named by the title, described by the line that holds "Uploaded …", focus inside
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    const describedBy = await dialog.getAttribute("aria-describedby");
    expect(describedBy, "aria-describedby is set").toBeTruthy();
    const description = page.locator(`[id="${describedBy}"]`);
    await expect(description).toHaveText(UPLOADED);
    await expect(description).toContainText(s.fileName);
    await expect.poll(() => dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);

    // the header: Open in new tab (the inline route, a new tab) and Download (the route), then Close
    const newTab = dialog.getByRole("link", { name: "Open in new tab" });
    await expect(newTab).toHaveAttribute("href", inlineHref);
    await expect(newTab).toHaveAttribute("target", "_blank");
    await expect(dialog.getByRole("link", { name: "Download", exact: true })).toHaveAttribute("href", s.href);
    await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeVisible();

    if (s.kind === "pdf") {
      const res = await frameResponse!;
      expect(res.status()).toBe(200);
      expect(res.headers()["content-disposition"]).toMatch(/^inline;/);
      const frame = dialog.locator(`iframe[title="${s.fileName}"]`);
      await expect(frame).toHaveAttribute("src", inlineHref);
      // a real PDF stays shown: give the load check time to run, then no failure (a blank frame is fine)
      await page.waitForTimeout(1_500);
      await expect(frame).toBeVisible();
      await expect(dialog.getByText(FAILED)).toHaveCount(0);
    } else {
      const img = dialog.getByRole("img", { name: s.fileName });
      await expect(img).toHaveAttribute("src", inlineHref);
      await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBe(120);
      const res = await page.request.get(inlineHref);
      expect(res.status()).toBe(200);
      expect(res.headers()["content-disposition"]).toMatch(/^inline;/);
      await expect(dialog.getByText(FAILED)).toHaveCount(0);
    }

    // Esc with focus on the dialog's own chrome (inside a PDF frame the viewer has the keyboard)
    await dialog.focus();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(s.button(page)).toBeFocused();

    // and once more from the header's Close button, which also hands focus back
    await s.button(page).click();
    await expect(viewer(page, s.title)).toBeVisible();
    await viewer(page, s.title).getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(s.button(page)).toBeFocused();
  });
}

test("3 · a stored object that has gone missing: Couldn't load this file, and Download", async ({ page }) => {
  test.setTimeout(120_000);
  const assetDoc = await db.assetDocument.findUniqueOrThrow({ where: { id: rows.assetDocId } });
  const ack = await db.acknowledgement.findUniqueOrThrow({ where: { id: rows.ackId } });
  // point each row at an object that was never stored; put them back afterwards
  await db.assetDocument.update({ where: { id: assetDoc.id }, data: { path: "e2e-missing/never-stored.pdf" } });
  await db.acknowledgement.update({ where: { id: ack.id }, data: { path: "e2e-missing/never-stored.png" } });
  try {
    // a PDF frame: the route's plain-text 404 is read and shown as a failure
    await login(page, PURCHASING);
    const missingPdf = await page.request.get(`${surfaces.asset.href}?inline=1`);
    expect(missingPdf.status()).toBe(404);
    let dialog = await openPreview(page, surfaces.asset);
    await expect(dialog.getByRole("alert")).toHaveText(FAILED, { timeout: 15_000 });
    await expect(dialog.getByRole("link", { name: "Download", exact: true })).toHaveAttribute("href", surfaces.asset.href);
    await expect(dialog.locator("iframe")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // an image: its error event
    await login(page, IT);
    dialog = await openPreview(page, surfaces.form);
    await expect(dialog.getByRole("alert")).toHaveText(FAILED, { timeout: 15_000 });
    await expect(dialog.getByRole("link", { name: "Download", exact: true })).toHaveAttribute("href", surfaces.form.href);
    await expect(dialog.getByRole("img")).toHaveCount(0);
  } finally {
    await db.assetDocument.update({ where: { id: assetDoc.id }, data: { path: assetDoc.path } });
    await db.acknowledgement.update({ where: { id: ack.id }, data: { path: ack.path } });
  }
  // restored: the file loads again
  expect((await page.request.get(`${surfaces.form.href}?inline=1`)).status()).toBe(200);
});

test("4 · a file held on the new-PO form previews with Not saved yet; closing revokes its object URL", async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    const w = window as unknown as { __revoked: string[] };
    w.__revoked = [];
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = (url: string) => {
      w.__revoked.push(url);
      revoke(url);
    };
  });
  await login(page, PURCHASING);
  await page.goto("/purchases/new");
  await waitForPoForm(page);
  await invoiceFile(page).setInputFiles(INVOICE_PNG);
  const slotEl = page.locator('[data-po-field="doc:invoice"]');
  await expect(slotEl).toContainText("Attached");

  const button = slotEl.getByRole("button", { name: "Preview sales-invoice.png" });
  await button.click();
  const dialog = viewer(page, "Sales invoice");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Not saved yet");
  await expect(dialog).not.toContainText("Uploaded");
  const img = dialog.getByRole("img", { name: "sales-invoice.png" });
  const src = (await img.getAttribute("src"))!;
  expect(src).toMatch(/^blob:http/);
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBe(120);
  expect(await page.evaluate(() => (window as unknown as { __revoked: string[] }).__revoked), "not revoked while open").not.toContain(src);

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __revoked: string[] }).__revoked)).toContain(src);
  await expect(button).toBeFocused();
});

test("5 · at 375 px the dialog fills the screen and Open in new tab and Download are on it", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await login(page, PURCHASING);
  for (const s of [surfaces.vendor, surfaces.po]) {
    const dialog = await openPreview(page, s);
    // full width once its opening animation (a scale from 0.84) has settled
    await expect.poll(async () => (await dialog.boundingBox())?.width ?? 0, { message: `${s.key} dialog width` }).toBeGreaterThanOrEqual(374);
    for (const name of ["Open in new tab", "Download"]) {
      const link = dialog.getByRole("link", { name, exact: true });
      await expect(link, `${s.key} ${name}`).toBeInViewport({ ratio: 1 });
    }
    await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeInViewport({ ratio: 1 });
    // nothing in the dialog runs off its side (the page behind it is not this spec's business)
    expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth), `${s.key}: no sideways overflow in the dialog`).toBe(true);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
});

test("6 · axe passes on the open dialog in light and dark, and at 375 px", async ({ page }) => {
  test.setTimeout(240_000);
  const problems: string[] = [];
  await login(page, PURCHASING);
  for (const theme of ["light", "dark"] as const) {
    await setCookie(page, "br.theme", theme);
    for (const s of [surfaces.vendor, surfaces.po]) {
      await openPreview(page, s);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      problems.push(...(await axeProblems(page, `${s.key} preview (${theme})`)));
    }
  }
  await setCookie(page, "br.theme", "light");
  await page.setViewportSize({ width: 375, height: 812 });
  for (const s of [surfaces.vendor, surfaces.po]) {
    await openPreview(page, s);
    problems.push(...(await axeProblems(page, `${s.key} preview (375 px)`)));
  }
  expect(problems, "axe (moderate and above)").toEqual([]);
});
