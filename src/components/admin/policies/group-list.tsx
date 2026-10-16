"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { filterGroups, showCounts, sortGroups, type GroupRow } from "@/lib/groups";
import { LEAVE_UNSAVED, usePolicyDirty } from "./dirty-context";

export type PolicyTab = "client" | "internal";

const TABS: Array<{ tab: PolicyTab; label: string }> = [
  { tab: "client", label: "Clients" },
  { tab: "internal", label: "Internal" },
];

/** Phase 37 (spec §3.3): the left list — tabs, search, "only those without a policy", one row per active group. */
export function GroupList({
  tab, rows, counts, selectedId,
}: {
  tab: PolicyTab;
  /** the active groups of this tab's kind */
  rows: GroupRow[];
  /** active groups per tab */
  counts: Record<PolicyTab, number>;
  selectedId: string | null;
}) {
  const dirty = usePolicyDirty();
  const [q, setQ] = useState("");
  const [onlyNone, setOnlyNone] = useState(false);
  const kind = tab === "client" ? "CLIENT" : "INTERNAL";
  const find = tab === "client" ? "Find a client" : "Find a department";

  const none = useMemo(() => showCounts(rows, kind).nopol, [rows, kind]);
  const shown = useMemo(
    () => sortGroups(filterGroups(rows, { kind, q, show: onlyNone ? "nopol" : "active" }), "name", 1),
    [rows, kind, q, onlyNone],
  );

  /** Following a link away from unsaved edits asks first (the editor reports through the page's context). */
  const guard = (e: React.MouseEvent) => {
    if (dirty.any() && !window.confirm(LEAVE_UNSAVED)) e.preventDefault();
  };

  return (
    <Card className="flex flex-col gap-2.5 p-3 lg:sticky lg:top-4">
      <nav aria-label="Kind of staff group" className="flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <Link
            key={t.tab}
            href={`/admin/equipment-policies?tab=${t.tab}`}
            aria-current={tab === t.tab ? "page" : undefined}
            onClick={guard}
            className={cn(
              "relative px-3 py-2 text-[12.5px] font-medium transition-colors duration-(--dur-1)",
              tab === t.tab ? "text-fg" : "text-fg-muted hover:text-fg-secondary",
            )}
          >
            {t.label} <span className="font-mono text-[11px] text-fg-muted">{counts[t.tab]}</span>
            {tab === t.tab && <span aria-hidden className="absolute inset-x-2 bottom-0 h-[2px] bg-accent" />}
          </Link>
        ))}
      </nav>

      <div>
        <label htmlFor="policy-groups-find" className="sr-only">{find}</label>
        <Input
          id="policy-groups-find" type="search" data-page-search value={q} placeholder={`${find}…`} className="py-1.5 text-xs"
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <label className="flex items-center gap-2 text-xs text-fg-secondary">
        <Checkbox checked={onlyNone} onChange={(e) => setOnlyNone(e.target.checked)} />
        Only those without a policy ({none})
      </label>

      <ul className="max-h-[640px] overflow-auto">
        {shown.map((row) => {
          const selected = row.id === selectedId;
          const has = !!row.policyItems;
          return (
            <li key={row.id}>
              <Link
                href={`/admin/equipment-policies?tab=${tab}&group=${row.id}`}
                aria-current={selected ? "page" : undefined}
                onClick={guard}
                className={cn(
                  "flex items-center gap-2 rounded-[5px] px-2.5 py-1.5 text-[12.5px]",
                  selected ? "bg-accent-tint text-fg" : "text-fg-secondary hover:bg-surface-subtle",
                )}
              >
                <span
                  aria-hidden
                  data-has-policy={has ? "yes" : "no"}
                  className={cn("size-2 shrink-0 rounded-full", has ? "bg-[var(--st-settled-dot)]" : "bg-[var(--st-attention-dot)]")}
                />
                <span className="min-w-0 flex-1 truncate">{row.name}</span>
                <span className="font-mono text-[11px] text-fg-muted">
                  <span className="sr-only"> · </span>{row.people}<span className="sr-only"> {row.people === 1 ? "person" : "people"}</span>
                </span>
              </Link>
            </li>
          );
        })}
        {shown.length === 0 && <li className="px-2.5 py-4 text-center text-xs text-fg-muted">No match.</li>}
      </ul>

      <p className="flex items-center gap-3 border-t border-border-faint pt-2 text-[11px] text-fg-muted">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-full bg-[var(--st-settled-dot)]" />has a policy
        </span>
        <span aria-hidden>·</span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-full bg-[var(--st-attention-dot)]" />none yet
        </span>
      </p>
    </Card>
  );
}
