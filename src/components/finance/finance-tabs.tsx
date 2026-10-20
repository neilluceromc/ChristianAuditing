import { FIN_LABEL, type FinFilter } from "@/lib/registration";
import { financeListHref, withFinance, type FinanceListState } from "@/lib/finance-list";
import { ListTabs, type TabDef } from "@/components/patterns/list-tabs";

type FinCount = { key: FinFilter | "all"; count: number };

/** Spec §3 item 5: the To review badge is amber and the Sent back badge red, while their count is above 0. */
const TONE: Partial<Record<FinFilter, NonNullable<TabDef["tone"]>>> = { "with-finance": "attention", "needs-correction": "fault" };

/**
 * The finance-state tabs, in the query's order (All, To review, Sent back, Waiting for IT on IT only, Approved, Not
 * capitalised, No cost). Each sets `?fin=` (All clears it), keeping every other filter, back to page 1.
 */
export function financeTabDefs(state: FinanceListState, counts: FinCount[]): TabDef[] {
  return counts.map(({ key, count }) => {
    const fin = key === "all" ? null : key;
    const tone = fin && count > 0 ? TONE[fin] : undefined;
    return {
      key,
      label: fin ? FIN_LABEL[fin] : "All",
      count,
      href: financeListHref(withFinance(state, { fin })),
      on: state.fin === fin,
      ...(tone ? { tone } : {}),
    };
  });
}

/**
 * Phase 47 (spec §3 item 5): the table card's underlined finance-state tabs with count badges — the Phase 45 tabs,
 * replacing the old finance chips. A Server Component: the hrefs are built here and only strings reach ListTabs.
 */
export function FinanceTabs({ state, counts }: { state: FinanceListState; counts: FinCount[] }) {
  return <ListTabs tabs={financeTabDefs(state, counts)} label="Finance state" />;
}
