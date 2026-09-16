import { Tabs } from "@/components/ui/tabs";

export type StockReportTab = "on-hand" | "consumption" | "expiry";

const TABS: Array<{ id: StockReportTab; label: string; href: string }> = [
  { id: "on-hand", label: "On hand", href: "/stock/reports/on-hand" },
  { id: "consumption", label: "Consumption", href: "/stock/reports/consumption" },
  { id: "expiry", label: "Expiry", href: "/stock/reports/expiry" },
];

/** Spec §6: the three report screens share one tab row — plain links, page reloads on switch (no client state to preserve across tabs). */
export function ReportTabs({ active }: { active: StockReportTab }) {
  return (
    <Tabs
      label="Stock reports"
      items={TABS.map((t) => ({ label: t.label, href: t.href, active: t.id === active }))}
    />
  );
}
