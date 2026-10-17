import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import type { SessionUser } from "@/server/auth/guards";
import type { ActionResult } from "@/server/action-result";
import { holdingsRows } from "@/server/modules/employees/queries";
import { exactTagMatch } from "@/server/modules/inventory/queries";
import { pathAllowedForRole } from "@/lib/workspaces";
import { canSeeClass, statusLabel, visibleClassWhere } from "@/lib/asset-class";
import { peopleWhere } from "@/lib/people-search";
import { assetSearchWhere, exactTagFirst } from "@/lib/palette";
import { computeLoadout, effectiveSlots, resolvePolicy } from "@/lib/loadout";
import { CRIS_RETURN_OUTCOMES, toPersonRef, type CrisCard, type PersonCard } from "@/lib/cris-cards";
import { allowAsset, allowPerson, exactTagsIn, notePick, wholeNameMatch, wordsIn, type Picks } from "@/lib/cris-picks";
import { sparesCard } from "./cards";
import { createPending, type PendingKind } from "./pending-core";

/*
 * Spec §8 "Tools": what the model may call, and the executors. NOT "use server" — the turn (Task 5) calls runTool
 * with a user it has already authenticated. Every read applies the person's own visibility (`pathAllowedForRole`,
 * `visibleClassWhere`, `canSeeClass`), so Cris never shows more than the normal screens (spec §3(b)). Results for
 * the model hold only what the owner allowed (spec §8 "What may be sent"): names, employee nos., titles, who they
 * work for, tags, models, serials, holdings and gaps — never notes, free text or money. The propose tools enforce
 * the person's picks on the server (spec §6.6).
 */

/**
 * A tool as Cris declares it: the SDK's `Anthropic.Tool`, narrowed so every one is strict with a closed schema
 * (CRIS_TOOLS is checked against the SDK's type below; the turn passes them straight through).
 */
export interface CrisTool {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: false;
  };
  strict: true;
}

export type ToolCtx = {
  user: SessionUser;
  conversationId: string;
  /** What the person picked so far in this conversation (`CrisConversation.picks`). */
  picks: Picks;
  /** The person whose page THIS message was sent from — never an earlier message's page (Review Focus #1). */
  pageEmployeeId: string | null;
  /** The person's own words in this message ("" for a structured pick). */
  userText: string;
  /** Tags of the spares card open in the box, so a bare "0230" can name one of them (`exactTagsIn`). */
  openSpareTags?: readonly string[];
  /** Assets the person scanned (rather than clicked) — the Confirm card says "Scanned". */
  scannedAssetIds?: readonly string[];
};

export type ToolMood = "search" | "look" | "sad";
export type ToolOutcome = { result: unknown; cards: CrisCard[]; picks: Picks; mood: ToolMood };

/** Spec §6.6: the refusal a propose call with an id the person did not choose gets. Nothing is shown. */
export const REFUSE_PICK = "ask the person to pick or scan";
const NOT_OPEN = "That isn't open to this person on the normal screens.";
/** find_people and find_asset: at most this many rows. */
export const FIND_LIMIT = 5;

// ── the definitions ─────────────────────────────────────────────────────────

const str = (description: string) => ({ type: "string", description });
const tool = (name: string, description: string, properties: Record<string, unknown>, required: string[]): CrisTool => ({
  name, description, input_schema: { type: "object", properties, required, additionalProperties: false }, strict: true,
});

/** Strict schemas take no numeric or length bounds; the executors re-check every input with zod. */
export const CRIS_TOOLS: CrisTool[] = [
  tool(
    "find_people",
    "Find ACTIVE or leaving people by name or employee no. (at most 5), with their employee no. and who they work for. " +
      "Search with the person's own words. A single whole-name or employee-no. match counts as their pick; otherwise the box " +
      "shows a \"Which one?\" list — then stop and wait for their pick. Never choose between people yourself.",
    { q: str("The name or employee no. exactly as the person wrote it.") },
    ["q"],
  ),
  tool(
    "get_holdings",
    "What one person holds now: items (tag, model, status, since when), their equipment policy's gaps, and the spares on hold for them. " +
      "The box shows it as a card.",
    { employeeId: str("The person's id, from find_people, a pick, or the page.") },
    ["employeeId"],
  ),
  tool(
    "find_asset",
    "Find assets: an exact tag or serial first, then tag, model, serial or holder name matches (at most 5), with their holder.",
    { q: str("A tag, serial, model or holder name.") },
    ["q"],
  ),
  tool(
    "list_spares",
    "Spares this person may be given, the wanted type first, 3 at a time. The box shows them as a pick list: stop and wait " +
      "for the person to pick or scan one. Never pick for them. Ask for the next 3 with offset.",
    {
      employeeId: str("Who the spare is for."),
      typeId: str("The asset type of the slot being filled or replaced (a gap's or item's typeId), when known."),
      offset: { type: "integer", description: "0 for the first 3, then 3, 6, …" },
    },
    ["employeeId"],
  ),
  tool(
    "propose_assign",
    "Propose giving a spare to a person. Nothing changes: the server checks it and the box shows a Confirm card; only the " +
      "person's own Confirm click makes the change (typing \"yes\" never does). The person and the spare must be ones the " +
      "person picked, scanned or typed exactly.",
    {
      employeeId: str("Who gets the spare."),
      assetId: str("The spare the person picked or scanned."),
      reason: str("Optional short reason, in the person's words."),
    },
    ["employeeId", "assetId"],
  ),
  tool(
    "propose_replace",
    "Propose swapping an item a person holds for a spare. Nothing changes until the person presses Confirm on the card. " +
      "The returned item becomes Defective, Back for triage, or Missing (Missing needs a reason). Buyout is never proposed.",
    {
      employeeId: str("Who holds the item."),
      oldAssetId: str("The item they give back."),
      newAssetId: str("The spare the person picked or scanned."),
      outcome: { type: "string", enum: [...CRIS_RETURN_OUTCOMES], description: "What happens to the returned item." },
      reason: str("Optional short reason, in the person's words (required for MISSING)."),
    },
    ["employeeId", "oldAssetId", "newAssetId", "outcome"],
  ),
] satisfies Anthropic.Tool[];

// ── inputs, re-checked ──────────────────────────────────────────────────────

const id = z.string().trim().min(1).max(64);
const reason = z.string().max(500).nullish().transform((v) => v ?? undefined);
const INPUTS = {
  find_people: z.object({ q: z.string().trim().min(1).max(60) }),
  get_holdings: z.object({ employeeId: id }),
  find_asset: z.object({ q: z.string().trim().min(1).max(100) }),
  list_spares: z.object({
    employeeId: id,
    typeId: id.nullish().transform((v) => v ?? undefined),
    offset: z.number().int().min(0).max(1000).nullish().transform((v) => v ?? 0),
  }),
  propose_assign: z.object({ employeeId: id, assetId: id, reason }),
  propose_replace: z.object({ employeeId: id, oldAssetId: id, newAssetId: id, outcome: z.enum(CRIS_RETURN_OUTCOMES), reason }),
} as const;
type ToolName = keyof typeof INPUTS;
type Input<N extends ToolName> = z.infer<(typeof INPUTS)[N]>;

// ── shared reads ────────────────────────────────────────────────────────────

const PERSON_SELECT = {
  id: true, name: true, employeeNo: true, title: true, employment: true, department: { select: { name: true, kind: true } },
} as const satisfies Prisma.EmployeeSelect;
type PersonRow = Prisma.EmployeeGetPayload<{ select: typeof PERSON_SELECT }>;

/** A person as the model reads them: the allowed fields only. */
function personFor(p: PersonRow) {
  return {
    employeeId: p.id, name: p.name, employeeNo: p.employeeNo, title: p.title, worksFor: p.department.name,
    client: p.department.kind === "CLIENT", leaving: p.employment === "OFFBOARDING",
  };
}
const refOf = (p: PersonRow) => toPersonRef({ id: p.id, name: p.name, employeeNo: p.employeeNo, worksFor: p.department.name });

const canPeople = (u: SessionUser) => pathAllowedForRole("/employees/x", u.role);
const canAssets = (u: SessionUser) => pathAllowedForRole("/inventory/x", u.role);
const dateOnly = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

/** Every tag the person typed exactly (or a bare number naming one on the open spares card) is a pick. */
async function noteTypedTags(ctx: ToolCtx): Promise<Picks> {
  const tags = exactTagsIn(ctx.userText, ctx.openSpareTags ?? []);
  if (tags.length === 0) return ctx.picks;
  const rows = await prisma.asset.findMany({
    where: { AND: [{ tag: { in: tags } }, visibleClassWhere(ctx.user.role)] },
    select: { id: true, tag: true },
  });
  let picks = ctx.picks;
  for (const tag of tags) {
    const row = rows.find((r) => r.tag === tag);
    if (row) picks = notePick(picks, { asset: row.id });
  }
  return picks;
}

// ── the executors ───────────────────────────────────────────────────────────

type Exec<N extends ToolName> = (ctx: ToolCtx, input: Input<N>) => Promise<ToolOutcome>;
const fail = (ctx: ToolCtx, error: string, mood: ToolMood = "sad"): ToolOutcome => ({ result: { error }, cards: [], picks: ctx.picks, mood });

const findPeople: Exec<"find_people"> = async (ctx, { q }) => {
  if (!canPeople(ctx.user)) return fail(ctx, NOT_OPEN);
  const rows = await prisma.employee.findMany({
    where: { ...peopleWhere(q, "active"), employment: { in: ["ACTIVE", "OFFBOARDING"] } },
    select: PERSON_SELECT,
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: FIND_LIMIT + 1,
  });
  const shown = rows.slice(0, FIND_LIMIT);
  const people = shown.map(personFor);
  if (shown.length === 0) {
    return { result: { people, note: "No one matches — ask for the spelling or the employee no." }, cards: [], picks: ctx.picks, mood: "sad" };
  }
  // Spec §3(d) and §6.6: only one whole match of the person's own words is theirs; part of a name always asks.
  const only = rows.length === 1 ? rows[0] : null;
  if (only && wholeNameMatch(q, only) && wordsIn(q, ctx.userText)) {
    return { result: { people, picked: true }, cards: [], picks: notePick(ctx.picks, { person: only.id }), mood: "search" };
  }
  return {
    result: {
      people, picked: false, more: rows.length > FIND_LIMIT,
      note: "The box shows a \"Which one?\" list with employee numbers. Stop and wait for the person's pick.",
    },
    cards: [{ type: "which", choices: shown.map(refOf) }],
    picks: ctx.picks,
    mood: "look",
  };
};

const getHoldings: Exec<"get_holdings"> = async (ctx, { employeeId }) => {
  if (!canPeople(ctx.user)) return fail(ctx, NOT_OPEN);
  const employee = await prisma.employee.findUnique({ where: { id: employeeId }, select: { ...PERSON_SELECT, departmentId: true } });
  if (!employee) return fail(ctx, "No one has that id — search with find_people.");
  const [held, policies, exceptions, rows] = await Promise.all([
    prisma.asset.findMany({
      where: { assigneeId: employeeId },
      select: { id: true, tag: true, model: true, serial: true, typeId: true, status: true, cls: true, type: { select: { name: true } } },
      orderBy: { tag: "asc" },
    }),
    prisma.equipmentPolicy.findMany({ include: { slots: { orderBy: { id: "asc" } } }, orderBy: [{ name: "asc" }] }),
    // the exceptions' reasons are free text: never read
    prisma.employeeSlotException.findMany({
      where: { employeeId },
      select: { id: true, kind: true, slotId: true, name: true, assetTypeId: true, required: true, loaner: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    holdingsRows(employeeId),
  ]);
  const policy = resolvePolicy(employee, policies);
  const loadout = computeLoadout(effectiveSlots(policy?.slots ?? [], exceptions), held);
  const slotOf = new Map(loadout.slots.flatMap((s) => (s.asset ? [[s.asset.id, s.slot.name] as const] : [])));
  const since = new Map(rows.filter((r) => r.section === "asset").map((r) => [r.tag, r.since]));
  const holds = rows.filter((r) => r.section === "reservation").map((r) => ({ tag: r.tag, model: r.model }));
  const gaps = loadout.slots
    .filter((s) => !s.asset && !s.coveredByLoan)
    .map((s) => ({ slot: s.slot.name, typeId: s.slot.assetTypeId, required: s.slot.required }));

  const items = held.map((a) => ({
    assetId: a.id, tag: a.tag, model: a.model, type: a.type?.name ?? null, status: statusLabel(a.status),
    since: dateOnly(since.get(a.tag)), slot: slotOf.get(a.id) ?? null,
    // the profile shows another class's item as text only: no serial for it
    ...(canSeeClass(ctx.user.role, a.cls) ? { serial: a.serial } : {}),
  }));
  const card: PersonCard = {
    type: "person",
    person: refOf(employee),
    items: held.map((a) => ({ assetId: a.id, tag: a.tag, model: a.model, since: since.get(a.tag)?.toISOString() ?? null })),
    gaps: gaps.map((g) => (g.required ? g.slot : `${g.slot} (optional)`)),
    holds: holds.map((x) => x.tag),
  };
  return {
    result: { person: personFor(employee), policy: policy?.name ?? null, items, gaps, holds },
    cards: [card],
    picks: ctx.picks,
    mood: "search",
  };
};

const ASSET_SELECT = {
  id: true, tag: true, model: true, serial: true, status: true, type: { select: { name: true } },
  assignee: { select: { id: true, name: true, employeeNo: true } },
} as const satisfies Prisma.AssetSelect;

const findAsset: Exec<"find_asset"> = async (ctx, { q }) => {
  if (!canAssets(ctx.user)) return fail(ctx, NOT_OPEN);
  const visible = visibleClassWhere(ctx.user.role);
  const tagHit = await exactTagMatch(q); // no class filter of its own: the visibility is ANDed on below
  const [byTag, bySerial, rest] = await Promise.all([
    tagHit ? prisma.asset.findFirst({ where: { AND: [{ id: tagHit.id }, visible] }, select: ASSET_SELECT }) : null,
    prisma.asset.findFirst({ where: { AND: [{ serial: { equals: q, mode: "insensitive" } }, visible] }, select: ASSET_SELECT, orderBy: { tag: "asc" } }),
    prisma.asset.findMany({ where: { AND: [assetSearchWhere(q), visible] }, select: ASSET_SELECT, orderBy: { tag: "asc" }, take: FIND_LIMIT }),
  ]);
  const rows = exactTagFirst(byTag, exactTagFirst(bySerial, rest));
  const assets = rows.map((a) => ({
    assetId: a.id, tag: a.tag, model: a.model, serial: a.serial, type: a.type?.name ?? null, status: statusLabel(a.status),
    holder: a.assignee ? { employeeId: a.assignee.id, name: a.assignee.name, employeeNo: a.assignee.employeeNo } : null,
    exact: a.id === byTag?.id || a.id === bySerial?.id,
  }));
  if (assets.length === 0) return { result: { assets, note: "Nothing matches." }, cards: [], picks: ctx.picks, mood: "sad" };
  return { result: { assets }, cards: [], picks: ctx.picks, mood: "search" };
};

const listSpares: Exec<"list_spares"> = async (ctx, { employeeId, typeId, offset }) => {
  // the profile's pickers' own gate (spareCandidates): the IT class, on the people screens
  if (!canPeople(ctx.user) || !canSeeClass(ctx.user.role, "IT")) return fail(ctx, NOT_OPEN);
  const employee = await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true } });
  if (!employee) return fail(ctx, "No one has that id — search with find_people.");
  const card = await sparesCard(prisma, employeeId, { typeId: typeId ?? null, offset });
  const spares = card.options.map((s) => ({ assetId: s.assetId, tag: s.tag, model: s.model, type: s.typeName, warrantyEnd: s.warrantyEnd?.slice(0, 10) ?? null }));
  if (spares.length === 0) {
    return { result: { spares, offset, more: false, note: "No pickable spares left." }, cards: [], picks: ctx.picks, mood: "sad" };
  }
  return {
    result: { spares, offset, more: card.more, note: "The box shows these as a pick list. Stop and wait for the person to pick or scan one." },
    cards: [card],
    picks: ctx.picks,
    mood: "look",
  };
};

/**
 * A replace's returned item needs no pick only when it is unambiguous: the person holds it and nothing else of its
 * type. Holding two laptops, the person picks which one — Cris never guesses (spec §3(d)).
 */
async function soleHeldOfType(employeeId: string, assetId: string): Promise<boolean> {
  const a = await prisma.asset.findUnique({ where: { id: assetId }, select: { assigneeId: true, typeId: true } });
  if (!a || a.assigneeId !== employeeId) return false;
  return (await prisma.asset.count({ where: { assigneeId: employeeId, typeId: a.typeId } })) === 1;
}

/** The lifecycle action's own words: a validation refusal's first field message, otherwise its message. */
function refusalText(r: ActionResult<unknown>): string {
  if (r.ok) return "";
  return (r.fieldErrors ? Object.values(r.fieldErrors)[0] : undefined) ?? r.message;
}

async function propose(ctx: ToolCtx, kind: PendingKind, input: Input<"propose_assign"> | Input<"propose_replace">, getsId: string): Promise<ToolOutcome> {
  const r = await prisma.$transaction((tx) => createPending(tx, ctx.user, ctx.conversationId, kind, input, {
    scanned: ctx.scannedAssetIds?.includes(getsId) ?? false,
  }));
  if (!r.ok) return fail(ctx, refusalText(r));
  return {
    result: { shown: "The Confirm card is in the box. Nothing has changed: only the person's Confirm click makes the change." },
    cards: [r.data.card],
    picks: ctx.picks,
    mood: "look",
  };
}

const proposeAssign: Exec<"propose_assign"> = async (ctx, input) => {
  if (!allowPerson(ctx.picks, input.employeeId, ctx.pageEmployeeId) || !allowAsset(ctx.picks, input.assetId)) {
    return fail(ctx, REFUSE_PICK, "look");
  }
  return propose(ctx, "assign", input, input.assetId);
};

const proposeReplace: Exec<"propose_replace"> = async (ctx, input) => {
  const allowed = allowPerson(ctx.picks, input.employeeId, ctx.pageEmployeeId)
    && allowAsset(ctx.picks, input.newAssetId)
    && (allowAsset(ctx.picks, input.oldAssetId) || (await soleHeldOfType(input.employeeId, input.oldAssetId)));
  if (!allowed) return fail(ctx, REFUSE_PICK, "look");
  return propose(ctx, "replace", input, input.newAssetId);
};

const EXECUTORS: { [N in ToolName]: Exec<N> } = {
  find_people: findPeople,
  get_holdings: getHoldings,
  find_asset: findAsset,
  list_spares: listSpares,
  propose_assign: proposeAssign,
  propose_replace: proposeReplace,
};

/**
 * Runs one tool call for the turn. The tags the person typed exactly count as picks first; the outcome carries the
 * result for the model, the cards for the box, the picks to store, and the mood. Never throws on the model's
 * input: an unknown tool or a malformed input comes back as `{ error }`.
 */
export async function runTool(ctx: ToolCtx, name: string, input: unknown): Promise<ToolOutcome> {
  const withTags: ToolCtx = { ...ctx, picks: await noteTypedTags(ctx) };
  if (!Object.hasOwn(INPUTS, name)) return fail(withTags, `There is no tool called ${name}.`);
  const tool = name as ToolName;
  const parsed = INPUTS[tool].safeParse(input);
  if (!parsed.success) return fail(withTags, `That input doesn't fit ${tool}: ${parsed.error.issues[0]?.message ?? "check the fields"}.`);
  return (EXECUTORS[tool] as Exec<ToolName>)(withTags, parsed.data as Input<ToolName>);
}
