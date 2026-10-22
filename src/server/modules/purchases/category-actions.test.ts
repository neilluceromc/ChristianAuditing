import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * PO form redesign Task 3 (spec §2.7, §5, §5b.6–7): Purchasing (and admin) create a category on the spot from the PO
 * form. An office item is confirmed at once; IT gear waits for IT at Register. A same-class name reuses the category,
 * an other-class name is refused — category names are unique across both classes.
 */

const h = vi.hoisted(() => ({
  user: null as { id: string; name: string; role: string } | null,
  cats: [] as Array<Record<string, unknown>>,
  audits: [] as Array<Record<string, unknown>>,
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/server/auth/guards", () => ({
  actionUser: async () => h.user,
  actionRole: async (...roles: string[]) => (h.user && roles.includes(h.user.role) ? h.user : null),
}));
vi.mock("@/server/rate-limit", () => ({ checkRate: async () => ({ allowed: true, retryAfterSec: 0 }) }));
vi.mock("@/server/audit", () => ({ writeAudit: async (_tx: unknown, e: Record<string, unknown>) => { h.audits.push(e); } }));
vi.mock("@/server/db/client", () => {
  type W = { name?: { equals: string; mode: "insensitive" } };
  const assetCategory = {
    findFirst: async ({ where }: { where: W }) => {
      const want = where.name?.equals.toLowerCase();
      const r = h.cats.find((c) => String(c.name).toLowerCase() === want);
      return r ? { ...r } : null;
    },
    findMany: async () => [...h.cats]
      .sort((a, b) => String(a.cls).localeCompare(String(b.cls)) || String(a.name).localeCompare(String(b.name)))
      .map((c) => ({ ...c })),
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `cat-${h.cats.length + 1}`, ...data };
      h.cats.push(row);
      return { ...row };
    },
  };
  return { prisma: { assetCategory, $transaction: async (fn: (tx: unknown) => unknown) => fn({ assetCategory }) } };
});

import { createCategoryFromPo } from "./category-actions";
import { poCategories } from "./po-categories";

const PAT = { id: "u-pat", name: "Pat Lim", role: "purchasing_staff" };
const ADA = { id: "u-ada", name: "Ada Admin", role: "admin" };
const IVAN = { id: "u-ivan", name: "Ivan Tan", role: "it_staff" };
const VIC = { id: "u-vic", name: "Vic Viewer", role: "viewer" };
const CONFIRMED = new Date("2026-01-01T00:00:00Z");

beforeEach(() => {
  h.user = PAT;
  h.audits = [];
  h.cats = [
    { id: "cat-lt", name: "Laptops", cls: "IT", confirmedAt: CONFIRMED },
    { id: "cat-nc", name: "Network cable", cls: "PURCHASING", confirmedAt: CONFIRMED },
  ];
});

describe("createCategoryFromPo", () => {
  it("create IT → unconfirmed, office → confirmed", async () => {
    const it1 = await createCategoryFromPo({ name: "  switch  ", cls: "IT" });
    expect(it1).toEqual({ ok: true, data: { id: expect.any(String), name: "Switch", cls: "IT", confirmed: false, reused: false } });
    const sw = h.cats.find((c) => c.name === "Switch")!;
    // The DB default is now(): an IT category from a PO passes null explicitly.
    expect(Object.hasOwn(sw, "confirmedAt")).toBe(true);
    expect(sw.confirmedAt).toBeNull();
    expect(sw).toMatchObject({ cls: "IT", createdById: PAT.id });

    const office = await createCategoryFromPo({ name: "whiteboard", cls: "PURCHASING" });
    expect(office).toEqual({ ok: true, data: { id: expect.any(String), name: "Whiteboard", cls: "PURCHASING", confirmed: true, reused: false } });
    const wb = h.cats.find((c) => c.name === "Whiteboard")!;
    expect(wb.confirmedAt).toBeInstanceOf(Date);
    expect(wb.createdById).toBe(PAT.id);

    expect(h.audits).toHaveLength(2);
    expect(h.audits[0]).toMatchObject({
      actorId: PAT.id, entityType: "asset-category", entityId: sw.id, action: "category.create", source: "web",
      diff: { name: { from: null, to: "Switch" }, cls: { from: null, to: "IT" } },
    });
    expect(h.audits[1]).toMatchObject({ action: "category.create", entityId: wb.id, source: "web" });
  });

  it("an admin may create either class too", async () => {
    h.user = ADA;
    const r = await createCategoryFromPo({ name: "Patch panel", cls: "IT" });
    expect(r).toMatchObject({ ok: true, data: { cls: "IT", confirmed: false, reused: false } });
    expect(h.cats.at(-1)).toMatchObject({ name: "Patch panel", createdById: ADA.id });
  });

  it("reuse same class, refuse other class", async () => {
    // Same class, any case: the existing category comes back and nothing is written.
    const same = await createCategoryFromPo({ name: "LAPTOPS", cls: "IT" });
    expect(same).toEqual({ ok: true, data: { id: "cat-lt", name: "Laptops", cls: "IT", confirmed: true, reused: true } });
    const sameOffice = await createCategoryFromPo({ name: "network CABLE", cls: "PURCHASING" });
    expect(sameOffice).toEqual({ ok: true, data: { id: "cat-nc", name: "Network cable", cls: "PURCHASING", confirmed: true, reused: true } });

    // An unconfirmed IT category is reused as it is (still unconfirmed) — no near-duplicate.
    h.cats.push({ id: "cat-sw", name: "Switch", cls: "IT", confirmedAt: null });
    const unconfirmed = await createCategoryFromPo({ name: "switch", cls: "IT" });
    expect(unconfirmed).toEqual({ ok: true, data: { id: "cat-sw", name: "Switch", cls: "IT", confirmed: false, reused: true } });

    // Other class: refused, with the exact message, both ways.
    const asIt = await createCategoryFromPo({ name: "network cable", cls: "IT" });
    expect(asIt).toMatchObject({
      ok: false, kind: "validation",
      fieldErrors: { name: "'Network cable' already exists as an Office item — pick it from the list." },
    });
    const asOffice = await createCategoryFromPo({ name: "laptops", cls: "PURCHASING" });
    expect(asOffice).toMatchObject({
      ok: false, kind: "validation",
      fieldErrors: { name: "'Laptops' already exists as IT gear — pick it from the list." },
    });

    expect(h.cats).toHaveLength(3);
    expect(h.audits).toEqual([]);
  });

  it("viewer and IT can't create", async () => {
    for (const who of [VIC, IVAN, { ...PAT, role: "finance_staff" }]) {
      h.user = who;
      expect(await createCategoryFromPo({ name: "Switch", cls: "IT" })).toMatchObject({ ok: false, kind: "forbidden" });
    }
    h.user = null;
    expect(await createCategoryFromPo({ name: "Switch", cls: "IT" })).toMatchObject({ ok: false, kind: "forbidden" });
    expect(h.cats).toHaveLength(2);
    expect(h.audits).toEqual([]);
  });

  it("capitalises a plain first letter only: 'iPhone case' stays as typed (final review M6)", async () => {
    const made = async (name: string) => {
      const r = await createCategoryFromPo({ name, cls: "IT" });
      return r.ok ? r.data.name : `refused: ${JSON.stringify(r)}`;
    };
    expect(await made("iPhone case")).toBe("iPhone case");
    expect(await made("eBay voucher")).toBe("eBay voucher");
    expect(await made("patch panel")).toBe("Patch panel");
    expect(await made("x1 hub")).toBe("X1 hub");
    expect(await made("éclair stand")).toBe("Éclair stand");
    expect(await made("4K monitor")).toBe("4K monitor");
    expect(await made("USB hub")).toBe("USB hub");
  });

  it("the name is 2–60 characters after trimming", async () => {
    expect(await createCategoryFromPo({ name: " x ", cls: "IT" })).toMatchObject({ ok: false, kind: "validation", fieldErrors: { name: expect.any(String) } });
    expect(await createCategoryFromPo({ name: "y".repeat(61), cls: "IT" })).toMatchObject({ ok: false, kind: "validation" });
    expect(await createCategoryFromPo({ name: "Switch", cls: "STOCK" })).toMatchObject({ ok: false, kind: "validation" });
    expect(h.cats).toHaveLength(2);
  });
});

describe("poCategories", () => {
  it("lists every category, confirmed or not, by class then name", async () => {
    h.cats.push({ id: "cat-sw", name: "Switch", cls: "IT", confirmedAt: null });
    h.cats.push({ id: "cat-ac", name: "Aircon", cls: "PURCHASING", confirmedAt: CONFIRMED });
    expect(await poCategories()).toEqual([
      { id: "cat-lt", name: "Laptops", cls: "IT", confirmed: true },
      { id: "cat-sw", name: "Switch", cls: "IT", confirmed: false },
      { id: "cat-ac", name: "Aircon", cls: "PURCHASING", confirmed: true },
      { id: "cat-nc", name: "Network cable", cls: "PURCHASING", confirmed: true },
    ]);
  });
});
