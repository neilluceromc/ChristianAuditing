import { beforeAll, describe, expect, it } from "vitest";
import { STATUSES_BY_CLASS } from "@/lib/asset-class";
import { computeLoadout, resolvePolicy } from "@/lib/loadout";
import { generateScaleData, type ScaleContext, type ScaleData } from "./generators";

/** The normal seed's reference rows, by name (prisma/seed.ts); ids are stand-ins. */
const TYPES: Record<string, [cls: "IT" | "PURCHASING", types: string[]]> = {
  Laptop: ["IT", ["Standard", "High-performance", "MacBook"]],
  "Workstation (PC)": ["IT", ["Desktop tower", "Mini PC", "All-in-one"]],
  Monitor: ["IT", ["24-inch", "27-inch"]],
  Headset: ["IT", ["Wired", "Wireless"]],
  Mouse: ["IT", ["Wired", "Wireless"]],
  Keyboard: ["IT", ["Wired", "Wireless"]],
  Webcam: ["IT", ["USB webcam", "Conference camera"]],
  UPS: ["IT", ["Desktop UPS", "Rack UPS"]],
  "Windows License": ["IT", ["OEM", "Retail", "Volume"]],
  "Laptop Bag": ["IT", ["Backpack", "Sleeve"]],
  Other: ["IT", ["Phone", "Speaker", "Printer", "Docking Station", "Type C Hub"]],
  Vehicle: ["PURCHASING", ["Sedan", "Van"]],
  Furniture: ["PURCHASING", ["Desk", "Chair"]],
  "Pantry Equipment": ["PURCHASING", ["Microwave", "Air purifier"]],
  Building: ["PURCHASING", ["Floor", "Warehouse"]],
};
const typeId = (cat: string, type: string) => `type-${cat}-${type}`;
const slot = (cat: string, type: string, required = true) => ({ assetTypeId: typeId(cat, type), required, loaner: false });
const ctx: ScaleContext = {
  categories: Object.fromEntries(Object.entries(TYPES).map(([name, [cls, types]]) => [
    name, { id: `cat-${name}`, cls, types: Object.fromEntries(types.map((t) => [t, `type-${name}-${t}`])) },
  ])),
  vendors: Object.fromEntries(["TechServe PH", "Octagon Repairs", "Metro Office Supply", "Quezon Furniture Works", "Old Line Trading"].map((v) => [v, `vendor-${v}`])),
  departments: {
    IT: { id: "dept-IT", kind: "INTERNAL" }, Finance: { id: "dept-Finance", kind: "INTERNAL" }, Sales: { id: "dept-Sales", kind: "INTERNAL" },
    HR: { id: "dept-HR", kind: "INTERNAL" }, Operations: { id: "dept-Operations", kind: "INTERNAL" },
    "Bluepeak Telecom": { id: "dept-Bluepeak", kind: "CLIENT" }, "Harborline Billing": { id: "dept-Harborline", kind: "CLIENT" },
  },
  fixedUsers: {
    admin: { id: "user-admin", name: "System Admin" }, it: { id: "user-it", name: "J. Sarmiento" },
    purchasing: { id: "user-purchasing", name: "A. Reyes" }, finance: { id: "user-finance", name: "L. Domingo" },
  },
  // the normal seed's two policies (prisma/seed.ts)
  policies: [
    { id: "policy-finance", name: "Finance standard", appliesToDepartmentId: "dept-Finance", appliesToTitle: null, slots: [
      slot("Laptop", "Standard"), slot("Monitor", "24-inch"), slot("Other", "Docking Station"), slot("Headset", "Wired"),
      slot("Other", "Phone"), slot("Monitor", "27-inch", false),
    ] },
    { id: "policy-bluepeak", name: "Bluepeak Telecom", appliesToDepartmentId: "dept-Bluepeak", appliesToTitle: null, slots: [
      slot("Workstation (PC)", "Mini PC"), slot("Monitor", "24-inch"), slot("Monitor", "24-inch"), slot("Headset", "Wired"),
    ] },
  ],
};
const NOW = new Date("2026-10-19T03:00:00.000Z");

/** The normal seed's fixed rows the totals are counted with (prisma/seed.ts). */
const FIXED_EMPLOYEES = 10;
const FIXED_IT_STATUSES: Record<string, number> = { DEPLOYED: 8, SPARE: 5, DEFECTIVE: 6, DONATED: 1, BUYOUT: 1, DISPOSE: 1, MISSING: 1, TEMPORARY: 2 };
const FIXED_PURCHASING = 7;
const FIXED_ASSETS = 25 + FIXED_PURCHASING;

const t = (d: unknown) => new Date(d as Date).getTime();
const count = <T>(rows: T[], pred: (r: T) => boolean) => rows.filter(pred).length;
const OPEN = ["PENDING", "CLAIMED", "APPROVED"];

let data: ScaleData;
beforeAll(() => { data = generateScaleData(ctx, NOW); });

describe("generateScaleData (Phase 43 spec §3)", () => {
  it("gives identical output for the same seed and clock, and different output for another seed", () => {
    expect(generateScaleData(ctx, NOW)).toEqual(data);
    expect(generateScaleData(ctx, NOW, 44).employees[0]).not.toEqual(data.employees[0]);
  });

  it("adds 590 employees (600 with the fixed 10) numbered EMP-1000+ without repeats", () => {
    expect(data.employees).toHaveLength(590);
    expect(data.employees.length + FIXED_EMPLOYEES).toBe(600);
    const nos = data.employees.map((e) => e.employeeNo);
    expect(new Set(nos).size).toBe(nos.length);
    for (const no of nos) {
      expect(no).toMatch(/^EMP-\d{4}$/);
      expect(Number(no.slice(4))).toBeGreaterThanOrEqual(1000);
    }
  });

  it("has the spec's people mix: ~70 % client staff, 5 % offboarding (some overdue), 5 % offboarded, 10 new hires", () => {
    const clientIds = new Set([...data.departments.filter((d) => d.kind === "CLIENT").map((d) => d.id), "dept-Bluepeak", "dept-Harborline"]);
    expect(count(data.employees, (e) => clientIds.has(e.departmentId)) / 600).toBeCloseTo(0.7, 1);
    const offboarding = data.employees.filter((e) => e.employment === "OFFBOARDING");
    expect(offboarding.length + 1).toBe(30);
    expect(count(offboarding, (e) => t(e.offboardingDueAt) < NOW.getTime())).toBeGreaterThan(0);
    expect(count(data.employees, (e) => e.employment === "OFFBOARDED") + 1).toBe(30);
    expect(count(data.employees, (e) => t(e.joinedAt) > NOW.getTime() - 30 * 86_400_000) + 2).toBe(10);
  });

  it("adds 968 assets — 1,000 with the normal seed's 32 — about 900 IT and 100 Purchasing", () => {
    expect(data.assets).toHaveLength(968);
    expect(data.assets.length + FIXED_ASSETS).toBe(1000);
    const it = count(data.assets, (a) => a.cls === "IT") + 25;
    expect(Math.abs(it / 1000 - 0.9)).toBeLessThanOrEqual(0.02);
  });

  it("keeps the IT status mix within ±2 points of 70 % DEPLOYED, 18 % SPARE, 4 % DEFECTIVE, 2 % MISSING", () => {
    const it = data.assets.filter((a) => a.cls === "IT");
    const share = (s: string) => (count(it, (a) => a.status === s) + (FIXED_IT_STATUSES[s] ?? 0)) / (it.length + 25);
    expect(Math.abs(share("DEPLOYED") - 0.7)).toBeLessThanOrEqual(0.02);
    expect(Math.abs(share("SPARE") - 0.18)).toBeLessThanOrEqual(0.02);
    expect(Math.abs(share("DEFECTIVE") - 0.04)).toBeLessThanOrEqual(0.02);
    expect(Math.abs(share("MISSING") - 0.02)).toBeLessThanOrEqual(0.02);
  });

  it("gives every status a value from its class's set", () => {
    for (const a of data.assets) expect(STATUSES_BY_CLASS[a.cls!] as readonly string[]).toContain(a.status);
  });

  it("gives every DEPLOYED or TEMPORARY asset a holder who has not left, and nothing else an IT holder", () => {
    const people = new Map(data.employees.map((e) => [e.id, e]));
    for (const a of data.assets) {
      if (a.status === "DEPLOYED" || a.status === "TEMPORARY") {
        expect(a.assigneeId).toBeTruthy();
        expect(people.get(a.assigneeId!)?.employment).not.toBe("OFFBOARDED");
      } else if (a.cls === "IT") {
        expect(a.assigneeId ?? null).toBeNull();
      }
    }
    for (const e of data.employees.filter((x) => x.employment === "OFFBOARDING")) {
      expect(data.assets.some((a) => a.assigneeId === e.id)).toBe(true);
    }
    for (const a of data.assets.filter((x) => x.status === "TEMPORARY")) expect(a.loanDueAt).toBeTruthy();
  });

  it("leaves policy gaps for a minority (20–40 %) of the active people a policy applies to", () => {
    const defs = [
      ...ctx.policies,
      ...data.policies.map((p) => ({
        id: p.id!, name: p.name, appliesToDepartmentId: p.appliesToDepartmentId ?? null, appliesToTitle: p.appliesToTitle ?? null,
        slots: data.policySlots.filter((s) => s.policyId === p.id).map((s) => ({ assetTypeId: s.assetTypeId ?? null, required: s.required ?? true, loaner: s.loaner ?? false })),
      })),
    ];
    const members = data.employees
      .filter((e) => e.employment === "ACTIVE")
      .map((e) => ({ e, policy: resolvePolicy({ title: e.title, departmentId: e.departmentId }, defs) }))
      .filter((m) => m.policy !== null);
    expect(members.length).toBeGreaterThan(400);
    const gaps = members.filter(({ e, policy }) => {
      const held = data.assets.filter((a) => a.assigneeId === e.id)
        .map((a) => ({ id: a.id!, tag: a.tag, model: a.model, typeId: a.typeId ?? null, status: a.status! }));
      const slots = policy!.slots.map((s, i) => ({ id: String(i), name: String(i), ...s }));
      return computeLoadout(slots, held).missingRequired > 0;
    }).length;
    expect(gaps / members.length).toBeGreaterThanOrEqual(0.2);
    expect(gaps / members.length).toBeLessThanOrEqual(0.4);
    // 622 DEPLOYED devices for ~530 active people: most hold something, a minority wait for kit
    const holders = new Set(data.assets.map((a) => a.assigneeId));
    const active = count(data.employees, (e) => e.employment === "ACTIVE");
    expect(count(data.employees, (e) => e.employment === "ACTIVE" && !holders.has(e.id!))).toBeLessThan(active / 3);
  });

  it("uses unique tags (BR-xx-1000+), serials and refNos (PR-1000+, APR-5000+)", () => {
    const tags = data.assets.map((a) => a.tag);
    expect(new Set(tags).size).toBe(tags.length);
    for (const tag of tags) {
      const m = /^BR-[A-Z]{2}-(\d{4})$/.exec(tag);
      expect(m, tag).not.toBeNull();
      expect(Number(m![1])).toBeGreaterThanOrEqual(1000);
    }
    const serials = data.assets.map((a) => a.serial).filter(Boolean);
    expect(new Set(serials).size).toBe(serials.length);
    const prs = data.purchaseRequests.map((p) => p.refNo);
    expect(new Set(prs).size).toBe(prs.length);
    for (const no of prs) expect(Number(/^PR-(\d{4})$/.exec(no)![1])).toBeGreaterThanOrEqual(1000);
    const aprs = data.approvals.map((a) => a.refNo);
    expect(new Set(aprs).size).toBe(aprs.length);
    for (const no of aprs) expect(Number(/^APR-(\d{4,})$/.exec(no)![1])).toBeGreaterThanOrEqual(5000);
    expect(data.sequences.approval).toBe(5000 + aprs.length - 1);
    expect(data.sequences.purchaseRequest).toBe(1000 + prs.length - 1);
  });

  it("writes about 40,000 audit rows, all inside the last six months", () => {
    expect(Math.abs(data.auditEntries.length - 40_000)).toBeLessThanOrEqual(2_000);
    const sixMonthsAgo = new Date(NOW); sixMonthsAgo.setUTCMonth(sixMonthsAgo.getUTCMonth() - 6);
    for (const a of data.auditEntries) {
      expect(t(a.createdAt)).toBeGreaterThan(sixMonthsAgo.getTime());
      expect(t(a.createdAt)).toBeLessThanOrEqual(NOW.getTime());
    }
    const actions = new Set(data.auditEntries.map((a) => a.action));
    for (const a of ["lifecycle.assign", "lifecycle.return", "lifecycle.change-status", "update", "offboarding.completed", "note.added"]) {
      expect(actions).toContain(a);
    }
    const cancels = data.auditEntries.filter((a) => a.entityType === "purchase-request" && a.action === "cancel");
    for (const c of cancels) expect((c.diff as Record<string, { to: unknown }>).reason?.to).toBeTruthy();
    // nothing is written about a leaver after their offboarding was completed, except that completion itself
    const done = new Map(data.employees.filter((e) => e.employment === "OFFBOARDED").map((e) => [e.id, e]));
    const completedAt = new Map(data.auditEntries.filter((a) => a.action === "offboarding.completed").map((a) => [a.entityId, t(a.createdAt)]));
    for (const a of data.auditEntries) {
      if (a.entityType === "employee" && done.has(a.entityId) && a.action !== "offboarding.completed") {
        expect(t(a.createdAt)).toBeLessThan(completedAt.get(a.entityId)!);
      }
    }
  });

  it("holds at most one open approval and one ACTIVE reservation per asset, never both on one asset", () => {
    const open = data.approvals.filter((a) => OPEN.includes(a.state!));
    expect(open.length).toBeGreaterThanOrEqual(35);
    expect(open.length).toBeLessThanOrEqual(45);
    const overdue = count(open, (a) => t(a.slaAt) < NOW.getTime());
    expect(overdue).toBeGreaterThan(0);
    expect(overdue).toBeLessThanOrEqual(10);
    const openAssets = open.map((a) => a.assetId);
    expect(new Set(openAssets).size).toBe(openAssets.length);
    const held = data.reservations.filter((r) => r.state === "ACTIVE").map((r) => r.assetId);
    expect(new Set(held).size).toBe(held.length);
    expect(held.filter((id) => openAssets.includes(id))).toEqual([]);
    expect(data.reservations.length).toBeGreaterThanOrEqual(180);
    expect(held.length).toBeGreaterThanOrEqual(15);
  });

  it("records about 3,000 EXECUTED direct changes", () => {
    const executed = data.approvals.filter((a) => a.state === "EXECUTED");
    expect(Math.abs(executed.length - 3000)).toBeLessThanOrEqual(150);
    for (const a of executed) expect(a.appliedDirectly).toBe(true);
  });

  it("ends each held asset's history on its current holder", () => {
    const people = new Map(data.employees.map((e) => [e.id, e.employeeNo]));
    const lastAssign = new Map<string, unknown>();
    for (const a of data.auditEntries) {
      if (a.entityType !== "asset") continue;
      const assignee = (a.diff as Record<string, { to: unknown }> | undefined)?.assignee;
      if (a.action.startsWith("lifecycle.") && assignee) lastAssign.set(a.entityId, assignee.to);
    }
    for (const a of data.assets) {
      if (!lastAssign.has(a.id!)) continue;
      expect(lastAssign.get(a.id!)).toBe(a.assigneeId ? people.get(a.assigneeId) : null);
    }
  });

  it("references only rows it creates or the context provides", () => {
    const ids = new Set([
      ...data.employees.map((e) => e.id), ...data.assets.map((a) => a.id), ...data.purchaseRequests.map((p) => p.id),
      ...data.approvals.map((a) => a.id), ...data.users.map((u) => u.id), ...data.departments.map((d) => d.id),
      ...Object.values(ctx.fixedUsers).map((u) => u.id), ...Object.values(ctx.departments).map((d) => d.id),
    ]);
    const missing = (list: unknown[]) => list.filter((id) => !ids.has(id as string));
    expect(missing(data.assets.filter((a) => a.assigneeId).map((a) => a.assigneeId))).toEqual([]);
    expect(missing(data.approvals.flatMap((a) => [a.assetId, a.requestedById, ...(a.employeeId ? [a.employeeId] : [])]))).toEqual([]);
    expect(missing(data.reservations.flatMap((r) => [r.assetId, r.employeeId]))).toEqual([]);
    expect(missing(data.auditEntries.flatMap((a) => [a.entityId, a.actorId]))).toEqual([]);
    expect(missing(data.employees.map((e) => e.departmentId))).toEqual([]);
  });

  it("satisfies the asset CHECK constraints and leaves Purchasing assets unverified", () => {
    for (const a of data.assets) {
      if (a.financeNotCapitalised) { expect(a.cost ?? null).toBeNull(); expect(a.financeConfirmedAt).toBeTruthy(); }
      expect(a.depreciationLifeMonths == null).toBe(a.depreciationSalvage == null);
      if (a.cls === "PURCHASING") expect(a.itVerifiedAt ?? null).toBeNull();
    }
    expect(count(data.assets, (a) => a.cls === "IT" && !a.itVerifiedAt)).toBe(10);
  });

  it("covers every purchase request state with 1–5 units each, and the 15 test accounts", () => {
    expect(new Set(data.purchaseRequests.map((p) => p.state))).toEqual(new Set(["DRAFT", "SUBMITTED", "IT_REVIEWED", "COMPLETED", "CANCELLED"]));
    expect(data.purchaseRequests).toHaveLength(150);
    for (const p of data.purchaseRequests) {
      const n = count(data.purchaseUnits, (u) => u.requestId === p.id);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(5);
    }
    expect(data.users.map((u) => u.email)).toEqual(Array.from({ length: 15 }, (_, i) => `perf${String(i + 1).padStart(2, "0")}@thebackroomop.com`));
    expect(data.users.map((u) => u.role)).toEqual([...Array(10).fill("it_staff"), "purchasing_staff", "purchasing_staff", "finance_staff", "finance_staff", "admin"]);
    expect(data.employeeNotes).toHaveLength(1500);
    expect(count(data.departments, (d) => d.kind === "CLIENT") + 2).toBe(40);
  });
});
