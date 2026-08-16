"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Pill } from "@/components/ui/pill";
import { StatusDot } from "@/components/ui/status";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
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
 */
export function QueueTable({ rows, canAct }: { rows: ApprovalRow[]; canAct: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [focused, setFocused] = useState(0);
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
      setAnnounce(`${r.refNo} — ${r.line1}, ${r.state}${r.owner ? `, owned by ${r.owner}` : ""}. Row ${i + 1} of ${rows.length}.`);
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
            </Tr>
          </THead>
          <TBody>
            {rows.map((row, i) => (
              <Tr
                key={row.id}
                selected={i === focused}
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
                    ? <span className="font-mono text-[10.5px] text-fg-muted">NORMAL</span>
                    : <Pill tone={row.priority === "URGENT" ? "accent" : "neutral"}>{row.priority}</Pill>}
                </Td>
                <Td mono className={cn("text-[11px]", row.sla.overdue && "font-semibold text-[color:var(--st-fault-text)]")}>
                  {row.sla.text}
                </Td>
                <Td className="text-xs">{row.owner ?? <span className="text-fg-muted">—</span>}</Td>
                <Td mono className="text-[10.5px]">{row.state}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </div>

      <Dialog
        open={rejecting !== null}
        onClose={() => setRejecting(null)}
        title={rejecting ? `Reject ${rejecting.refNo}?` : ""}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRejecting(null)}>Cancel</Button>
            <Button variant="danger" loading={pending} onClick={submitReject}>Reject</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-xs text-fg-muted">A rejection is a human decision — the reason is recorded on the approval and in the audit trail.</p>
          <FormField label="Reason" required error={fieldErrors.reason}>
            {(p) => (
              <Textarea id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                value={reason} onChange={(e) => setReason(e.target.value)} />
            )}
          </FormField>
        </div>
      </Dialog>
    </div>
  );
}
