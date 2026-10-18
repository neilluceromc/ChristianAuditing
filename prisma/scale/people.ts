import type { GroupKind, Prisma, Role, SetupState } from "@prisma/client";
import { dayFromISO } from "../../src/lib/deadlines";
import { localDateISO } from "../../src/lib/format";
import { slotLabel } from "../../src/lib/loadout";
import { SETUP_LABELS, SETUP_STATE_LABELS } from "../../src/lib/it-setup";
import { DAY, HOUR } from "./random";
import type { Actor, Actors, AuditRow, EmpRec, Gen, PolicyDef, ScaleContext } from "./types";
import {
  CLIENT_TITLES, EMPLOYEE_NOTES, FIRST_NAMES, INTERNAL_HEADCOUNT, INTERNAL_TITLES, LAST_NAMES, NEW_CLIENTS,
  NEW_INTERNAL_DEPARTMENTS,
} from "./vocab";

/** Spec §3 volumes for people (the normal seed's 10 employees make the total 600). */
export const NEW_EMPLOYEES = 590;
export const CLIENT_STAFF = NEW_EMPLOYEES - Object.values(INTERNAL_HEADCOUNT).reduce((s, n) => s + n, 0);
export const OFFBOARDING_COUNT = 29;
export const OFFBOARDED_COUNT = 29;
/** joined in the last 30 days; the normal seed's EMP-0088 and EMP-0097 make it 10 */
export const NEW_HIRES = 8;
export const EMPLOYEE_NOTE_COUNT = 1500;
export const FIRST_EMPLOYEE_NO = 1000;
/** the day the register went live: older people and assets arrived through the importer then */
export const GO_LIVE_DAYS_AGO = 420;

/**
 * Phase 23's day-precision columns are stored at UTC midnight of the Manila day — seed.ts's dayFloor, verbatim, so
 * an offboarding due date reads the same here as everywhere else.
 */
export const dayFloor = (d: Date | number) => dayFromISO(localDateISO(new Date(d)));

/** A never-repeating stream of fictional full names. */
export function namePool(g: Gen): () => string {
  const combos = g.rng.shuffle(FIRST_NAMES.flatMap((f) => LAST_NAMES.map((l) => `${f} ${l}`)));
  let i = 0;
  return () => {
    if (i >= combos.length) throw new Error("namePool exhausted");
    return combos[i++];
  };
}

export const pickActor = (g: Gen, perf: Actor[], fixed: Actor, fixedShare = 0.1): Actor =>
  g.rng.chance(fixedShare) ? fixed : g.rng.pick(perf);

// ── departments ──────────────────────────────────────────────────────────────

export interface Dept { id: string; name: string; kind: GroupKind }

export function buildDepartments(g: Gen, ctx: ScaleContext) {
  const rows: Prisma.DepartmentCreateManyInput[] = [];
  const add = (name: string, kind: GroupKind): Dept => {
    const d = { id: g.id(), name, kind };
    rows.push(d);
    return d;
  };
  const existing: Dept[] = Object.entries(ctx.departments)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, d]) => ({ id: d.id, name, kind: d.kind }));
  const internal = [...existing.filter((d) => d.kind === "INTERNAL"), ...NEW_INTERNAL_DEPARTMENTS.map((n) => add(n, "INTERNAL"))];
  const clients = [...existing.filter((d) => d.kind === "CLIENT"), ...NEW_CLIENTS.map((n) => add(n, "CLIENT"))];
  return { rows, internal, clients };
}

// ── the 15 test accounts ─────────────────────────────────────────────────────

export const PERF_ROLES: readonly Role[] = [
  ...Array<Role>(10).fill("it_staff"), "purchasing_staff", "purchasing_staff", "finance_staff", "finance_staff", "admin",
];

export function buildUsers(g: Gen, nextName: () => string) {
  const rows = PERF_ROLES.map((role, i) => ({
    id: g.id(),
    email: `perf${String(i + 1).padStart(2, "0")}@thebackroomop.com`,
    name: nextName(),
    role,
    createdAt: new Date(g.now - 200 * DAY),
  }));
  const of = (role: Role): Actor[] => rows.filter((r) => r.role === role).map((r) => ({ id: r.id, name: r.name }));
  const actors: Actors = { it: of("it_staff"), purchasing: of("purchasing_staff"), finance: of("finance_staff"), admin: of("admin") };
  return { rows, actors };
}

// ── employees ────────────────────────────────────────────────────────────────

function setupFor(g: Gen, employment: string, newHire: boolean) {
  const none = { entraStatus: null, autopilotStatus: null, argusStatus: null, vpn: null };
  if (employment === "OFFBOARDED") {
    return { entraStatus: "REMOVED" as SetupState, autopilotStatus: "REMOVED" as SetupState, argusStatus: g.rng.chance(0.7) ? "REMOVED" as SetupState : "NOT_NEEDED" as SetupState, vpn: "None" };
  }
  if (newHire) {
    return {
      entraStatus: g.rng.pick<SetupState>(["DONE", "NOT_YET", "NOT_YET"]), autopilotStatus: "NOT_YET" as SetupState,
      argusStatus: g.rng.pick<SetupState>(["NOT_YET", "NOT_NEEDED"]), vpn: null,
    };
  }
  if (g.rng.chance(0.1)) return none;
  return {
    entraStatus: "DONE" as SetupState,
    autopilotStatus: g.rng.chance(0.8) ? "DONE" as SetupState : "NOT_NEEDED" as SetupState,
    argusStatus: g.rng.chance(0.7) ? "DONE" as SetupState : "NOT_NEEDED" as SetupState,
    vpn: g.rng.weighted([["None", 5], ["Cloudflare WARP", 3.5], ["OpenVPN", 1.5]] as const),
  };
}

export function buildEmployees(g: Gen, internal: Dept[], clients: Dept[], nextName: () => string): EmpRec[] {
  type Spec = { dept: Dept; isClient: boolean; title: string };
  const specs: Spec[] = [];
  for (const dept of internal) {
    const n = INTERNAL_HEADCOUNT[dept.name] ?? 0;
    for (let i = 0; i < n; i++) specs.push({ dept, isClient: false, title: g.rng.pick(INTERNAL_TITLES[dept.name]) });
  }
  // every client gets a few people, the rest follow a per-client weight: some accounts are big, most are small
  const weights = clients.map((c) => [c, 0.3 + g.rng.float() * 1.7] as const);
  const perClient = new Map<Dept, number>(clients.map((c) => [c, 4]));
  for (let i = clients.length * 4; i < CLIENT_STAFF; i++) {
    const c = g.rng.weighted(weights);
    perClient.set(c, perClient.get(c)! + 1);
  }
  for (const c of clients) {
    for (let i = 0; i < perClient.get(c)!; i++) specs.push({ dept: c, isClient: true, title: g.rng.weighted(CLIENT_TITLES) });
  }
  if (specs.length !== NEW_EMPLOYEES) throw new Error(`employee specs ${specs.length} ≠ ${NEW_EMPLOYEES}`);

  const hires = new Set(g.rng.shuffle(specs.map((_, i) => i)).slice(0, NEW_HIRES));
  const dated = specs.map((s, i) => ({
    ...s,
    newHire: hires.has(i),
    joinedAt: hires.has(i)
      ? new Date(g.now - g.rng.int(2, 29) * DAY - g.rng.int(0, 10) * HOUR)
      : g.rng.between(g.now - 6 * 365 * DAY, g.now - 31 * DAY),
  }));
  dated.sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime());

  const goLive = g.now - GO_LIVE_DAYS_AGO * DAY;
  const recs: EmpRec[] = dated.map((s, i) => {
    const createdAt = s.joinedAt.getTime() < goLive
      ? new Date(goLive + g.rng.int(0, 120) * 60_000)
      : new Date(s.joinedAt.getTime() - g.rng.int(1, 7) * DAY);
    return {
      row: {
        id: g.id(),
        employeeNo: `EMP-${FIRST_EMPLOYEE_NO + i}`,
        name: nextName(),
        title: s.title,
        departmentId: s.dept.id,
        joinedAt: s.joinedAt,
        employment: "ACTIVE",
        m365Status: s.newHire ? (g.rng.chance(0.5) ? "pending" : "active") : g.rng.chance(0.04) ? null : "active",
        createdAt,
        ...setupFor(g, "ACTIVE", s.newHire),
      },
      deptName: s.dept.name,
      isClient: s.isClient,
      completedAt: null,
    };
  });

  // Leavers come from people who have been here a while (spec §3: 5 % OFFBOARDING, some overdue; 5 % OFFBOARDED).
  const veterans = g.rng.shuffle(recs.filter((e) => e.row.joinedAt.getTime() < g.now - 200 * DAY));
  veterans.slice(0, OFFBOARDING_COUNT).forEach((e, i) => {
    const overdue = i < 10;
    const at = overdue
      ? new Date(g.now - g.rng.int(12, 25) * DAY - g.rng.int(0, 8) * HOUR)
      : new Date(g.now - g.rng.int(1, 8) * DAY - g.rng.int(0, 8) * HOUR);
    Object.assign(e.row, {
      employment: "OFFBOARDING", m365Status: "offboarding", offboardingAt: at,
      offboardingDueAt: overdue ? dayFloor(at.getTime() + 7 * DAY) : dayFloor(g.now + g.rng.int(1, 10) * DAY),
    });
  });
  veterans.slice(OFFBOARDING_COUNT, OFFBOARDING_COUNT + OFFBOARDED_COUNT).forEach((e) => {
    const at = new Date(g.now - g.rng.int(15, 170) * DAY - g.rng.int(0, 8) * HOUR);
    e.completedAt = new Date(at.getTime() + g.rng.int(1, 6) * DAY + g.rng.int(1, 6) * HOUR);
    Object.assign(e.row, {
      employment: "OFFBOARDED", m365Status: "inactive", offboardingAt: at,
      offboardingDueAt: dayFloor(at.getTime() + 7 * DAY), ...setupFor(g, "OFFBOARDED", false),
    });
  });
  return recs;
}

/** An employee is around (and assignable) from joinedAt; a leaver stops at offboardingAt. */
export const isStable = (e: EmpRec, windowStart: number) =>
  e.row.employment === "ACTIVE" && e.row.joinedAt.getTime() < windowStart;

// ── employee history: create, offboarding start, IT access removed, notes ─────

export function employeeAudits(g: Gen, employees: EmpRec[], actors: Actors, ctx: ScaleContext): AuditRow[] {
  const out: AuditRow[] = [];
  const it = () => pickActor(g, actors.it, ctx.fixedUsers.it);
  for (const e of employees) {
    const r = e.row;
    const created = (r.createdAt as Date).getTime();
    if (created >= g.windowStart) {
      const a = it();
      out.push({
        actorId: a.id, actorLabel: a.name, entityType: "employee", entityId: r.id, action: "create", createdAt: new Date(created),
        diff: { employeeNo: { from: null, to: r.employeeNo }, name: { from: null, to: r.name } },
      });
    }
    if (r.employment === "ACTIVE") continue;
    const at = r.offboardingAt as Date;
    const a = it();
    out.push({
      actorId: a.id, actorLabel: a.name, entityType: "employee", entityId: r.id, action: "update", createdAt: at,
      diff: {
        employment: { from: "ACTIVE", to: "OFFBOARDING" },
        offboardingAt: { from: null, to: at.toISOString() },
        offboardingDueAt: { from: null, to: (r.offboardingDueAt as Date).toISOString() },
      },
    });
    if (r.employment !== "OFFBOARDED") continue;
    const removals: Array<[string, string, string]> = [
      [SETUP_LABELS.entra, SETUP_STATE_LABELS.DONE, SETUP_STATE_LABELS.REMOVED],
      [SETUP_LABELS.autopilot, SETUP_STATE_LABELS.DONE, SETUP_STATE_LABELS.REMOVED],
      ...(r.argusStatus === "REMOVED" ? [[SETUP_LABELS.argus, SETUP_STATE_LABELS.DONE, SETUP_STATE_LABELS.REMOVED] as [string, string, string]] : []),
    ];
    for (const [label, from, to] of removals) {
      out.push({
        actorId: a.id, actorLabel: a.name, entityType: "employee", entityId: r.id, action: "employee.setup",
        createdAt: g.rng.between(at.getTime() + HOUR, e.completedAt!.getTime() - HOUR), diff: { [label]: { from, to } },
      });
    }
  }
  return out;
}

export function buildEmployeeNotes(g: Gen, employees: EmpRec[], actors: Actors, ctx: ScaleContext) {
  const notes: Prisma.EmployeeNoteCreateManyInput[] = [];
  const audit: AuditRow[] = [];
  for (let i = 0; i < EMPLOYEE_NOTE_COUNT; i++) {
    const e = g.rng.pick(employees);
    const from = Math.max(g.windowStart, (e.row.createdAt as Date).getTime(), e.row.joinedAt.getTime()) + HOUR;
    // nobody writes about a leaver once their offboarding is complete
    const at = g.rng.between(from, (e.completedAt?.getTime() ?? g.now) - HOUR);
    const author = pickActor(g, actors.it, ctx.fixedUsers.it);
    const text = g.rng.pick(EMPLOYEE_NOTES);
    notes.push({ employeeId: e.row.id, authorId: author.id, text, createdAt: at });
    audit.push({
      actorId: author.id, actorLabel: author.name, entityType: "employee", entityId: e.row.id, action: "note.added",
      createdAt: at, diff: { note: { from: null, to: text } },
    });
  }
  return { notes, audit };
}

// ── equipment policies (spec §3: one per client, plus a few departments) ─────

export function buildPolicies(g: Gen, ctx: ScaleContext, internal: Dept[], clients: Dept[]) {
  const policies: Prisma.EquipmentPolicyCreateManyInput[] = [];
  const slots: Prisma.PolicySlotCreateManyInput[] = [];
  const defs: PolicyDef[] = [];
  const typeId = (cat: string, type: string) => {
    const id = ctx.categories[cat]?.types[type];
    if (!id) throw new Error(`scale seed: no type ${cat} / ${type} — run npm run db:seed first`);
    return id;
  };
  const policy = (name: string, deptId: string | null, title: string | null, lines: Array<[string, string, boolean]>) => {
    const id = g.id();
    policies.push({ id, name, appliesToDepartmentId: deptId, appliesToTitle: title });
    for (const [cat, type, required] of lines) {
      slots.push({ policyId: id, name: slotLabel(cat, type), assetTypeId: typeId(cat, type), required });
    }
    defs.push({
      id, name, appliesToDepartmentId: deptId, appliesToTitle: title,
      slots: lines.map(([cat, type, required]) => ({ assetTypeId: typeId(cat, type), required, loaner: false })),
    });
  };
  // The normal seed already gives Bluepeak Telecom a policy and leaves Harborline Billing without one on purpose.
  const fixedClientIds = new Set(Object.values(ctx.departments).filter((d) => d.kind === "CLIENT").map((d) => d.id));
  for (const c of clients) {
    if (fixedClientIds.has(c.id)) continue;
    const computer = g.rng.weighted<[string, string]>([[["Workstation (PC)", "Mini PC"], 5], [["Workstation (PC)", "Desktop tower"], 2], [["Laptop", "Standard"], 3]]);
    // a computer always; a headset is required on most accounts; a monitor and a webcam are nice to have
    const lines: Array<[string, string, boolean]> = [
      [computer[0], computer[1], true],
      ["Headset", g.rng.chance(0.7) ? "Wired" : "Wireless", g.rng.chance(0.5)],
    ];
    if (g.rng.chance(0.6)) lines.push(["Monitor", "24-inch", false]);
    if (g.rng.chance(0.2)) lines.push(["Webcam", "USB webcam", false]);
    policy(c.name, c.id, null, lines);
  }
  const dept = (name: string) => internal.find((d) => d.name === name)?.id ?? null;
  policy("Operations standard", dept("Operations"), null, [["Laptop", "Standard", true], ["Monitor", "24-inch", false], ["Headset", "Wireless", false]]);
  policy("Sales standard", dept("Sales"), null, [["Laptop", "Standard", true], ["Headset", "Wireless", true], ["Other", "Phone", false]]);
  policy("IT standard", dept("IT"), null, [["Laptop", "High-performance", true], ["Monitor", "27-inch", true], ["Monitor", "27-inch", false], ["Other", "Docking Station", false]]);
  policy("Quality Assurance standard", dept("Quality Assurance"), null, [["Workstation (PC)", "Mini PC", true], ["Monitor", "24-inch", false], ["Headset", "Wired", true]]);
  policy("Team Leader kit", null, "Team Leader", [["Laptop", "Standard", true], ["Monitor", "27-inch", false], ["Headset", "Wireless", true]]);
  return { policies, slots, defs };
}
