import { z } from "zod";

/*
 * Spec §4, "Structured cards": the box's cards are rendered by the app from tool results and DB reads, never from
 * the model's prose. These are the shapes, the parser every stored card goes back through, and the Confirm card's
 * builder — which takes only what the server read by id.
 */

/** Who a card names: always read from the Employee row (and its group) by id. */
export type PersonRef = { id: string; name: string; employeeNo: string; worksFor: string; initials: string };

/** One spare as the pick list and the Confirm card show it. Dates are ISO strings. */
export type SpareRef = {
  assetId: string; tag: string; model: string; typeName: string | null;
  warrantyEnd: string | null;
  /** When it last came back to IT (its latest return), if ever. */
  backOn: string | null;
};

/** The outcomes Cris may propose for the item a replace takes back (no Buyout — that is a manual decision). */
export const CRIS_RETURN_OUTCOMES = ["DEFECTIVE", "TRIAGE", "MISSING"] as const;
export type CrisReturnOutcome = (typeof CRIS_RETURN_OUTCOMES)[number];

export type PersonCard = {
  type: "person"; person: PersonRef;
  items: Array<{ assetId: string; tag: string; model: string; since: string | null }>;
  gaps: string[]; holds: string[];
};
export type WhichCard = { type: "which"; choices: PersonRef[] };
export type SparesCard = { type: "spares"; employeeId: string; options: SpareRef[]; offset: number; more: boolean };
export type ConfirmCard = {
  type: "confirm"; pendingId: string; kind: "assign" | "replace"; person: PersonRef;
  gets: SpareRef & { serial: string | null; scanned: boolean };
  returns?: { assetId: string; tag: string; outcome: CrisReturnOutcome; reason: string };
};
/** `employeeId` is the profile the result card links to (spec §4, "a link to the profile"). */
export type ResultCard = {
  type: "result"; pendingId: string; employeeId: string; head: "Assigned." | "Replaced."; text: string;
  /** ISO: when Undo stops showing. */
  undoUntil: string;
};
export type ChipsCard = { type: "chips"; items: string[] };

export type CrisCard = PersonCard | WhichCard | SparesCard | ConfirmCard | ResultCard | ChipsCard;

/** A message as the box shows it. Tool rows never reach the box. */
export type CrisViewMessage = { id: string; role: "user" | "cris"; text: string | null; cards: CrisCard[]; at: string };

// ── the parser (stored JSON → cards) ────────────────────────────────────────

const personRef = z.object({ id: z.string(), name: z.string(), employeeNo: z.string(), worksFor: z.string(), initials: z.string() });
const spareRef = z.object({
  assetId: z.string(), tag: z.string(), model: z.string(), typeName: z.string().nullable(),
  warrantyEnd: z.string().nullable(), backOn: z.string().nullable(),
});
const confirmSchema = z.object({
  type: z.literal("confirm"), pendingId: z.string(), kind: z.enum(["assign", "replace"]), person: personRef,
  gets: spareRef.extend({ serial: z.string().nullable(), scanned: z.boolean() }),
  returns: z.object({ assetId: z.string(), tag: z.string(), outcome: z.enum(CRIS_RETURN_OUTCOMES), reason: z.string() }).optional(),
});
const cardSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("person"), person: personRef,
    items: z.array(z.object({ assetId: z.string(), tag: z.string(), model: z.string(), since: z.string().nullable() })),
    gaps: z.array(z.string()), holds: z.array(z.string()),
  }),
  z.object({ type: z.literal("which"), choices: z.array(personRef) }),
  z.object({ type: z.literal("spares"), employeeId: z.string(), options: z.array(spareRef), offset: z.number().int().min(0), more: z.boolean() }),
  confirmSchema,
  z.object({
    type: z.literal("result"), pendingId: z.string(), employeeId: z.string(),
    head: z.enum(["Assigned.", "Replaced."]), text: z.string(), undoUntil: z.string(),
  }),
  z.object({ type: z.literal("chips"), items: z.array(z.string()) }),
]);

/** A stored card, or null when it is not one of ours. */
export function parseCrisCard(json: unknown): CrisCard | null {
  const parsed = cardSchema.safeParse(json);
  return parsed.success ? (parsed.data as CrisCard) : null;
}

/** A pending action's stored Confirm card, or null. */
export function parseConfirmCard(json: unknown): ConfirmCard | null {
  const parsed = confirmSchema.safeParse(json);
  return parsed.success ? (parsed.data as ConfirmCard) : null;
}

// ── the builder (DB reads → the Confirm card) ───────────────────────────────

/** A person exactly as read from the Employee row; `worksFor` is their group's name (department or client). */
export type PersonSnapshot = { id: string; name: string; employeeNo: string; worksFor: string };
/** An asset exactly as read from the Asset row, its type and its latest return. */
export type AssetSnapshot = {
  id: string; tag: string; model: string; serial: string | null; typeName: string | null;
  warrantyUntil: Date | null; backOn: Date | null;
};
/** Everything a Confirm card shows: ids and DB reads only, plus whether the spare was scanned. */
export type ConfirmSnapshot = {
  pendingId: string; kind: "assign" | "replace";
  person: PersonSnapshot; gets: AssetSnapshot; scanned: boolean;
  returns?: { id: string; tag: string; outcome: CrisReturnOutcome; reason: string };
};

/** "Ana Maria de la Cruz" → "AC": the first and last words' first letters. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0][0];
  const last = words.length > 1 ? words[words.length - 1][0] : "";
  return (first + last).toUpperCase();
}

export function toPersonRef(p: PersonSnapshot): PersonRef {
  return { id: p.id, name: p.name, employeeNo: p.employeeNo, worksFor: p.worksFor, initials: initialsOf(p.name) };
}

export function toSpareRef(a: AssetSnapshot): SpareRef {
  return {
    assetId: a.id, tag: a.tag, model: a.model, typeName: a.typeName,
    warrantyEnd: a.warrantyUntil?.toISOString() ?? null, backOn: a.backOn?.toISOString() ?? null,
  };
}

export function cardFromSnapshot(s: ConfirmSnapshot): ConfirmCard {
  return {
    type: "confirm",
    pendingId: s.pendingId,
    kind: s.kind,
    person: toPersonRef(s.person),
    gets: { ...toSpareRef(s.gets), serial: s.gets.serial, scanned: s.scanned },
    ...(s.returns
      ? { returns: { assetId: s.returns.id, tag: s.returns.tag, outcome: s.returns.outcome, reason: s.returns.reason } }
      : {}),
  };
}

// ── messages ────────────────────────────────────────────────────────────────

/**
 * A stored CrisMessage as the box shows it: `{ text, cards }` content for "user" and "cris" rows (an
 * "assistant" row reads as Cris), each card re-parsed so a malformed one is dropped, never rendered. Tool rows
 * are the model's working and never shown: null.
 */
export function toViewMessage(row: { id: string; role: string; content: unknown; createdAt: Date }): CrisViewMessage | null {
  if (row.role !== "user" && row.role !== "cris" && row.role !== "assistant") return null;
  const content = (typeof row.content === "object" && row.content !== null ? row.content : {}) as { text?: unknown; cards?: unknown };
  const cards = Array.isArray(content.cards)
    ? content.cards.map(parseCrisCard).filter((c): c is CrisCard => c !== null)
    : [];
  return {
    id: row.id,
    role: row.role === "user" ? "user" : "cris",
    text: typeof content.text === "string" ? content.text : null,
    cards,
    at: row.createdAt.toISOString(),
  };
}
