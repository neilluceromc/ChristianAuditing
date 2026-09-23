import { TAG_SHAPE, tagKey } from "./tag-key";

/**
 * Phase 30 (spec §5.2–§5.5): the Register form's rows — one tag and one serial
 * per unit — and the rules that read them. Pure, so the form and its tests
 * agree on what a row, a repeat and a bad tag are. Rows are 0-based here and
 * 1-based in every message, as the form labels them (Tag 1, Serial 1).
 */
export interface RegisterRow {
  tag: string;
  serial: string;
}

/** The most units one registration writes — `registerAssets` refuses more. */
export const MAX_BATCH = 200;

const more = (k: number) => (k > 0 ? ` and ${k} more` : "");

/** A count typed into Quantity applies at once only when it already is one (1–200). */
export function liveQuantity(text: string): number | null {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= MAX_BATCH ? n : null;
}

/** On blur Quantity clamps to 1–200; text that is not a number keeps the current count. */
export function clampQuantity(text: string, current: number): number {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return current;
  return Math.min(MAX_BATCH, Math.max(1, Number(t)));
}

/** Resize to `count` rows: every existing row stays as typed, new rows take the run's tags (blank without one). */
export function resizeRows(rows: readonly RegisterRow[], count: number, runTags: readonly string[] | null): RegisterRow[] {
  return Array.from({ length: count }, (_, i) => rows[i] ?? { tag: runTags?.[i] ?? "", serial: "" });
}

/** A new prefix or category re-suggests every tag; the serials typed so far stay. */
export function retagRows(rows: readonly RegisterRow[], runTags: readonly string[] | null): RegisterRow[] {
  return rows.map((r, i) => ({ ...r, tag: runTags?.[i] ?? "" }));
}

export function serialsEntered(rows: readonly RegisterRow[]): number {
  return rows.filter((r) => r.serial.trim()).length;
}

/**
 * Paste a column of serials at row `at`: it fills that row and the rows below,
 * growing the batch (never shrinking it) up to MAX_BATCH. `runTags(count)`
 * gives the suggested tags for a batch of `count`, for the rows it adds.
 */
export function pasteSerials(
  rows: readonly RegisterRow[],
  at: number,
  values: readonly string[],
  runTags: (count: number) => readonly string[] | null,
): { rows: RegisterRow[]; pasted: number } {
  const pasted = Math.max(0, Math.min(values.length, MAX_BATCH - at));
  const count = Math.max(rows.length, at + pasted);
  const grown = resizeRows(rows, count, count > rows.length ? runTags(count) : null);
  return {
    rows: grown.map((r, i) => (i >= at && i < at + pasted ? { ...r, serial: values[i - at] } : r)),
    pasted,
  };
}

function repeated(values: readonly string[]): { first: number; rows: Set<number> } {
  const seen = new Set<string>();
  const rows = new Set<number>();
  let first = -1;
  values.forEach((v, i) => {
    if (!v) return;
    if (seen.has(v)) {
      rows.add(i);
      if (first < 0) first = i;
    } else seen.add(v);
  });
  return { first, rows };
}

/** A tag typed twice in one batch — the later row named, in `registerAssets`'s words. */
export function repeatedTags(rows: readonly RegisterRow[]): { message: string | null; rows: Set<number> } {
  const keys = rows.map((r) => tagKey(r.tag));
  const r = repeated(keys);
  return { message: r.first < 0 ? null : `Row ${r.first + 1} · ${keys[r.first]} appears twice in this batch`, rows: r.rows };
}

/** A serial typed twice in one batch — blanks never count as a repeat. */
export function repeatedSerials(rows: readonly RegisterRow[]): { message: string | null; rows: Set<number> } {
  const serials = rows.map((r) => r.serial.trim());
  const r = repeated(serials);
  return { message: r.first < 0 ? null : `Row ${r.first + 1} · serial ${serials[r.first]} appears twice in this batch`, rows: r.rows };
}

/** Rows whose tag does not read BR-XX-0000 (upper-casing is the server's job, so case is forgiven). */
export function badTags(rows: readonly RegisterRow[], example: string): { message: string | null; rows: Set<number> } {
  const bad = rows.flatMap((r, i) => (TAG_SHAPE.test(tagKey(r.tag)) ? [] : [i]));
  if (bad.length === 0) return { message: null, rows: new Set() };
  const first = rows[bad[0]].tag.trim();
  const what = first ? `${first} does not read like ${example}` : `Type a tag like ${example}`;
  return { message: `Row ${bad[0] + 1} · ${what}${more(bad.length - 1)}`, rows: new Set(bad) };
}

export interface IdentifierHits {
  tags: ReadonlyArray<{ tag: string; id: string }>;
  serials: ReadonlyArray<{ serial: string; id: string; tag: string }>;
}

/** `checkIdentifiers`' records matched onto the rows as typed now — a row edited away stops matching. */
export function registeredRows(rows: readonly RegisterRow[], hits: IdentifierHits): {
  tags: Array<{ row: number; tag: string; id: string }>;
  serials: Array<{ row: number; serial: string; id: string; tag: string }>;
} {
  const byTag = new Map(hits.tags.map((h) => [h.tag, h.id]));
  const bySerial = new Map(hits.serials.map((h) => [h.serial, h]));
  const tags: Array<{ row: number; tag: string; id: string }> = [];
  const serials: Array<{ row: number; serial: string; id: string; tag: string }> = [];
  rows.forEach((r, row) => {
    const key = tagKey(r.tag);
    const id = key ? byTag.get(key) : undefined;
    if (id) tags.push({ row, tag: key, id });
    const s = r.serial.trim();
    const on = s ? bySerial.get(s) : undefined;
    if (on) serials.push({ row, serial: s, id: on.id, tag: on.tag });
  });
  return { tags, serials };
}

/**
 * Ruling R3: at quantity 1 the form submits through `createAsset`, whose keys
 * are `tag` / `serial`; they land under the rows as row 1's, like the batch's
 * `tags` / `serials`. A serial message that already names its serial stays as is.
 */
export function singleRowErrors(fieldErrors: Record<string, string>): Record<string, string> {
  const { tag, serial, ...rest } = fieldErrors;
  const out: Record<string, string> = { ...rest };
  if (tag) out.tags = `Row 1 · ${tag}`;
  if (serial) out.serials = serial.startsWith("Serial ") ? serial : `Row 1 · ${serial}`;
  return out;
}

/** The rows a server message names — `Row n · …`, `Serial s is already on …`, or zod's `tags.i` / `serials.i`. */
export function serverRowMarks(errors: Record<string, string>, rows: readonly RegisterRow[]): { tags: Set<number>; serials: Set<number> } {
  const marks = { tags: new Set<number>(), serials: new Set<number>() };
  for (const kind of ["tags", "serials"] as const) {
    const message = errors[kind];
    const named = message?.match(/^Row (\d+) · /);
    if (named) marks[kind].add(Number(named[1]) - 1);
    const onSerial = kind === "serials" ? message?.match(/^Serial (.+) is already on /) : null;
    if (onSerial) rows.forEach((r, i) => r.serial.trim() === onSerial[1] && marks.serials.add(i));
    for (const key of Object.keys(errors)) {
      const index = key.startsWith(`${kind}.`) ? key.slice(kind.length + 1) : "";
      if (/^[0-9]+$/.test(index)) marks[kind].add(Number(index));
    }
  }
  return marks;
}
