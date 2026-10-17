/*
 * Spec §6.6: the server, not only the prompt, enforces "Cris never guesses and never picks". Each conversation keeps
 * what the PERSON chose (`CrisConversation.picks`); a propose tool may name only those ids, or the person whose
 * page the current message was sent from. Pure rules only — the tools (src/server/cris/tools.ts) apply them.
 */

/** `CrisConversation.picks`: the people and assets the person picked, scanned or typed exactly, newest last. */
export type Picks = { people: string[]; assets: string[] };

export const EMPTY_PICKS: Picks = Object.freeze({ people: [], assets: [] }) as Picks;
/** How many of each a conversation remembers. */
export const PICKS_KEEP = 20;

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** The stored JSON (default `{}`) as Picks; anything that is not a list of strings reads as empty. */
export function parsePicks(json: unknown): Picks {
  const o = typeof json === "object" && json !== null ? (json as Record<string, unknown>) : {};
  return { people: strings(o.people), assets: strings(o.assets) };
}

/**
 * A person a propose tool may name: one the person picked (a "Which one?" choice, or the single whole match of
 * a search for their own words), or the page THIS message was sent from. `pageEmployeeId` is the current
 * message's page only — the page a person has left is never carried over (Review Focus #1).
 */
export function allowPerson(picks: Picks, employeeId: string, pageEmployeeId: string | null): boolean {
  return picks.people.includes(employeeId) || (pageEmployeeId !== null && pageEmployeeId === employeeId);
}

/** An asset a propose tool may name: picked, scanned or typed exactly by the person in this conversation. */
export function allowAsset(picks: Picks, assetId: string): boolean {
  return picks.assets.includes(assetId);
}

function add(list: string[], id: string | undefined): string[] {
  if (!id) return list;
  return [...list.filter((x) => x !== id), id].slice(-PICKS_KEEP);
}

/** Records a pick: deduplicated (a repeat moves to the end), keeping the last PICKS_KEEP of each. */
export function notePick(picks: Picks, pick: { person?: string; asset?: string }): Picks {
  return { people: add(picks.people, pick.person), assets: add(picks.assets, pick.asset) };
}

// ── tags the person typed ───────────────────────────────────────────────────

const TAG_RE = /(?<![A-Z0-9-])BR-[A-Z]{2}-\d{4}(?![A-Z0-9])/gi;
/** A bare number stands alone: never part of a date or a path (`17/10/2026`, `17.10.2026`, `2026/10`) or a code. */
const BARE_RE = /(?<![A-Z0-9\-/.])\d{4}(?![A-Z0-9\-/])/gi;

/**
 * Every exact tag (BR-XX-0000, any case) in the person's own text, upper-cased, once each, in order. A bare
 * 4-digit number counts only while a spares card is open (`openSpareTags`), and only when it ends exactly one of
 * that card's tags — two open tags ending alike are never guessed between.
 */
export function exactTagsIn(text: string, openSpareTags: readonly string[] = []): string[] {
  const found: string[] = [];
  const push = (t: string) => { if (!found.includes(t)) found.push(t); };
  for (const m of text.matchAll(TAG_RE)) push(m[0].toUpperCase());
  if (openSpareTags.length > 0) {
    const stripped = text.replace(TAG_RE, " ");
    for (const m of stripped.matchAll(BARE_RE)) {
      const hits = openSpareTags.filter((t) => t.toUpperCase().endsWith(`-${m[0]}`));
      if (hits.length === 1) push(hits[0].toUpperCase());
    }
  }
  return found;
}

/** The first exact tag the person typed, or null (see `exactTagsIn`). */
export function exactTagIn(text: string, openSpareTags: readonly string[] = []): string | null {
  return exactTagsIn(text, openSpareTags)[0] ?? null;
}

// ── the person's own words (spec §3(d)) ─────────────────────────────────────

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** Whether a search query is the person's own words: it appears in their message (case and spacing ignored). */
export function wordsIn(q: string, userText: string): boolean {
  const n = norm(q);
  return n.length > 0 && norm(userText).includes(n);
}

/** A whole match — the full name or the employee no. A unique match on part of a name still makes Cris ask. */
export function wholeNameMatch(q: string, person: { name: string; employeeNo: string }): boolean {
  const n = norm(q);
  return n === norm(person.name) || n === norm(person.employeeNo);
}

// ── the page ────────────────────────────────────────────────────────────────

/** Static pages beside the record routes — never a record id. */
const NOT_IDS = new Set(["new", "export", "import", "activity", "labels", "register", "scan", "work"]);

/**
 * The record a page is about: `/employees/{id}…` → employeeId, `/inventory/{id}…` → assetId; otherwise both null.
 * The path comes from the client, so a malformed escape reads as no record rather than throwing.
 */
export function pageEntity(path: string): { employeeId: string | null; assetId: string | null } {
  const none = { employeeId: null, assetId: null };
  const m = /^\/(employees|inventory)\/([^/?#]+)/.exec(path);
  if (!m || NOT_IDS.has(m[2])) return none;
  let id: string;
  try {
    id = decodeURIComponent(m[2]);
  } catch {
    return none;
  }
  return m[1] === "employees" ? { employeeId: id, assetId: null } : { employeeId: null, assetId: id };
}
