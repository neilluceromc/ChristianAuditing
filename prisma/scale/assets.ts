import type { AssetStatus } from "@prisma/client";
import { CREATABLE_BY_CLASS } from "../../src/lib/asset-class";
import { resolvePolicy } from "../../src/lib/loadout";
import { DAY, HOUR } from "./random";
import { GO_LIVE_DAYS_AGO, pickActor } from "./people";
import { vendorIdOf, type Actors, type AssetRec, type AuditRow, type EmpRec, type Gen, type PolicyDef, type ScaleContext } from "./types";
import { ASSET_NOTES, CATEGORY_SPECS, DEFECT_NOTES, WARRANTY_CONTACTS, type ModelSpec } from "./vocab";

/** The normal seed has 32 assets (25 IT, 7 Purchasing); these bring the totals to 1,000 = 900 IT + 100 Purchasing. */
export const NEW_ASSETS = Object.values(CATEGORY_SPECS).reduce((s, c) => s + c.count, 0);
export const FIRST_TAG_NO = 1000;
export const AWAITING_IT_CHECK = 10;
/** the share of active people with a policy who get every required line of it before the rest is handed out */
export const KIT_SHARE = 0.7;
/** how much likelier a peripheral is than a computer or headset to be the spare */
const SPARE_LEAN = 4;

/**
 * The IT status mix of the new assets (spec §3: about 70 % DEPLOYED, 18 % SPARE, 4 % DEFECTIVE, 2 % MISSING, rest
 * spread). Counted so that, with the normal seed's 25 IT assets, the 900 IT assets match the spec's mix.
 */
export const IT_STATUS_COUNTS: Record<string, number> = {
  DEPLOYED: 622, SPARE: 157, DEFECTIVE: 30, MISSING: 17, TEMPORARY: 18, DONATED: 9, BUYOUT: 11, DISPOSE: 11,
};

/** Which categories a special status may land on, so a licence is never "on loan" and a bag is never bought out. */
const STATUS_FITS: Record<string, (category: string, type: string) => boolean> = {
  TEMPORARY: (c, t) => c === "Laptop" || c === "Headset" || (c === "Other" && t === "Phone"),
  BUYOUT: (c, t) => c === "Laptop" || (c === "Other" && t === "Phone"),
  DONATED: (c) => c === "Laptop" || c === "Workstation (PC)" || c === "Monitor",
  DISPOSE: (c) => c !== "Windows License",
  MISSING: (c) => c !== "Windows License" && c !== "UPS" && c !== "Workstation (PC)",
  DEFECTIVE: (c) => c !== "Windows License" && c !== "Laptop Bag",
};

const addMonths = (t: number, months: number) => new Date(t + Math.round(months * 30.44) * DAY);

function serialFactory(g: Gen) {
  const seen = new Set<string>();
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789";
  return (): string => {
    for (;;) {
      let s = g.rng.pick(["5CG", "PF", "CN", "SN", "JX", "8C"]);
      for (let i = 0; i < 8; i++) s += chars[g.rng.int(0, chars.length - 1)];
      if (!seen.has(s)) { seen.add(s); return s; }
    }
  };
}

/** Every new asset, its details and current status; holders, finance and the creation audit rows. */
export function buildAssets(g: Gen, ctx: ScaleContext, employees: EmpRec[], actors: Actors, policies: PolicyDef[]) {
  const goLive = g.now - GO_LIVE_DAYS_AGO * DAY;
  const tagCounter: Record<string, number> = {};
  const serial = serialFactory(g);
  const vendor = (name: string) => vendorIdOf(ctx, name);
  const recs: AssetRec[] = [];
  const models = new Map<AssetRec, ModelSpec>();

  for (const [category, spec] of Object.entries(CATEGORY_SPECS)) {
    const cat = ctx.categories[category];
    if (!cat) throw new Error(`scale seed: no category ${category} — run npm run db:seed first`);
    const typeNames = Object.keys(spec.types);
    for (let i = 0; i < spec.count; i++) {
      const type = g.rng.weighted(typeNames.map((t, k) => [t, k === 0 ? 3 : 1] as const));
      const model = g.rng.pick(spec.types[type]);
      const prefix = spec.prefix[type] ?? spec.prefix["*"];
      tagCounter[prefix] = (tagCounter[prefix] ?? FIRST_TAG_NO - 1) + 1;
      const purchasedAt = g.rng.between(g.now - 5 * 365 * DAY, g.now - 10 * DAY);
      const rec: AssetRec = {
        category, type,
        row: {
          id: g.id(), tag: `BR-${prefix}-${tagCounter[prefix]}`, model: model.model, brand: model.brand,
          serial: spec.serial ? serial() : null, categoryId: cat.id, typeId: cat.types[type], cls: spec.cls,
          status: spec.cls === "IT" ? "SPARE" : "STORED", purchasedAt, createdAt: purchasedAt,
        },
      };
      models.set(rec, model);
      recs.push(rec);
    }
  }

  // ── statuses: exact counts, special ones only where they fit ──
  const it = g.rng.shuffle(recs.filter((r) => r.row.cls === "IT"));
  const taken = new Set<AssetRec>();
  for (const status of ["TEMPORARY", "BUYOUT", "DONATED", "DISPOSE", "MISSING", "DEFECTIVE"]) {
    const pool = it.filter((r) => !taken.has(r) && STATUS_FITS[status](r.category, r.type)).slice(0, IT_STATUS_COUNTS[status]);
    for (const r of pool) { r.row.status = status as AssetStatus; taken.add(r); }
  }
  // Spares lean towards peripherals: computers and headsets are what every policy asks for, so most of them are
  // out on desks (weighted sampling without replacement, Efraimidis–Spirakis keys).
  const kit = (r: AssetRec) => r.category === "Laptop" || r.category === "Workstation (PC)" || r.category === "Headset";
  const rest = it.filter((r) => !taken.has(r))
    .map((r) => ({ r, key: g.rng.float() ** (1 / (kit(r) ? 1 : SPARE_LEAN)) }))
    .sort((a, b) => b.key - a.key)
    .map(({ r }) => r);
  rest.slice(0, IT_STATUS_COUNTS.SPARE).forEach((r) => { r.row.status = "SPARE"; });
  rest.slice(IT_STATUS_COUNTS.SPARE).forEach((r) => { r.row.status = "DEPLOYED"; });

  const purch = g.rng.shuffle(recs.filter((r) => r.row.cls === "PURCHASING"));
  const fixedPurch: Record<string, AssetStatus[]> = {
    Building: ["OPERATIONAL", "OPERATIONAL", "OPERATIONAL"],
    Vehicle: ["OPERATIONAL", "OPERATIONAL", "OPERATIONAL", "OPERATIONAL", "OPERATIONAL", "STORED", "STORED", "SOLD"],
  };
  const others: AssetStatus[] = [
    ...Array<AssetStatus>(54).fill("OPERATIONAL"), ...Array<AssetStatus>(16).fill("STORED"), ...Array<AssetStatus>(5).fill("REPAIRING"),
    ...Array<AssetStatus>(4).fill("RETIRED"), "SOLD", "LOST", "LOST",
  ];
  for (const r of purch) {
    const list = fixedPurch[r.category] ?? others;
    const status = list.shift();
    if (!status) throw new Error(`scale seed: Purchasing status list ran out at ${r.category}`);
    r.row.status = status;
  }

  // ── dates: a handful of brand-new spares still waiting for IT's check; the rest registered or imported ──
  const awaiting = new Set(g.rng.shuffle(it.filter((r) => r.row.status === "SPARE")).slice(0, AWAITING_IT_CHECK));
  for (const r of recs) {
    if (awaiting.has(r)) r.row.purchasedAt = new Date(g.now - g.rng.int(5, 20) * DAY - g.rng.int(0, 10) * HOUR);
    const bought = (r.row.purchasedAt as Date).getTime();
    if (bought < goLive) {
      r.row.importedAt = new Date(goLive + g.rng.int(0, 120) * 60_000);
      r.row.createdAt = r.row.importedAt;
    } else {
      r.row.createdAt = new Date(Math.min(bought + g.rng.int(1, 4) * DAY + g.rng.int(0, 8) * HOUR, g.now - 2 * DAY));
    }
    const months = CATEGORY_SPECS[r.category].warrantyMonths;
    r.row.warrantyUntil = months ? addMonths(bought, months) : null;
  }

  // ── holders: every DEPLOYED or TEMPORARY asset is held by someone who has not left ──
  const active = employees.filter((e) => e.row.employment === "ACTIVE");
  const leavers = employees.filter((e) => e.row.employment === "OFFBOARDING");
  const deployed = g.rng.shuffle(it.filter((r) => r.row.status === "DEPLOYED"));
  const held = new Set<AssetRec>();
  for (const e of leavers) {
    const before = (e.row.offboardingAt as Date).getTime() - 3 * DAY;
    const wants = [["Laptop", "Workstation (PC)"], ["Headset", "Monitor"], ["Monitor", "Other", "Mouse"]].slice(0, g.rng.int(1, 3));
    for (const cats of wants) {
      const a = deployed.find((r) => !held.has(r) && cats.includes(r.category) && (r.row.createdAt as Date).getTime() < before);
      if (a) { a.row.assigneeId = e.row.id; held.add(a); }
    }
  }

  // Policy kits: most people with a policy get every required line, matched by type. When no device of the exact
  // type is free, one of the same category is re-typed (and re-modelled) to it — never across categories, and
  // never inside Other, whose types carry their own tag prefixes. The rest of the people keep the gaps.
  const typeInfo = new Map<string, { category: string; type: string }>();
  for (const [category, c] of Object.entries(ctx.categories)) {
    for (const [type, id] of Object.entries(c.types)) typeInfo.set(id, { category, type });
  }
  const retype = (r: AssetRec, type: string) => {
    const model = g.rng.pick(CATEGORY_SPECS[r.category].types[type]);
    r.type = type;
    Object.assign(r.row, { typeId: ctx.categories[r.category].types[type], model: model.model, brand: model.brand });
    models.set(r, model);
  };
  const members = g.rng.shuffle(active)
    .map((e) => ({ e, policy: resolvePolicy({ title: e.row.title, departmentId: e.row.departmentId }, policies) }))
    .filter((m): m is { e: EmpRec; policy: PolicyDef } => m.policy !== null);
  let kitted = 0;
  for (const { e, policy } of members) {
    if (kitted >= Math.round(members.length * KIT_SHARE)) break;
    const plan: Array<{ r: AssetRec; type: string | null }> = [];
    for (const slot of policy.slots.filter((s) => s.required && !s.loaner && s.assetTypeId)) {
      const info = typeInfo.get(slot.assetTypeId!);
      const pool = info ? deployed.filter((r) => !held.has(r) && r.category === info.category && !plan.some((p) => p.r === r)) : [];
      const exact = pool.find((r) => r.row.typeId === slot.assetTypeId);
      const near = info && info.category !== "Other" ? pool[0] : undefined;
      if (!exact && !near) { plan.length = 0; break; }
      plan.push(exact ? { r: exact, type: null } : { r: near!, type: info!.type });
    }
    if (plan.length === 0) continue;
    for (const p of plan) {
      if (p.type) retype(p.r, p.type);
      p.r.row.assigneeId = e.row.id;
      held.add(p.r);
    }
    kitted += 1;
  }

  // The rest go round-robin per category, people holding nothing first.
  const byCategory = new Map<string, AssetRec[]>();
  for (const r of deployed.filter((r) => !held.has(r))) byCategory.set(r.category, [...(byCategory.get(r.category) ?? []), r]);
  for (const [, list] of [...byCategory.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const holding = new Set(deployed.map((r) => r.row.assigneeId).filter(Boolean));
    const order = [...g.rng.shuffle(active.filter((e) => !holding.has(e.row.id))), ...g.rng.shuffle(active.filter((e) => holding.has(e.row.id)))];
    list.forEach((r, i) => { r.row.assigneeId = order[i % order.length].row.id; held.add(r); });
  }
  for (const r of it.filter((r) => r.row.status === "TEMPORARY")) r.row.assigneeId = g.rng.pick(active).row.id;
  const drivers = active.filter((e) => e.deptName === "Operations");
  purch.filter((r) => r.category === "Vehicle" && r.row.status === "OPERATIONAL").slice(0, 3)
    .forEach((r) => { r.row.assigneeId = g.rng.pick(drivers).row.id; });

  // ── registration, finance and the rest of the record ──
  const audit: AuditRow[] = [];
  const recent = new Set(g.rng.shuffle(recs.filter((r) => !awaiting.has(r) && (r.row.createdAt as Date).getTime() > g.now - 30 * DAY)).slice(0, 5));
  for (const r of recs) {
    const spec = CATEGORY_SPECS[r.category];
    const model = models.get(r)!;
    const created = (r.row.createdAt as Date).getTime();
    const later = (minD: number, maxD: number) => new Date(Math.min(created + g.rng.int(minD, maxD) * DAY + g.rng.int(1, 8) * HOUR, g.now - HOUR));
    const year = (r.row.purchasedAt as Date).getUTCFullYear();
    Object.assign(r.row, {
      invoiceRef: `SI-${year}-${g.rng.int(1000, 9999)}`,
      receiptRef: g.rng.chance(0.5) ? `OR-${g.rng.int(10000, 99999)}` : null,
      warrantyCoveredBy: r.row.warrantyUntil ? g.rng.pick(["manufacturer", "vendor", "both"]) : null,
      warrantyContact: r.row.warrantyUntil && g.rng.chance(0.3) ? g.rng.pick(WARRANTY_CONTACTS) : null,
      vendorId: r.category === "Furniture" ? vendor("Quezon Furniture Works")
        : r.category === "Pantry Equipment" ? vendor("Metro Office Supply")
        : spec.cls === "IT" ? vendor(g.rng.chance(0.8) ? "TechServe PH" : "Metro Office Supply") : null,
      labelPrintedAt: awaiting.has(r) || recent.has(r) ? null : later(0, 2),
      notes: r.row.status === "MISSING" ? "Not returned — investigation open"
        : r.row.status === "DEFECTIVE" ? g.rng.pick(DEFECT_NOTES)
        : g.rng.chance(0.15) ? g.rng.pick(ASSET_NOTES) : null,
    });
    if (r.row.status === "DEFECTIVE" && g.rng.chance(0.6)) {
      Object.assign(r.row, { vendorId: vendor("Octagon Repairs"), rmaRef: `RMA-${g.rng.int(9000, 9999)}` });
    }
    if (spec.cls === "IT" && !awaiting.has(r)) {
      const checker = pickActor(g, actors.it, ctx.fixedUsers.it);
      Object.assign(r.row, { itVerifiedAt: new Date(created + g.rng.int(1, 90) * 60_000), itVerifiedById: checker.id });
    }

    const notCapitalised = spec.lowValue === true && g.rng.chance(0.7);
    const cost = notCapitalised ? null : Math.round((model.cost * (0.9 + g.rng.float() * 0.2)) / 50) * 50;
    r.row.cost = cost;
    if (r.row.status === "DEFECTIVE" && cost !== null && g.rng.chance(0.3)) {
      r.row.repairQuote = Math.round((cost * (0.2 + g.rng.float() * 0.5)) / 50) * 50;
    }
    const confirm = notCapitalised || (!awaiting.has(r) && g.rng.chance(created > g.now - 20 * DAY ? 0.5 : spec.cls === "IT" ? 0.92 : 0.85));
    if (confirm) {
      const by = pickActor(g, actors.finance, ctx.fixedUsers.finance, 0.15);
      const at = later(1, 10);
      Object.assign(r.row, { financeConfirmedAt: at, financeConfirmedById: by.id, financeNotCapitalised: notCapitalised });
      if (!notCapitalised && spec.cls === "IT" && g.rng.chance(0.04)) {
        Object.assign(r.row, { depreciationLifeMonths: 36, depreciationSalvage: Math.round(cost! * 0.05), depreciationNote: "Finance override: three-year refresh cycle" });
      }
      if (at.getTime() >= g.windowStart) {
        audit.push({
          actorId: by.id, actorLabel: by.name, entityType: "asset", entityId: r.row.id, action: "finance.confirm", createdAt: at,
          diff: { financeConfirmed: { from: null, to: by.name }, ...(notCapitalised ? { notCapitalised: { from: false, to: true } } : {}) },
        });
      }
    }
    if (created >= g.windowStart) {
      const by = spec.cls === "IT" ? pickActor(g, actors.it, ctx.fixedUsers.it) : pickActor(g, actors.purchasing, ctx.fixedUsers.purchasing);
      const creatable = CREATABLE_BY_CLASS[spec.cls] as readonly string[];
      const born = spec.cls === "IT" ? "SPARE" : creatable.includes(r.row.status as string) ? r.row.status : "STORED";
      audit.push({
        actorId: by.id, actorLabel: by.name, entityType: "asset", entityId: r.row.id, action: "create", createdAt: new Date(created),
        diff: { tag: { from: null, to: r.row.tag }, model: { from: null, to: r.row.model }, status: { from: null, to: born as string } },
      });
    }
  }
  return { recs, audit };
}
