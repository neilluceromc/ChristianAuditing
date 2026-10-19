"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ButtonLink } from "@/components/ui/button-link";
import { Card } from "@/components/ui/card";
import { fmtDayMonth, fmtMoney } from "@/lib/format";
import type { GroupSummary } from "@/lib/equipment-report";
import { NO_POLICY_LINE, type ReportTab } from "./equipment-table";
import { replaceGuarded } from "@/lib/stuck-nav";

/** Spec §3.3: the first 20 people missing something are listed; the rest are on their staff list. */
export const MISSING_SHOWN = 20;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5 border-t border-border-faint pt-3">
      <h3 className="font-mono text-[10px] font-semibold uppercase tracking-[0.09em] text-fg-muted">{title}</h3>
      {children}
    </section>
  );
}

/**
 * Phase 38 (spec §3.3): the selected group's detail — what it holds by category, who is missing what (the profile's
 * numbered labels), its loans, and the links to its staff and its export. Values per category and the header's book
 * value appear only when the server sent them (Finance and Admin). × clears `?group`, keeping the tab.
 * The staff links render only when `canOpenStaff` (roles that can open /employees); otherwise the same words are
 * plain text and the staff button is left out.
 */
export function GroupDetail({
  group, tab, withMoney, canOpenStaff,
}: { group: GroupSummary; tab: ReportTab; withMoney: boolean; canOpenStaff: boolean }) {
  const router = useRouter();
  const staffHref = `/employees?department=${group.id}`;
  const maxCount = Math.max(1, ...group.byCategory.map((c) => c.count));
  const shown = group.missing.slice(0, MISSING_SHOWN);
  const more = group.missing.length - shown.length;

  return (
    <Card className="flex min-w-0 flex-col gap-3 p-4 lg:sticky lg:top-4">
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-fg-muted">
            {group.kind === "CLIENT" ? "Client account" : "Internal department"}
          </span>
          <h2 className="text-[17px] font-semibold leading-tight text-fg">{group.name}</h2>
          <p className="text-xs text-fg-secondary">
            {plural(group.people, "person", "people")} · {plural(group.items, "item", "items")}
            {withMoney && group.money && ` · ${fmtMoney(group.money.bookC / 100)}`}
            {withMoney && group.money && group.money.withoutCost > 0 && ` · ${group.money.withoutCost} without a cost`}
          </p>
        </div>
        <button
          type="button" aria-label="Close details"
          onClick={() => replaceGuarded(router, `/equipment-by-client?tab=${tab}`, { scroll: false })}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-(--radius-ctl) text-base text-fg-muted hover:bg-surface-subtle hover:text-fg"
        >
          ×
        </button>
      </header>

      <Section title="By category">
        {group.byCategory.length === 0 ? (
          <p className="text-xs text-fg-muted">Nothing held.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {group.byCategory.map((c) => (
              <li key={c.name} className="flex items-center gap-2 text-xs">
                <span className="w-24 shrink-0 truncate text-fg-secondary" title={c.name}>{c.name}</span>
                <span aria-hidden className="h-[6px] min-w-0 flex-1 overflow-hidden rounded-full bg-border-faint">
                  <span className="block h-full rounded-full bg-accent" style={{ width: `${(100 * c.count) / maxCount}%` }} />
                </span>
                <span className="w-8 shrink-0 text-right font-mono text-fg">{c.count}</span>
                {withMoney && c.bookC !== undefined && (
                  <span className="w-20 shrink-0 text-right font-mono text-fg-muted">{fmtMoney(c.bookC / 100)}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Missing something (${group.missing.length})`}>
        {group.noPolicy ? (
          <p className="text-xs" style={{ color: "var(--st-attention-text)" }}>{NO_POLICY_LINE}</p>
        ) : group.missing.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--st-settled-text)" }}>Everyone on {group.name} has their required kit.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {shown.map((p) => (
              <li key={p.id} className="flex flex-col text-xs">
                <span className="flex items-baseline gap-2">
                  {canOpenStaff ? (
                    <Link href={`/employees/${p.id}`} className="text-accent hover:underline">{p.name}</Link>
                  ) : (
                    <span className="text-fg">{p.name}</span>
                  )}
                  <span className="font-mono text-[11px] text-fg-muted">{p.employeeNo}</span>
                </span>
                <span className="text-fg-secondary">{p.labels.join(", ")}</span>
              </li>
            ))}
            {more > 0 && (
              <li className="text-xs">
                {canOpenStaff ? (
                  <Link href={staffHref} className="text-accent hover:underline">and {more} more — see their staff</Link>
                ) : (
                  <span className="text-fg-secondary">and {more} more — see their staff</span>
                )}
              </li>
            )}
          </ul>
        )}
      </Section>

      <Section title="On loan">
        <p className="text-xs text-fg-secondary">
          {group.loans === 0
            ? "Nothing on loan."
            : `${plural(group.loans, "item", "items")} on loan${group.nextLoanDue ? ` — next due ${fmtDayMonth(group.nextLoanDue)}` : ""}`}
        </p>
      </Section>

      <div className="flex flex-wrap gap-2 border-t border-border-faint pt-3">
        {canOpenStaff && <ButtonLink href={staffHref} size="sm">See their staff →</ButtonLink>}
        <ButtonLink href={`/equipment-by-client/export?tab=${tab}&group=${group.id}`} size="sm" native>
          Export {group.name} (.xlsx)
        </ButtonLink>
      </div>
    </Card>
  );
}
