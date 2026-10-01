"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { ApprovalState, Priority } from "@prisma/client";
import { cn } from "@/lib/cn";
import { Banner } from "@/components/ui/banner";
import { IconButton } from "@/components/ui/button";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { Pill } from "@/components/ui/pill";
import { StatusDot } from "@/components/ui/status";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { DONE, RUN, RejectApprovalDialog } from "@/components/approvals/approval-header";
import { approvalHeader, VERB_LABEL, type ApprovalVerb } from "@/lib/approval-header";
import { PRIORITY_LABEL } from "@/lib/labels";
import {
  approveApproval, claimApproval, escalateApproval, rejectApproval,
} from "@/server/modules/approvals/actions";
import type { ApprovalRow } from "@/server/modules/approvals/queries";
import type { ActionResult } from "@/server/action-result";

/**
 * Keyboard contract (brief §9: "an approver can clear a queue of 20 items
 * using the keyboard"): J/K (or arrows) move, Enter opens, C claim,
 * A approve (mine only), R reject (reason dialog), E escalate. The listener
 * lives on the focusable table wrapper; keys are inert for read-only roles.
 *
 * Spec §4.2: every row the user can act on also carries a menu (`Actions for
 * {refNo}`) built from approvalHeader — the request page's verbs, so a PENDING
 * row's Approve is the one-step approveNow — plus Open. The keys stay as they are.
 */
export function QueueTable({ rows, canAct, isAdmin }: { rows: ApprovalRow[]; canAct: boolean; isAdmin: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [focused, setFocused] = useState(0);
  // The selected-row styling shows only while the keyboard wrapper holds focus (spec §4.2).
  const [hasFocus, setHasFocus] = useState(false);
  const [rejecting, setRejecting] = useState<ApprovalRow | null>(null);
  const [reason, setReason] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  const [ringing, setRinging] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<string | null>(null);
  // Screen-reader feedback for the J/K selection — the visual highlight alone
  // says nothing about which row C/A/R/E will act on.
  const [announce, setAnnounce] = useState("");

  function handle(res: ActionResult<{ refNo: string; state: string }>, verb: string, rowId: string) {
    if (res.ok) {
      toast(`${res.data.refNo} ${verb}`, "settled");
      if (verb === "claimed") {
        setRinging(rowId);
        setTimeout(() => { setRinging(null); router.refresh(); }, 700);
      } else if (verb === "approved" || verb === "rejected") {
        // the row leaves first; the badge decrements on the refresh AFTER it's gone
        setLeaving(rowId);
        setTimeout(() => { setLeaving(null); router.refresh(); }, 340);
      } else {
        router.refresh();
      }
    } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
    else setError(res.message);
  }

  function act(action: "claim" | "approve" | "escalate", row: ApprovalRow) {
    if (leaving) return; // a row is animating out — don't double-fire into stale state
    if (action === "approve" && !row.mine) {
      setError("Claim it first — approval requires ownership.");
      return;
    }
    setError(null);
    startTransition(async () => {
      if (action === "claim") handle(await claimApproval({ id: row.id }), "claimed", row.id);
      else if (action === "approve") handle(await approveApproval({ id: row.id }), "approved", row.id);
      else handle(await escalateApproval({ id: row.id }), "escalated", row.id);
    });
  }

  /** A row-menu verb: the request page's server action for it, this queue's result handling. */
  function actVerb(verb: ApprovalVerb, row: ApprovalRow) {
    if (leaving) return;
    setError(null);
    startTransition(async () => {
      handle(await RUN[verb]({ id: row.id }), DONE[verb], row.id);
    });
  }

  /** approvalHeader's plan as menu items: the primary, Reject…, the rest, then Open. */
  function menuItems(row: ApprovalRow): MenuItem[] {
    const plan = approvalHeader({ state: row.state as ApprovalState, canAct, mine: row.mine, isAdmin });
    const items: MenuItem[] = [];
    if (plan.primary) {
      const verb = plan.primary;
      items.push({ label: VERB_LABEL[verb], onSelect: () => actVerb(verb, row), disabled: pending });
    }
    if (plan.reject) items.push({ label: "Reject…", onSelect: () => setRejecting(row), disabled: pending });
    for (const verb of plan.more) {
      items.push({ label: VERB_LABEL[verb], onSelect: () => actVerb(verb, row), disabled: pending });
    }
    // A menu whose only item is Open would just repeat the row click, so a row with nothing to act on has none.
    if (items.length > 0) items.push({ label: "Open", onSelect: () => router.push(`/approvals/${row.id}`) });
    return items;
  }

  function submitReject() {
    if (!rejecting) return;
    setFieldErrors({});
    startTransition(async () => {
      const res = await rejectApproval({ id: rejecting.id, reason });
      if (!res.ok && res.kind === "validation") {
        setFieldErrors(res.fieldErrors ?? {});
        return;
      }
      setRejecting(null);
      setReason("");
      handle(res, "rejected", rejecting.id);
    });
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (rows.length === 0) return;
    const key = e.key.toLowerCase();
    const row = rows[focused];
    const announceRow = (i: number) => {
      const r = rows[i];
      setAnnounce(`${r.refNo} — ${r.line1}, ${r.state}${r.owner ? `, owned by ${r.owner}` : ""}${r.direct ? ", applied directly" : ""}. Row ${i + 1} of ${rows.length}.`);
    };
    if (key === "j" || e.key === "ArrowDown") { e.preventDefault(); setFocused((i) => { const n = Math.min(i + 1, rows.length - 1); announceRow(n); return n; }); }
    else if (key === "k" || e.key === "ArrowUp") { e.preventDefault(); setFocused((i) => { const n = Math.max(i - 1, 0); announceRow(n); return n; }); }
    else if (e.key === "Enter" && row) { e.preventDefault(); router.push(`/approvals/${row.id}`); }
    else if (!canAct || pending || !row) return;
    else if (key === "c") { e.preventDefault(); act("claim", row); }
    else if (key === "a") { e.preventDefault(); act("approve", row); }
    else if (key === "e") { e.preventDefault(); act("escalate", row); }
    else if (key === "r") { e.preventDefault(); setRejecting(row); }
  }

  return (
    <div className="flex flex-col gap-2">
      {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
      {error && <Banner tone="fault" title={error} />}
      <p aria-live="polite" className="sr-only">{announce}</p>
      <div
        tabIndex={0}
        role="group"
        aria-label="Approval queue — J/K move, Enter opens, C claim, A approve, R reject, E escalate"
        className="rounded-(--radius-card) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        onKeyDown={onKeyDown}
        onFocus={() => setHasFocus(true)}
        onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHasFocus(false); }}
      >
        <Table>
          <THead>
            <Tr>
              <Th width={19}><span className="sr-only">Status colour</span></Th>
              <Th width={82}>ID</Th>
              <Th>Change</Th>
              <Th width={84}>Priority</Th>
              <Th width={106}>SLA</Th>
              <Th width={96}>Owner</Th>
              <Th width={104}>State</Th>
              {canAct && <Th width={44} aria-label="Row actions" />}
            </Tr>
          </THead>
          <TBody>
            {rows.map((row, i) => {
              const items = canAct ? menuItems(row) : [];
              return (
                <Tr
                  key={row.id}
                  selected={hasFocus && i === focused}
                  className={cn(
                    "cursor-pointer transition-opacity duration-[340ms]",
                    leaving === row.id && "opacity-0",
                  )}
                  onClick={() => { setFocused(i); router.push(`/approvals/${row.id}`); }}
                >
                  <Td className="pr-0">
                    <span className={cn("inline-flex rounded-full", ringing === row.id && "animate-[ring_700ms_var(--ease-std)]")}>
                      <StatusDot value={row.state} />
                    </span>
                  </Td>
                  <Td mono>
                    <Link href={`/approvals/${row.id}`} className="text-accent hover:underline" onClick={(e) => e.stopPropagation()}>
                      {row.refNo}
                    </Link>
                  </Td>
                  <Td>
                    <span className="flex flex-col py-1.5 leading-tight">
                      <span className="font-mono text-[11px] text-fg">{row.line1}</span>
                      <span className="text-xs text-fg-muted">{row.line2}</span>
                    </span>
                  </Td>
                  <Td>
                    {row.priority === "NORMAL"
                      ? <span className="text-xs text-fg-muted">{PRIORITY_LABEL.NORMAL}</span>
                      : <Pill tone="accent">{PRIORITY_LABEL[row.priority as Priority]}</Pill>}
                  </Td>
                  <Td mono className={cn("text-[11px]", row.sla.overdue && "font-semibold text-[color:var(--st-fault-text)]")}>
                    {row.sla.text}
                  </Td>
                  <Td className="text-xs">{row.owner ?? <span className="text-fg-muted">—</span>}</Td>
                  <Td mono className="text-[10.5px]">
                    <span className="inline-flex items-center gap-1.5">
                      {row.state}
                      {row.direct && <Pill>DIRECT</Pill>}
                    </span>
                  </Td>
                  {canAct && (
                    // Not part of the row: the menu's clicks and keys (Enter, arrows) stay out of the row's
                    // click and the queue's keyboard contract — its popup is portalled, but React bubbles it here.
                    <Td
                      className="cursor-default px-1 text-right"
                      onClick={(e: React.MouseEvent) => e.stopPropagation()}
                      onKeyDown={(e: React.KeyboardEvent) => e.stopPropagation()}
                    >
                      {items.length > 0 && (
                        <Menu
                          align="end"
                          items={items}
                          trigger={(p) => <IconButton {...p} aria-label={`Actions for ${row.refNo}`}>⋯</IconButton>}
                        />
                      )}
                    </Td>
                  )}
                </Tr>
              );
            })}
          </TBody>
        </Table>
      </div>

      <RejectApprovalDialog
        refNo={rejecting?.refNo ?? ""}
        open={rejecting !== null}
        onClose={() => setRejecting(null)}
        onConfirm={submitReject}
        pending={pending}
        reason={reason}
        onReasonChange={setReason}
        error={fieldErrors.reason}
      />
    </div>
  );
}
