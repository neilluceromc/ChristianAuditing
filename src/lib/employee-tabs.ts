import type { TabDef } from "@/components/patterns/list-tabs";
import { withFilter, type ListState } from "./url-state";

/**
 * Phase 45 (spec §3.1): the Employees tabs. One tab at a time: each is one filter (a facet value, or `gaps=1`),
 * and picking one clears every other tab's filter. The search, Works for and leavers scope are not tab filters
 * and stay put.
 */
interface EmployeeTabDef {
  key: string;
  label: string;
  /** the facet value this tab sets; absent on All and on Missing kit */
  facet?: string;
  value?: string;
  /** Missing kit is `gaps=1`, carried outside ListConfig */
  gaps?: true;
  tone?: TabDef["tone"];
}

export const EMPLOYEE_TABS: readonly EmployeeTabDef[] = [
  { key: "all", label: "All" },
  { key: "client", label: "Client staff", facet: "kind", value: "CLIENT" },
  { key: "internal", label: "Internal staff", facet: "kind", value: "INTERNAL" },
  { key: "leaving", label: "Leaving", facet: "employment", value: "OFFBOARDING", tone: "inflight" },
  { key: "gaps", label: "Missing kit", gaps: true, tone: "attention" },
  { key: "joined", label: "New this month", facet: "joined", value: "month" },
];

/** The facets the tabs own; the counts' base is the state with these removed. */
export const TAB_FACETS = ["kind", "employment", "joined"] as const;

/** `state` with every tab filter removed (and gaps off): the scope each tab's count is taken over. */
export function employeeTabBase(state: ListState): ListState {
  return { ...state, page: 1, filters: Object.fromEntries(Object.entries(state.filters).filter(([k]) => !(TAB_FACETS as readonly string[]).includes(k))) };
}

/** The state a tab links to: the other tabs' filters and gaps cleared, this tab's set, page 1. Unknown keys act as All. */
export function employeeTabState(state: ListState, gapsOnly: boolean, tab: string): { state: ListState; gapsOnly: boolean } {
  void gapsOnly; // every tab starts from gaps off; only Missing kit turns it on
  const base = employeeTabBase(state);
  const def = EMPLOYEE_TABS.find((t) => t.key === tab);
  if (def?.facet && def.value) return { state: withFilter(base, def.facet, [def.value]), gapsOnly: false };
  return { state: base, gapsOnly: def?.gaps === true };
}

/** The one tab whose filter is exactly what is applied, or null (e.g. `employment=OFFBOARDED`, two kinds, gaps with a kind). */
function activeTabKey(state: ListState, gapsOnly: boolean): string | null {
  const set = TAB_FACETS.filter((f) => state.filters[f]?.length);
  if (set.length === 0) return gapsOnly ? "gaps" : "all";
  if (gapsOnly || set.length > 1) return null;
  const values = state.filters[set[0]];
  if (values.length !== 1) return null;
  return EMPLOYEE_TABS.find((t) => t.facet === set[0] && t.value === values[0])?.key ?? null;
}

export function buildEmployeeTabs(
  state: ListState, gapsOnly: boolean, counts: Record<string, number>, hrefFor: (s: ListState, gaps: boolean) => string,
): TabDef[] {
  const active = activeTabKey(state, gapsOnly);
  return EMPLOYEE_TABS.map((t): TabDef => {
    const target = employeeTabState(state, gapsOnly, t.key);
    return {
      key: t.key, label: t.label, count: counts[t.key] ?? 0, href: hrefFor(target.state, target.gapsOnly), on: active === t.key,
      ...(t.tone ? { tone: t.tone } : {}),
    };
  });
}
