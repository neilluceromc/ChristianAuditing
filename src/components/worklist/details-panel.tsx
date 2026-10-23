"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { LoanDueDialog } from "@/components/inventory/loan-due-control";
import { cn } from "@/lib/cn";
import { fmtDate } from "@/lib/format";
import { workRowHref, type WorkFact, type WorkItem } from "@/lib/worklist";
import { emptyQueue, recordHref } from "@/lib/worklist-view";
import type { WorkSectionId } from "@/lib/worklist";
import { PANEL_BUTTON, TriageActions, busyProps, unlessBusy } from "./triage-actions";
import type { WorklistDecisions } from "./use-worklist-undo";

/** The record page's own date-input shape (inventory/[id]/(record)/layout.tsx). */
const isoDay = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : null);

/** The square's letters: an asset's kind from its tag (BR-LT-1025 → LT), a person's initials, PO, AP. */
function badge(item: WorkItem): string {
  const c = item.columns;
  if ("item" in c) return c.item.tag.split("-")[1]?.slice(0, 2) ?? "IT";
  if (c.section === "purchases") return "PO";
  const name = c.section === "hires" ? c.person.name : item.entity?.kind === "employee" ? item.entity.label : null;
  if (name) return name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return "AP";
}

/** The panel's title and the line under it. */
function identity(item: WorkItem): { title: string; sub: React.ReactNode } {
  const c = item.columns;
  if ("item" in c) return { title: c.item.model, sub: <><span className="font-mono">{c.item.tag}</span> · {c.item.category ?? "Uncategorised"}</> };
  switch (c.section) {
    case "purchases": return { title: c.po.refNo, sub: c.po.summary ?? "No lines" };
    case "hires": return { title: c.person.name, sub: <span className="font-mono">{c.person.employeeNo}</span> };
    case "queue": return { title: c.what, sub: c.who };
    default: return { title: item.title, sub: item.meta };
  }
}

const TONE: Record<NonNullable<WorkFact["tone"]>, string> = {
  good: "text-(--st-settled-text)",
  muted: "text-fg-muted",
  fault: "font-medium text-(--st-fault-text)",
};

/**
 * The details panel (plan call 3): who or what the row is, the note when there is one ("Note when returned …
 * recorded by {name}" — never words put in the holder's mouth), real facts only, the last three lifecycle events,
 * then the queue's actions pinned at the bottom with the record link and Hide until tomorrow. The facts scroll
 * inside the panel as a last resort; the actions never move. A viewer sees the facts and links, no buttons.
 */
export function DetailsPanel({ item, section, canAct, decisions, headingId, filtered = false }: {
  item: WorkItem | null;
  section: WorkSectionId;
  canAct: boolean;
  /** the queue has rows, but the filters hide every one (fix round 1, M2): the panel says so, not "All clear" */
  filtered?: boolean;
  decisions: Pick<WorklistDecisions, "busy" | "triage" | "check" | "hide">;
  /** the panel's heading id (the aside is labelled by it) */
  headingId?: string;
}) {
  if (!item && filtered) {
    return <p className="m-auto text-[13px] text-fg-muted">No row selected</p>;
  }
  if (!item) {
    const e = emptyQueue(section);
    return (
      <div className="m-auto text-center">
        <p className="text-[15px] font-semibold text-fg">{e.title}</p>
        <p className="mt-1 text-[13px] text-fg-muted">{e.text}</p>
      </div>
    );
  }
  const who = identity(item);
  const note = item.detail.note;
  const href = canAct ? recordHref(item) : (item.section === "queue" && item.entity?.kind === "employee" ? workRowHref(item, false) : recordHref(item));
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3.5">
      <div className="flex items-center gap-3">
        <span aria-hidden className="inline-flex size-11 shrink-0 items-center justify-center rounded-(--radius-card) bg-surface-subtle font-mono text-[12px] text-fg-secondary">
          {badge(item)}
        </span>
        <div className="min-w-0">
          <h2 id={headingId} className="truncate text-[16px] font-semibold leading-tight text-fg" title={who.title}>{who.title}</h2>
          <p className="truncate text-[12px] text-fg-muted">{who.sub}</p>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto">
        {note && (
          <div className="rounded-(--radius-card) bg-surface-subtle px-3 py-2.5 text-[12.5px] text-fg-secondary">
            <p><span className="font-semibold text-fg">{note.label}:</span> “{note.text}”</p>
            {note.by && <p className="mt-0.5 text-[11.5px] text-fg-muted">recorded by {note.by}</p>}
          </div>
        )}
        <dl className="grid grid-cols-[104px_minmax(0,1fr)] gap-x-2.5 gap-y-1.5 text-[12.5px]">
          {item.detail.facts.map((f) => (
            <div key={f.label} className="contents">
              <dt className="text-fg-muted">{f.label}</dt>
              <dd className={cn("min-w-0 break-words text-fg", f.mono && "font-mono text-[12px]", f.tone && TONE[f.tone])}>{f.value}</dd>
            </div>
          ))}
        </dl>
        {item.detail.history.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <h3 className="text-[11.5px] font-medium text-fg-muted">History</h3>
            <ol className="flex flex-col gap-1 text-[12.5px]">
              {item.detail.history.map((h, i) => (
                <li key={i} className="grid grid-cols-[88px_minmax(0,1fr)] gap-2">
                  <span className="text-fg-muted">{fmtDate(h.at)}</span>
                  <span className="text-fg-secondary">{h.text}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>

      <div data-panel-actions="" className="flex shrink-0 flex-col gap-2">
        {canAct && <PanelActions item={item} decisions={decisions} />}
        <div data-action-row="" className="flex flex-wrap items-center justify-between gap-x-2">
          <Link href={href} className="inline-flex h-11 items-center whitespace-nowrap text-[13px] font-medium text-accent hover:underline">Open the full record →</Link>
          {canAct && (
            <Button
              variant="ghost" className="h-11 whitespace-nowrap text-[12.5px] aria-disabled:cursor-default aria-disabled:opacity-55"
              {...busyProps(decisions.busy)} onClick={unlessBusy(decisions.busy, () => decisions.hide(item))}
            >
              Hide until tomorrow
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** The queue's own action (plan call 4): triage's four, Mark checked, Set due date, else the row's link as the primary. */
function PanelActions({ item, decisions }: { item: WorkItem; decisions: Pick<WorklistDecisions, "busy" | "triage" | "check"> }) {
  const [dueOpen, setDueOpen] = useState(false);
  const c = item.control;
  if (c?.kind === "triage") {
    return <TriageActions key={item.key} tag={c.asset.tag} busy={decisions.busy} decide={(o, note) => decisions.triage(item, o, note)} />;
  }
  if (c?.kind === "it-check") {
    return (
      <Button variant="primary" className={PANEL_BUTTON} {...busyProps(decisions.busy)} onClick={unlessBusy(decisions.busy, () => decisions.check(item))}>
        Mark checked
      </Button>
    );
  }
  if (c?.kind === "loan-due") {
    return (
      <>
        <Button variant="primary" className={PANEL_BUTTON} onClick={() => setDueOpen(true)}>Set due date</Button>
        <LoanDueDialog key={item.key} open={dueOpen} onClose={() => setDueOpen(false)} asset={c.asset} loanDueAt={isoDay(c.loanDueAt)} />
      </>
    );
  }
  return (
    <ButtonLink href={item.href} variant="primary" className={cn(PANEL_BUTTON, "inline-flex")}>
      <span>{item.action}</span>
    </ButtonLink>
  );
}
