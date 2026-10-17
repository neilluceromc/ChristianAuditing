import type Anthropic from "@anthropic-ai/sdk";
import { parseCrisCard, type CrisCard } from "./cris-cards";
import { boxNote } from "./cris-prompt";

/*
 * The conversation as the model reads it, rebuilt from the stored CrisMessage rows. The model's history is
 * append-only (spec §8; preserved thinking): every request replays every earlier turn exactly as it was first
 * sent — thinking blocks included, never edited. So each row stores the exact messages it sent the model, as a
 * JSON string: Postgres jsonb re-orders object keys, which would re-order a tool call's input and change what the
 * model wrote. A string value is kept byte for byte.
 *
 * Rows and what they hold (`content`):
 *  - "user": `{ text, cards: [], api }` — the person's message (context block + words), one MessageParam;
 *  - "tool": `{ api }` — one tool round: the model's tool calls and the results sent back (two MessageParams);
 *  - "cris" written by the turn: `{ text, cards, api }` — the final reply (one MessageParam, or none);
 *  - "cris" written by Confirm or Undo (no `api`): told to the model as a box note before the next person message.
 */

export type StoredRow = { role: string; content: unknown };
export type StoredContent = { text?: string | null; cards?: CrisCard[]; api?: string };

export function encodeApi(messages: Anthropic.MessageParam[]): string {
  return JSON.stringify(messages);
}

/** A row's content to store: the box's text and cards, and the model messages as an exact string. */
export function storedContent(c: { text: string | null; cards: CrisCard[]; api: Anthropic.MessageParam[] }): StoredContent {
  return { text: c.text, cards: c.cards, api: encodeApi(c.api) };
}

const obj = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/**
 * The model messages a row stored: null when it stored none (a box note), [] when the reply was empty, and [] for
 * a row whose `api` can't be read (never sent half-parsed).
 */
export function decodeApi(content: unknown): Anthropic.MessageParam[] | null {
  const api = obj(content)?.api;
  if (api === undefined) return null;
  if (typeof api !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(api);
    return Array.isArray(parsed) ? (parsed as Anthropic.MessageParam[]) : [];
  } catch {
    return [];
  }
}

function cardsOf(content: unknown): CrisCard[] {
  const cards = obj(content)?.cards;
  return Array.isArray(cards) ? cards.map(parseCrisCard).filter((c): c is CrisCard => c !== null) : [];
}

function textOf(content: unknown): string | null {
  const text = obj(content)?.text;
  return typeof text === "string" ? text : null;
}

/**
 * The history to send, rows oldest first. A box note (a Cris row with no `api`) is held back until just before the
 * next person message: Confirm can be pressed while a turn is running, and a note slipped between that turn's
 * rounds would change what those rounds were sent. Held back, every earlier request's messages stay a prefix of
 * every later one.
 */
export function modelHistory(rows: StoredRow[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  let notes: Anthropic.MessageParam[] = [];
  for (const row of rows) {
    const api = decodeApi(row.content);
    if (api === null) {
      if (row.role === "cris" || row.role === "assistant") {
        notes.push({ role: "user", content: boxNote({ text: textOf(row.content), cards: cardsOf(row.content) }) });
      }
      continue;
    }
    if (row.role === "user") {
      out.push(...notes);
      notes = [];
    }
    out.push(...api);
  }
  out.push(...notes);
  return out;
}

/**
 * Is a turn still running in this conversation? Looks at the newest TURN row — one that carries the model's
 * `api` (box notes from Confirm and Undo carry none and are skipped): a turn's last row is its Cris reply, so a
 * newest person or tool row younger than `guardMs` means one is in flight. Older, it was a crash: no longer blocks.
 * `newestFirst` is the conversation's newest rows, newest first.
 */
export function turnInFlight(newestFirst: Array<StoredRow & { createdAt: Date }>, now: Date, guardMs: number): boolean {
  const turnRow = newestFirst.find((r) => decodeApi(r.content) !== null);
  if (!turnRow || turnRow.role === "cris" || turnRow.role === "assistant") return false;
  return now.getTime() - turnRow.createdAt.getTime() < guardMs;
}

/** The pick card still open on a Cris message (a spares list or a "Which one?" list), or null. */
export function openPickCard(content: unknown): CrisCard | null {
  return cardsOf(content).find((c) => c.type === "spares" || c.type === "which") ?? null;
}

/** The tags on a Cris message's spares card — the pick list open in the box, so a bare "0230" can name one. */
export function spareTagsOf(content: unknown): string[] {
  const spares = cardsOf(content).find((c) => c.type === "spares");
  return spares?.type === "spares" ? spares.options.map((o) => o.tag) : [];
}
