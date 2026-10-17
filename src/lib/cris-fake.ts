/*
 * The fake model's script (spec §8: `CRIS_MODEL=fake` gives scripted, deterministic replies so the e2e tests and
 * the battery run with no key and no cost). Pure: given the person's words this turn, the tool results so far this
 * turn, and what earlier turns said and found, it returns the next tool call or the reply text. Keyword rules, as
 * the CrisPage mockup plays them. The adapter (src/server/cris/fake.ts) wraps the decision in the real API's
 * content-block shapes.
 */

export type FakeToolResult = { name: string; input: Record<string, unknown>; result: unknown };
/** Earlier turns of the conversation, oldest first: the person's words and the tool results. */
export type FakeMemory = { texts: string[]; results: FakeToolResult[] };
export type FakeDecision =
  | { kind: "tool"; name: string; input: Record<string, unknown> }
  | { kind: "text"; text: string };

export const FAKE_FALLBACK = "Sorry, I didn't catch that… Try \"Check Ana Reyes's items\" or \"Who has BR-LT-0148?\".";

type Intent = "who" | "replace" | "assign" | "holdings" | "stock";
type Person = { employeeId: string; name: string; employeeNo: string };

const TAG = /(?<![A-Z0-9-])BR-[A-Z]{2}-\d{4}(?![A-Z0-9])/i;
const PICK_ASSET = /^I picked (BR-[A-Z]{2}-\d{4})( \(scanned\))?\.$/i;
const PICK_PERSON = /^I picked (.+) \(([^()]+)\)\.$/;
/** What the Confirm card's Change button sends (src/components/cris/cris-widget.tsx). */
const CHANGE = /^change$/i;
/** What the stock card's "Show 3 more" sends (src/components/cris/cris-widget.tsx). */
const MORE_STOCK = /^show 3 more$/i;

const tool = (name: string, input: Record<string, unknown>): FakeDecision => ({ kind: "tool", name, input });
const say = (text: string): FakeDecision => ({ kind: "text", text });

function intentOf(text: string): Intent | null {
  if (/\bwho (has|holds)\b|\bwhose\b/i.test(text)) return "who";
  if (/\b(replace|swap)\b/i.test(text)) return "replace";
  if (/\b(assign|give)\b/i.test(text)) return "assign";
  if (/\b(items|holds|holding|stuff|equipment)\b/i.test(text)) return "holdings";
  if (/\bspares?\b.*\bin stock\b/i.test(text)) return "stock";
  return null;
}

/** Leading words that are the request, not the name. */
const NOT_NAME = new Set(["check", "show", "list", "see", "what", "are", "is", "replace", "swap", "assign", "give", "please", "can", "you", "me", "the", "a", "an"]);
const capitalised = (w: string) => /^\p{Lu}/u.test(w);
const clean = (w: string) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}.-]+$/gu, "").replace(/\.$/, "");

/** The person named in a request: before "'s" ("Ana Reyes's items"), or after "to"/"for" ("a laptop to Ana Reyes"). */
export function nameIn(text: string): string | null {
  const poss = /^(.*?)['’]s\b/u.exec(text);
  if (poss) {
    const words = poss[1].trim().split(/\s+/);
    const name: string[] = [];
    for (let i = words.length - 1; i >= 0 && name.length < 4; i--) {
      const w = clean(words[i]);
      if (!w || !capitalised(w) || NOT_NAME.has(w.toLowerCase())) break;
      name.unshift(w);
    }
    if (name.length > 0) return name.join(" ");
  }
  const after = /\b(?:to|for)\s+(.+)$/iu.exec(text);
  if (after) {
    const name: string[] = [];
    for (const raw of after[1].trim().split(/\s+/)) {
      const w = clean(raw);
      if (!w || !capitalised(w) || name.length >= 4) break;
      name.push(w);
      if (/[.,!?;]$/.test(raw)) break;
    }
    if (name.length > 0) return name.join(" ");
  }
  return null;
}

// ── reading results ─────────────────────────────────────────────────────────

const rec = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {});
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.map(rec) : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

function lastOf(results: FakeToolResult[], name: string): FakeToolResult | undefined {
  for (let i = results.length - 1; i >= 0; i--) if (results[i].name === name) return results[i];
  return undefined;
}

function personOf(p: Record<string, unknown>): Person {
  return { employeeId: str(p.employeeId), name: str(p.name), employeeNo: str(p.employeeNo) };
}

// ── the script ──────────────────────────────────────────────────────────────

/**
 * The next step. `text` is the person's message this turn ("I picked …" for a structured pick), `toolResults` this
 * turn's results so far, `earlier` the turns before. A pick (or a typed tag) carries on the last request that had
 * one of the four jobs.
 */
export function fakeDecide(text: string, toolResults: FakeToolResult[], earlier: FakeMemory = { texts: [], results: [] }): FakeDecision {
  const now = toolResults;
  const all = [...earlier.results, ...now];

  // A tool that refused: pass its words on.
  const lastNow = now[now.length - 1];
  const error = lastNow ? str(rec(lastNow.result).error) : "";
  if (error) return say(`I couldn't do that: ${error.replace(/\.$/, "")}.`);

  // The Confirm card's Change button sends the bare word: show the spares again for the open replace or assign.
  if (CHANGE.test(text.trim())) return change(now, earlier);
  // The stock card's "Show 3 more": the next 3 of the last stock list.
  if (MORE_STOCK.test(text.trim())) return moreStock(now, earlier);

  const assetPick = PICK_ASSET.exec(text.trim());
  const personPick = assetPick ? null : PICK_PERSON.exec(text.trim());
  const ownIntent = intentOf(text);
  const typedTag = !assetPick && !personPick && !ownIntent ? TAG.exec(text)?.[0].toUpperCase() ?? null : null;
  const pickedTag = assetPick ? assetPick[1].toUpperCase() : typedTag;

  let request = text;
  let intent = ownIntent;
  if (assetPick || personPick || typedTag) {
    request = [...earlier.texts].reverse().find((t) => intentOf(t) !== null) ?? "";
    intent = intentOf(request);
  }
  if (!intent || (typedTag && !lastOf(earlier.results, "list_spares"))) return say(FAKE_FALLBACK);

  if (intent === "who") return who(text, now);
  // "Spares in stock": list_spares with no person — a read-only list. A pick needs a person first.
  if (intent === "stock") {
    if (assetPick || personPick || typedTag) return say("Who is it for? Give me their name and I'll list spares for them.");
    return stock(now);
  }

  // A spare was picked: propose.
  if (pickedTag && (intent === "replace" || intent === "assign")) return propose(intent, request, pickedTag, now, all);

  // Who it is for: the person's pick from a "Which one?" list, else a search for the name in their words.
  let person: Person | null = null;
  if (personPick) {
    const no = personPick[2];
    for (const r of [...all].reverse()) {
      if (r.name !== "find_people") continue;
      const hit = list(rec(r.result).people).find((p) => str(p.employeeNo) === no);
      if (hit) { person = personOf(hit); break; }
    }
    if (!person) return say(FAKE_FALLBACK);
  } else {
    const search = lastOf(now, "find_people");
    if (!search) {
      const q = nameIn(text);
      return q ? tool("find_people", { q }) : say("Who do you mean? Give me their name or employee no.");
    }
    const r = rec(search.result);
    const people = list(r.people);
    if (people.length === 0) return say(`I couldn't find anyone called ${str(search.input.q)}.`);
    if (r.picked !== true) return say("Which one do you mean? Pick from the list.");
    person = personOf(people[0]);
  }

  const held = lastOf(now, "get_holdings");
  if (intent === "holdings") return held ? say(holdingsText(held)) : tool("get_holdings", { employeeId: person.employeeId });
  if (intent === "replace" && !held) return tool("get_holdings", { employeeId: person.employeeId });
  if (!lastOf(now, "list_spares")) return tool("list_spares", { employeeId: person.employeeId });
  return say(`Pick a spare for ${person.name}, or scan its label.`);
}

/** Change: the spares again for the person of the last replace or assign (its list's own employeeId), then wait. */
function change(now: FakeToolResult[], earlier: FakeMemory): FakeDecision {
  const request = [...earlier.texts].reverse().find((t) => intentOf(t) !== null) ?? "";
  const intent = intentOf(request);
  const employeeId = str(lastOf(earlier.results, "list_spares")?.input.employeeId);
  if ((intent !== "replace" && intent !== "assign") || !employeeId) return say(FAKE_FALLBACK);
  if (!lastOf(now, "list_spares")) return tool("list_spares", { employeeId });
  return say("Pick a different spare, or scan its label.");
}

/** The spares in stock: list them (no person), then say what the read-only list shows. */
function stock(now: FakeToolResult[]): FakeDecision {
  const listed = lastOf(now, "list_spares");
  if (!listed) return tool("list_spares", {});
  const spares = list(rec(listed.result).spares);
  if (spares.length === 0) return say("No spares in stock right now.");
  return say(`Spares in stock: ${spares.map((s) => `${str(s.tag)} (${str(s.model)})`).join(", ")}. Tell me who one is for to give it to them.`);
}

/** "Show 3 more" on a stock list: the next 3 after the last stock list (one with no person), then say them. */
function moreStock(now: FakeToolResult[], earlier: FakeMemory): FakeDecision {
  if (lastOf(now, "list_spares")) return stock(now);
  const prev = lastOf(earlier.results, "list_spares");
  if (!prev || str(prev.input.employeeId)) return say(FAKE_FALLBACK);
  const offset = (typeof prev.input.offset === "number" ? prev.input.offset : 0) + 3;
  return tool("list_spares", { offset });
}

function holdingsText(held: FakeToolResult): string {
  const r = rec(held.result);
  const name = str(rec(r.person).name);
  const items = list(r.items);
  const gaps = list(r.gaps).map((g) => str(g.slot));
  const holds = list(r.holds).map((h) => str(h.tag));
  const has = items.length === 0
    ? `${name} has nothing at the moment.`
    : `${name} has ${items.length} item${items.length === 1 ? "" : "s"}: ${items.map((i) => `${str(i.tag)} (${str(i.model)})`).join(", ")}.`;
  return [has, gaps.length ? `Missing: ${gaps.join(", ")}.` : "", holds.length ? `On hold for them: ${holds.join(", ")}.` : ""]
    .filter(Boolean).join(" ");
}

function who(text: string, now: FakeToolResult[]): FakeDecision {
  const q = TAG.exec(text)?.[0].toUpperCase() ?? text.replace(/.*\bwho (has|holds)\b/i, "").replace(/[?.!]+$/, "").trim();
  const found = lastOf(now, "find_asset");
  if (!found) return tool("find_asset", { q });
  const assets = list(rec(found.result).assets);
  if (assets.length === 0) return say(`Nothing matches ${q}.`);
  const a = assets.find((x) => x.exact === true) ?? assets[0];
  const holder = rec(a.holder);
  return holder.name
    ? say(`${str(a.tag)} is with ${str(holder.name)} (${str(holder.employeeNo)}).`)
    : say(`${str(a.tag)} isn't with anyone — it's ${str(a.status)}.`);
}

function propose(intent: "replace" | "assign", request: string, tag: string, now: FakeToolResult[], all: FakeToolResult[]): FakeDecision {
  const proposed = lastOf(now, intent === "replace" ? "propose_replace" : "propose_assign");
  if (proposed) return say("Check the card, then press Confirm.");

  const spares = lastOf(all, "list_spares");
  const employeeId = str(spares?.input.employeeId);
  if (!employeeId) return say(FAKE_FALLBACK);

  // The spare's id: from the pick list shown, else look the (scanned) tag up first.
  let assetId = str(list(rec(spares?.result).spares).find((s) => str(s.tag).toUpperCase() === tag)?.assetId);
  if (!assetId) {
    const lookup = [...now].reverse().find((r) => r.name === "find_asset" && str(r.input.q).toUpperCase() === tag);
    if (!lookup) return tool("find_asset", { q: tag });
    assetId = str(list(rec(lookup.result).assets).find((a) => str(a.tag).toUpperCase() === tag)?.assetId);
    if (!assetId) return say(`Nothing matches ${tag}.`);
  }

  if (intent === "assign") return tool("propose_assign", { employeeId, assetId });

  const items = list(rec(lastOf(all, "get_holdings")?.result).items);
  const old = items.find((i) => /laptop/i.test(str(i.type))) ?? items[0];
  if (!old) return say("They don't hold anything to replace.");
  const outcome = /\b(broken|cracked)\b/i.test(request) ? "DEFECTIVE" : "TRIAGE";
  return tool("propose_replace", { employeeId, oldAssetId: str(old.assetId), newAssetId: assetId, outcome });
}
