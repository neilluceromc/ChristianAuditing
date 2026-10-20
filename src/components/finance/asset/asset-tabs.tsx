import { assetPageHref, type AssetPageState, type AssetTab } from "@/lib/finance-asset-page";
import { ListTabs, type TabDef } from "@/components/patterns/list-tabs";

export interface AssetTabsProps {
  id: string;
  state: AssetPageState;
  /** The useful life in months ("36 mo"); null when there is no schedule. */
  lifeMonths: number | null;
  /** Note threads, and the unresolved ones (the badge is amber while any is open). */
  noteCount: number;
  openNoteCount: number;
  attachmentCount: number;
  historyCount: number;
}

const LABELS: Record<AssetTab, string> = {
  ledger: "Depreciation ledger", notes: "Notes", files: "Attachments", history: "Financial history",
};

/** The four tabs (spec §4.1): each one a URL (`?tab=`), keeping the open document and the other tabs' filters. */
export function assetTabDefs(p: AssetTabsProps): TabDef[] {
  const def = (key: AssetTab, count: number, extra: Partial<TabDef> = {}): TabDef => ({
    key, label: LABELS[key], count, href: assetPageHref(p.id, p.state, { tab: key }), on: p.state.tab === key, ...extra,
  });
  return [
    def("ledger", p.lifeMonths ?? 0, { badge: p.lifeMonths === null ? "—" : `${p.lifeMonths} mo` }),
    def("notes", p.noteCount, p.openNoteCount > 0 ? { tone: "attention" } : {}),
    def("files", p.attachmentCount),
    def("history", p.historyCount),
  ];
}

/** Phase 47 (spec §4.1): the asset page's underlined tabs with badges — the Phase 45 ListTabs. */
export function AssetTabs(props: AssetTabsProps) {
  return <ListTabs tabs={assetTabDefs(props)} label="Asset sections" />;
}
