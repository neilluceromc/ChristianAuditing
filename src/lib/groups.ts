export type GroupKindValue = "INTERNAL" | "CLIENT";

export interface GroupRow {
  id: string;
  name: string;
  kind: GroupKindValue;
  archivedAt: string | null;
  locked: boolean;
  people: number;
  policyItems: number | null;
}

export type GroupShow = "active" | "nopol" | "ended" | "all";

/** Phase 37 (spec §2.2): the one text a name clash shows, on the page and from the server. */
export const GROUP_NAME_TAKEN = "A department or client with that name already exists";
export const GROUP_ARCHIVED = "That department or client is archived";

const byName = <T extends { name: string }>(a: T, b: T) =>
  a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });

const matchesShow = (r: GroupRow, show: GroupShow): boolean =>
  show === "active" ? !r.archivedAt
  : show === "nopol" ? !r.archivedAt && !r.policyItems
  : show === "ended" ? !!r.archivedAt
  : true;

export function filterGroups(rows: GroupRow[], f: { kind: GroupKindValue; q: string; show: GroupShow }): GroupRow[] {
  const q = f.q.trim().toLowerCase();
  return rows.filter((r) => r.kind === f.kind && matchesShow(r, f.show) && (!q || r.name.toLowerCase().includes(q)));
}

export function sortGroups(rows: GroupRow[], sort: "name" | "people", dir: 1 | -1): GroupRow[] {
  return [...rows].sort((a, b) => {
    if (sort === "name") return byName(a, b) * dir;
    return (a.people - b.people) * dir || byName(a, b);
  });
}

export function showCounts(rows: GroupRow[], kind: GroupKindValue): Record<GroupShow, number> {
  const mine = rows.filter((r) => r.kind === kind);
  const count = (show: GroupShow) => mine.filter((r) => matchesShow(r, show)).length;
  return { active: count("active"), nopol: count("nopol"), ended: count("ended"), all: mine.length };
}

export interface PickerGroup { id: string; name: string; kind: GroupKindValue; archivedAt: Date | string | null }

/** Active rows of each kind, sorted by name (natural); `keepId` is kept even when archived (an edit form's current value). */
export function groupPickerOptions<G extends PickerGroup>(rows: G[], keepId?: string | null): { internal: G[]; client: G[] } {
  const usable = rows.filter((r) => !r.archivedAt || r.id === keepId).sort(byName);
  return { internal: usable.filter((r) => r.kind === "INTERNAL"), client: usable.filter((r) => r.kind === "CLIENT") };
}
