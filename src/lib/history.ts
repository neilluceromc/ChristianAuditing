export interface AuditEntryLike {
  id: string;
  actorLabel: string;
  action: string;
  createdAt: Date;
  diff: unknown;
}

export interface HistoryRow {
  key: string;
  at: Date;
  actor: string;
  action: string;
  field: string;
  from: string;
  to: string;
  /** first row of its entry — later rows render with dimmed timestamp/actor */
  first: boolean;
}

const show = (v: unknown): string => (v === null || v === undefined || v === "" ? "—" : String(v));

/** "One row per field, not per save. Two rows sharing a timestamp were one action." */
export function historyRows(entries: AuditEntryLike[]): HistoryRow[] {
  const rows: HistoryRow[] = [];
  for (const entry of entries) {
    const diff = (entry.diff ?? null) as Record<string, { from: unknown; to: unknown }> | null;
    const fields = diff ? Object.keys(diff) : [];
    if (fields.length === 0) {
      rows.push({
        key: entry.id, at: entry.createdAt, actor: entry.actorLabel, action: entry.action,
        field: "—", from: "—", to: "—", first: true,
      });
      continue;
    }
    fields.forEach((field, i) => {
      rows.push({
        key: `${entry.id}:${field}`, at: entry.createdAt, actor: entry.actorLabel, action: entry.action,
        field, from: show(diff![field]?.from), to: show(diff![field]?.to), first: i === 0,
      });
    });
  }
  return rows;
}

export interface HistoryEntryGroup {
  key: string;
  at: Date;
  actor: string;
  action: string;
  /** one per changed field, in the diff's order; a diff-less entry has the single "—" row */
  fields: HistoryRow[];
}

/** Phase 39 (spec §5): the page's entries, each with its field rows together, so a long entry can fold. */
export function historyEntries(entries: AuditEntryLike[]): HistoryEntryGroup[] {
  return entries.map((entry) => {
    const fields = historyRows([entry]);
    return { key: entry.id, at: entry.createdAt, actor: entry.actorLabel, action: entry.action, fields };
  });
}
