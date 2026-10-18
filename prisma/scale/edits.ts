import { SETUP_LABELS, SETUP_STATE_LABELS } from "../../src/lib/it-setup";
import { HOUR } from "./random";
import { pickActor } from "./people";
import type { Actors, AssetRec, AuditRow, EmpRec, Gen, ScaleContext } from "./types";
import { ASSET_NOTES, CLIENT_TITLES, INTERNAL_TITLES, WARRANTY_CONTACTS } from "./vocab";

/**
 * Phase 43 (spec §3): the everyday edits that make up most of the 40,000 audit rows — an asset's notes, warranty
 * contact or receipt number; a person's title, M365 status or IT-setup row. Each field's edits form a chain whose
 * last "to" is the value the record holds today, so a history page reads as a story that ends where the record is.
 */

type Value = string | null;
interface Field { entity: "asset" | "employee"; action: "update" | "employee.setup"; key: string; current: Value; choices: Value[]; from: number; to: number }

const words = (v: string | null | undefined): Value =>
  v === null || v === undefined ? null : (SETUP_STATE_LABELS as Record<string, string>)[v] ?? v;

export function buildEdits(g: Gen, ctx: ScaleContext, recs: AssetRec[], employees: EmpRec[], actors: Actors, count: number): AuditRow[] {
  if (count <= 0) return [];
  const start = (created: Date | string | undefined | null, ...more: number[]) =>
    Math.max(g.windowStart, created ? new Date(created).getTime() : 0, ...more) + HOUR;
  const fieldsByEntity = new Map<string, Field[]>();
  const assetFields = (r: AssetRec): Field[] => {
    const from = start(r.row.createdAt);
    const base = { entity: "asset" as const, action: "update" as const, from, to: g.now - HOUR };
    return [
      { ...base, key: "notes", current: (r.row.notes as Value) ?? null, choices: [...ASSET_NOTES, null] },
      { ...base, key: "warrantyContact", current: (r.row.warrantyContact as Value) ?? null, choices: [...WARRANTY_CONTACTS, null] },
      { ...base, key: "receiptRef", current: (r.row.receiptRef as Value) ?? null, choices: [null, ...Array.from({ length: 6 }, () => `OR-${g.rng.int(10000, 99999)}`)] },
    ];
  };
  const employeeFields = (e: EmpRec): Field[] => {
    const r = e.row;
    const from = start(r.createdAt as Date, r.joinedAt.getTime());
    const base = { entity: "employee" as const, from, to: g.now - HOUR };
    const titles = e.isClient ? CLIENT_TITLES.map(([t]) => t) : [...(INTERNAL_TITLES[e.deptName] ?? [r.title])];
    const out: Field[] = [{ ...base, action: "update", key: "title", current: r.title, choices: titles }];
    if (r.employment === "ACTIVE") {
      out.push({ ...base, action: "update", key: "m365Status", current: (r.m365Status as Value) ?? null, choices: ["pending", "active", null] });
      const states = [SETUP_STATE_LABELS.DONE, SETUP_STATE_LABELS.NOT_YET, SETUP_STATE_LABELS.NOT_NEEDED, null];
      out.push(
        { ...base, action: "employee.setup", key: SETUP_LABELS.entra, current: words(r.entraStatus), choices: states },
        { ...base, action: "employee.setup", key: SETUP_LABELS.autopilot, current: words(r.autopilotStatus), choices: states },
        { ...base, action: "employee.setup", key: SETUP_LABELS.argus, current: words(r.argusStatus), choices: states },
        { ...base, action: "employee.setup", key: SETUP_LABELS.vpn, current: (r.vpn as Value) ?? null, choices: ["None", "Cloudflare WARP", "OpenVPN", null] },
      );
    }
    return out.filter((f) => f.from < f.to);
  };
  for (const r of recs) fieldsByEntity.set(r.row.id, assetFields(r));
  for (const e of employees) fieldsByEntity.set(e.row.id, employeeFields(e));

  // pick which (entity, field) each edit lands on: assets 60 %, people's records 25 %, IT setup 15 %
  const assetPool = recs.map((r) => r.row.id);
  const empPool = employees.map((e) => e.row.id);
  const picks = new Map<Field, Array<{ entityId: string; at: number }>>();
  for (let i = 0; i < count; i++) {
    const kind = g.rng.weighted([["asset", 60], ["update", 25], ["employee.setup", 15]] as const);
    let field: Field | undefined;
    let entityId = "";
    for (let tries = 0; !field && tries < 20; tries++) {
      entityId = g.rng.pick(kind === "asset" ? assetPool : empPool);
      const options = fieldsByEntity.get(entityId)!.filter((f) => (kind === "asset" ? f.entity === "asset" : f.action === kind));
      if (options.length) field = g.rng.pick(options);
    }
    if (!field) { i--; continue; }
    picks.set(field, [...(picks.get(field) ?? []), { entityId, at: g.rng.between(field.from, field.to).getTime() }]);
  }

  const out: AuditRow[] = [];
  for (const [field, edits] of picks) {
    edits.sort((a, b) => a.at - b.at);
    // the chain runs backwards from today's value; each step differs from the one after it
    const values: Value[] = [field.current];
    for (let i = 0; i < edits.length; i++) {
      const after = values[0];
      const options = field.choices.filter((c) => c !== after);
      values.unshift(options.length ? g.rng.pick(options) : null);
    }
    edits.forEach((edit, i) => {
      const actor = field.entity === "asset" ? pickActor(g, actors.it, ctx.fixedUsers.it) : pickActor(g, actors.it, ctx.fixedUsers.it, 0.15);
      out.push({
        actorId: actor.id, actorLabel: actor.name, entityType: field.entity, entityId: edit.entityId, action: field.action,
        createdAt: new Date(edit.at), diff: { [field.key]: { from: values[i], to: values[i + 1] } },
      });
    });
  }
  return out;
}
