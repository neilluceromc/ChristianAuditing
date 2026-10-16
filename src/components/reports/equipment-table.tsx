"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Td, TBody, Th, THead, Tr } from "@/components/ui/table";
import { cn } from "@/lib/cn";
import { fmtMoney } from "@/lib/format";
import {
  defaultReportSort, equippedTone, filterReportGroups, reportFilterCounts, sortReportGroups,
  type GroupSummary, type ReportFilter, type ReportSort,
} from "@/lib/equipment-report";

export type ReportTab = "client" | "internal";

const WORDS = {
  client: { find: "Find a client", sub: "Client account", one: "client", many: "clients", empty: "No clients yet" },
  internal: { find: "Find a department", sub: "Internal department", one: "department", many: "departments", empty: "No departments yet" },
} as const;

const FILTERS: Array<{ value: ReportFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "gaps", label: "With gaps" },
  { value: "nopol", label: "No policy" },
];

/** Spec §3.3's Equipped colours, as the house status tokens. */
const TONE = {
  settled: { bar: "var(--st-settled-dot)", text: "var(--st-settled-text)" },
  attention: { bar: "var(--st-attention-dot)", text: "var(--st-attention-text)" },
  fault: { bar: "var(--st-fault-dot)", text: "var(--st-fault-text)" },
} as const;

export const NO_POLICY_LINE = "No equipment policy — gaps not tracked";

/**
 * Phase 38 (spec §3.3): one tab's groups — search, the three filters with counts, sortable headers and the Equipped
 * bar, in the browser over the rows the page already has. A row's name selects it (`?group=`, keeping the tab).
 * `rows` carry `money` only when the server computed it for a money role; `withMoney` only shows the columns.
 */
export function EquipmentTable({
  tab, rows, withMoney, selectedId, canManageGroups,
}: {
  tab: ReportTab;
  rows: GroupSummary[];
  withMoney: boolean;
  selectedId: string | null;
  /** the empty state links to Departments & clients only for roles that can open it */
  canManageGroups: boolean;
}) {
  const router = useRouter();
  const w = WORDS[tab];
  const initial = defaultReportSort(withMoney);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<ReportFilter>("all");
  const [sort, setSort] = useState<ReportSort>(initial.sort);
  const [dir, setDir] = useState<1 | -1>(initial.dir);
  // the highlight moves at once; the server's re-render with the new ?group= then confirms it
  const [picked, setPicked] = useState(selectedId);
  useEffect(() => setPicked(selectedId), [selectedId]);

  const counts = useMemo(() => reportFilterCounts(rows), [rows]);
  const shown = useMemo(() => sortReportGroups(filterReportGroups(rows, { q, filter }), sort, dir), [rows, q, filter, sort, dir]);

  function toggleSort(col: ReportSort) {
    if (sort === col) setDir((d) => (d === 1 ? -1 : 1));
    else { setSort(col); setDir(col === "name" ? 1 : -1); }
  }
  const sortOf = (col: ReportSort) => (sort === col ? (dir === 1 ? "asc" : "desc") : undefined);

  function select(id: string) {
    setPicked(id);
    router.replace(`/equipment-by-client?tab=${tab}&group=${id}`, { scroll: false });
  }

  if (rows.length === 0) {
    return (
      <Card className="px-4 py-8 text-center text-xs text-fg-muted">
        {w.empty} — add them on{" "}
        {canManageGroups ? (
          <Link href={tab === "internal" ? "/admin/departments?tab=internal" : "/admin/departments"} className="text-accent hover:underline">Departments &amp; clients</Link>
        ) : (
          "Departments & clients"
        )}
        .
      </Card>
    );
  }

  const columns = withMoney ? 7 : 5;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[200px] flex-1 sm:max-w-[280px]">
          <label htmlFor="equipment-groups-find" className="sr-only">{w.find}</label>
          <Input
            id="equipment-groups-find" type="search" value={q} placeholder={`${w.find}…`} className="py-1.5 text-xs"
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div role="group" aria-label="Which rows to show" className="inline-flex rounded-(--radius-btn) border border-border-strong bg-surface-subtle p-0.5">
          {FILTERS.map((f) => (
            <button
              key={f.value} type="button" aria-pressed={filter === f.value} onClick={() => setFilter(f.value)}
              className={cn(
                "rounded-[5px] px-3 py-1 text-xs font-medium transition-colors duration-(--dur-1)",
                filter === f.value ? "bg-surface text-fg shadow-card" : "text-fg-muted hover:text-fg-secondary",
              )}
            >
              {f.label} <span className="font-mono text-[11px]">{counts[f.value]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="max-h-[470px] overflow-auto rounded-(--radius-card) border border-border bg-surface shadow-card">
        <table className="w-full border-collapse text-[12.5px]">
          <THead>
            <Tr className="hover:bg-transparent">
              <Th sort={sortOf("name")} onSort={() => toggleSort("name")}>Name</Th>
              <Th width={90} align="right" sort={sortOf("people")} onSort={() => toggleSort("people")}>People</Th>
              <Th width={80} align="right" sort={sortOf("items")} onSort={() => toggleSort("items")}>Items</Th>
              {withMoney && <Th width={120} align="right" sort={sortOf("book")} onSort={() => toggleSort("book")}>Book value</Th>}
              {withMoney && <Th width={110} align="right">Per person</Th>}
              <Th width={190} sort={sortOf("equipped")} onSort={() => toggleSort("equipped")}>Equipped</Th>
              <Th width={80} align="right">On loan</Th>
            </Tr>
          </THead>
          <TBody>
            {shown.map((g) => {
              const tone = equippedTone(g.equippedPct);
              return (
                <Tr key={g.id} selected={g.id === picked}>
                  <Td>
                    <div className="flex flex-col items-start py-1.5">
                      <button
                        type="button" onClick={() => select(g.id)}
                        className="text-left text-[12.5px] font-medium text-fg hover:text-accent hover:underline"
                      >
                        {g.name}
                      </button>
                      {g.noPolicy ? (
                        <span className="text-[10.5px]" style={{ color: "var(--st-attention-text)" }}>{NO_POLICY_LINE}</span>
                      ) : (
                        <span className="text-[10.5px] text-fg-muted">{w.sub}</span>
                      )}
                    </div>
                  </Td>
                  <Td mono align="right">{g.people}</Td>
                  <Td mono align="right">{g.items}</Td>
                  {withMoney && <Td mono align="right">{fmtMoney((g.money?.bookC ?? 0) / 100)}</Td>}
                  {withMoney && <Td mono align="right">{fmtMoney((g.money?.perPersonC ?? 0) / 100)}</Td>}
                  <Td>
                    {tone === null || g.equippedPct === null ? (
                      <span className="text-fg-muted">—</span>
                    ) : (
                      <div className="flex flex-col gap-0.5 py-1.5">
                        <div className="flex items-center gap-2">
                          <span aria-hidden className="h-[6px] w-16 overflow-hidden rounded-full bg-border-faint">
                            <span className="block h-full rounded-full" style={{ width: `${g.equippedPct}%`, background: TONE[tone].bar }} />
                          </span>
                          <span className="font-mono text-xs font-semibold" style={{ color: TONE[tone].text }} data-tone={tone}>
                            {g.equippedPct}%
                          </span>
                        </div>
                        <span className="text-[10.5px] text-fg-muted">
                          {g.missing.length > 0 ? `${g.missing.length} missing something` : "everyone equipped"}
                        </span>
                      </div>
                    )}
                  </Td>
                  <Td mono align="right">{g.loans > 0 ? g.loans : "—"}</Td>
                </Tr>
              );
            })}
            {shown.length === 0 && (
              <tr>
                <td colSpan={columns} className="px-3 py-8 text-center text-xs text-fg-muted">Nothing matches.</td>
              </tr>
            )}
          </TBody>
        </table>
      </div>

      <div className="flex flex-col gap-0.5 text-xs text-fg-muted">
        <p>{shown.length} of {rows.length} {rows.length === 1 ? w.one : w.many}.</p>
        {withMoney && (
          <p>
            Book value is today&apos;s: the month an item was purchased counts as month 1 in full. Items without a cost
            count as ₱0 and are listed in the export.
          </p>
        )}
        <p>{"\"Equipped\" = people with no required gap ÷ people."}</p>
      </div>
    </div>
  );
}
