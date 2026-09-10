"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { StatusDot } from "@/components/ui/status";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { TagRef } from "@/components/inventory/tag-ref";
import { AddSlotDialog, RemoveExceptionButton, WaiveSlotDialog } from "@/components/employees/slot-exception-controls";
import { requestAssign, requestAssignReserved, requestReturn } from "@/server/modules/employees/actions";
import { assignAsset, assignReserved, replaceAsset, returnAsset } from "@/server/modules/lifecycle/actions";
import { removeSlotException } from "@/server/modules/employees/exception-actions";
import {
  DEFAULT_LOAN_DAYS, RETURN_OUTCOMES, RETURN_OUTCOME_LABEL, defaultLoanDue, minLoanDue, reasonRequiredFor,
  type ReturnOutcome,
} from "@/lib/lifecycle";
import type { ActionResult } from "@/server/action-result";

export interface SlotTile {
  slotId: string;
  name: string;
  typeId: string | null;
  typeName: string;
  required: boolean;
  asset: { id: string; tag: string; model: string; status: string; age: string; pendingRef: string | null; visible: boolean } | null;
  /** Phase 16: filled only by a device on loan (TEMPORARY). */
  loaner: boolean;
  /** Phase 16: set when this slot came from an ADD exception — its row id, so the tile can remove it. */
  exceptionId: string | null;
  /** Phase 16: the reason recorded for the exception this tile came from, if any — surfaced as the EXCEPTION pill's tooltip. */
  exceptionReason: string | null;
  /** Phase 20 (spec §6.3, gap 3): empty, but a remaining TEMPORARY device of this slot's type covers it — reads "on loan", not "policy gap". */
  coveredByLoan: boolean;
}

export interface SpareOption {
  id: string;
  tag: string;
  model: string;
  typeId: string | null;
  reservedFor: string | null; // employee name, or null
  reservedForThis: boolean;
}

export interface HoldingItem {
  id: string;
  tag: string;
  model: string;
  note: string; // "reserved · expires 23 Aug 2026" | "assignment queued · APR-2042"
  kind: "reserved" | "queued";
  visible: boolean;
}

const STRIPES = "repeating-linear-gradient(135deg, var(--border-faint) 0 6px, var(--surface-subtle) 6px 12px)";

export function LoadoutView({
  employeeId,
  slots,
  unslotted,
  onLoan,
  waived,
  itTypes,
  spares,
  holding,
  frozen,
  canMutate,
  direct,
}: {
  employeeId: string;
  slots: SlotTile[];
  unslotted: SlotTile["asset"][];
  /** Phase 16: TEMPORARY devices no loaner slot claimed — never "extras". */
  onLoan: SlotTile["asset"][];
  /** Phase 16: this person's own WAIVE exceptions. */
  waived: Array<{ id: string; slotName: string; reason: string }>;
  /** Phase 16: IT asset types offered by the "Add a slot" dialog. */
  itTypes: Array<{ id: string; name: string }>;
  spares: SpareOption[];
  holding: HoldingItem[];
  frozen: boolean;
  canMutate: boolean;
  direct: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [view, setView] = useState("slots");
  const [fillSlot, setFillSlot] = useState<SlotTile | null>(null);
  const [pickedSpare, setPickedSpare] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [loanDueAt, setLoanDueAt] = useState(defaultLoanDue(new Date()));
  const [returning, setReturning] = useState<SlotTile["asset"] | null>(null);
  const [returnReason, setReturnReason] = useState("");
  const [replacing, setReplacing] = useState<SlotTile["asset"] | null>(null);
  const [replacementId, setReplacementId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ReturnOutcome>("TRIAGE");
  const [waivingSlot, setWaivingSlot] = useState<SlotTile | null>(null);
  const [addingSlot, setAddingSlot] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  const tileRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const mayAct = canMutate && !frozen;
  const dayOne = slots.length > 0 && slots.every((s) => !s.asset);
  const reservedCount = holding.filter((h) => h.kind === "reserved").length;

  function handle<T>(res: ActionResult<T>, onOk: (data: T) => void) {
    if (res.ok) onOk(res.data);
    else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
    else if (res.kind === "validation") setFieldErrors(res.fieldErrors ?? {});
    else setError(res.message);
  }

  function submitFill() {
    if (!pickedSpare) {
      setFieldErrors({ spare: "Pick a spare first" });
      return;
    }
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      if (direct) {
        const isLoan = fillSlot?.loaner ?? false;
        handle(
          await assignAsset({
            assetId: pickedSpare, employeeId, status: isLoan ? "TEMPORARY" : undefined,
            loanDueAt: isLoan ? loanDueAt : undefined, reason,
          }),
          ({ tag, employeeName }) => {
            toast(isLoan ? `${tag} on loan to ${employeeName} until ${loanDueAt}` : `${tag} assigned to ${employeeName}`, "settled");
            setFillSlot(null);
            setPickedSpare(null);
            setReason("");
            setLoanDueAt(defaultLoanDue(new Date()));
            router.refresh();
          },
        );
      } else {
        handle(await requestAssign({ employeeId, assetId: pickedSpare, reason }), ({ refNo }) => {
          toast(`${refNo} created — tile shows pending until it executes`, "settled");
          setFillSlot(null);
          setPickedSpare(null);
          setReason("");
          router.refresh();
        });
      }
    });
  }

  function submitReturn() {
    if (!returning) return;
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      if (direct) {
        handle(await returnAsset({ assetId: returning.id, outcome, reason: returnReason }), ({ tag, status }) => {
          toast(`${tag} returned · now ${status}`, "settled");
          setReturning(null);
          setReturnReason("");
          setOutcome("TRIAGE");
          router.refresh();
        });
      } else {
        handle(await requestReturn({ employeeId, assetId: returning.id, reason: returnReason }), ({ refNo }) => {
          toast(`${refNo} created — return is queued`, "settled");
          setReturning(null);
          setReturnReason("");
          router.refresh();
        });
      }
    });
  }

  function submitReplace() {
    if (!replacing || !replacementId) {
      setFieldErrors({ replacement: "Pick the replacement" });
      return;
    }
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      handle(
        await replaceAsset({ employeeId, oldAssetId: replacing.id, newAssetId: replacementId, outcome, reason: returnReason }),
        ({ oldTag, newTag }) => {
          toast(`${oldTag} replaced by ${newTag}`, "settled");
          setReplacing(null);
          setReplacementId(null);
          setReturnReason("");
          setOutcome("TRIAGE");
          router.refresh();
        },
      );
    });
  }

  function removeException(id: string) {
    setError(null);
    startTransition(async () => {
      handle(await removeSlotException({ id }), () => {
        toast("Exception removed", "settled");
        router.refresh();
      });
    });
  }

  function submitReservedBatch() {
    setError(null);
    startTransition(async () => {
      if (direct) {
        handle(await assignReserved({ employeeId }), ({ assigned }) => {
          toast(`${assigned} reserved spare${assigned === 1 ? "" : "s"} assigned`, "settled");
          router.refresh();
        });
      } else {
        handle(await requestAssignReserved({ employeeId }), ({ created }) => {
          toast(`${created} assign request${created === 1 ? "" : "s"} created from reservations`, "settled");
          router.refresh();
        });
      }
    });
  }

  function onGridKeyDown(e: React.KeyboardEvent) {
    const idx = tileRefs.current.findIndex((el) => el === document.activeElement);
    if (idx < 0) return;
    const move = (to: number) => {
      const el = tileRefs.current[Math.min(Math.max(to, 0), slots.length - 1)];
      el?.focus();
    };
    if (e.key === "ArrowRight") { e.preventDefault(); move(idx + 1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); move(idx - 1); }
    else if (e.key === "ArrowDown") { e.preventDefault(); move(idx + 4); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(idx - 4); }
    else if (e.key === "Backspace" && mayAct) {
      const tile = slots[idx];
      if (tile.asset && !tile.asset.pendingRef) { e.preventDefault(); setReturning(tile.asset); }
    }
  }

  const sparesForSlot = fillSlot ? spares.filter((s) => s.typeId && s.typeId === fillSlot.typeId) : [];

  // The tile a Replace dialog opened for isn't self-describing its slot's
  // type — look it up from `slots` so the radiogroup can rank same-type
  // spares first. Not `slotTypeOf(replacing)`: no such helper exists.
  const replacingTypeId = replacing ? slots.find((s) => s.asset?.id === replacing.id)?.typeId ?? null : null;
  const sameTypeSpares = replacing ? spares.filter((s) => s.typeId === replacingTypeId) : [];
  const otherSpares = replacing ? spares.filter((s) => s.typeId !== replacingTypeId) : [];

  return (
    <div className="flex flex-col gap-4">
      {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
      {error && <Banner tone="fault" title={error} />}
      {frozen && (
        <Banner tone="attention" title="Offboarding in progress — slots are frozen">
          No new assignments for a leaver.{" "}
          <Link href={`/offboarding/${employeeId}`} className="text-accent underline hover:text-accent-hover">
            Open the offboarding wizard
          </Link>{" "}
          to collect equipment back.
        </Banner>
      )}

      <div className="flex items-center justify-between">
        <SegmentedControl
          aria-label="Loadout view"
          options={[{ value: "slots", label: "Slots" }, { value: "table", label: "Table" }]}
          value={view}
          onChange={setView}
        />
        <div className="flex items-center gap-2">
          {mayAct && dayOne && reservedCount > 0 && (
            <Button variant="primary" size="sm" loading={pending} onClick={submitReservedBatch}>
              {direct ? `Assign all ${reservedCount} reserved` : `Request assign for all ${reservedCount} reserved`}
            </Button>
          )}
          {mayAct && (
            <Button variant="secondary" size="sm" onClick={() => setAddingSlot(true)}>
              Add a slot for this person…
            </Button>
          )}
        </div>
      </div>

      {slots.length === 0 && (
        <Banner tone="neutral" title="No equipment policy applies">
          Held items are listed below; define a policy under Equipment policies to get the slot grid.
        </Banner>
      )}

      {view === "slots" ? (
        <div role="group" aria-label="Equipment slots" className="grid grid-cols-2 gap-[11px] lg:grid-cols-4" onKeyDown={onGridKeyDown}>
          {slots.map((tile, i) => {
            const a = tile.asset;
            const name = `${tile.name} slot, ${a ? a.model : "empty"}, ${tile.required ? "required" : "optional"}`;
            const showReplace = !!a && direct && mayAct && !a.pendingRef;
            // Waiving is a policy-slot affordance (an ADD-exception slot is
            // already only for this person — "Remove exception" is its
            // undo); an exception tile never offers both at once.
            const showWaive = mayAct && !tile.exceptionId;
            const showRemoveException = mayAct && !!tile.exceptionId;
            const menuItems: MenuItem[] = [];
            if (showReplace && a) menuItems.push({ label: "⇄ Replace", onSelect: () => setReplacing(a) });
            if (showWaive) menuItems.push({ label: "Waive for this person…", onSelect: () => setWaivingSlot(tile) });
            if (showRemoveException && tile.exceptionId) {
              const exceptionId = tile.exceptionId;
              menuItems.push({ label: "Remove exception", onSelect: () => removeException(exceptionId) });
            }
            return (
              // A real Menu trigger cannot nest inside the tile's own
              // <button> (axe: nested-interactive / no-focusable-content) —
              // it renders as an absolutely positioned SIBLING instead, both
              // inside this "group relative" wrapper so hover/focus reveal
              // still works via group-hover / focus-within.
              <div key={tile.slotId} className="group relative">
                <button
                  ref={(el) => { tileRefs.current[i] = el; }}
                  type="button"
                  aria-label={name}
                  onClick={() => {
                    if (!mayAct) return;
                    if (!a) { setFillSlot(tile); setPickedSpare(null); setFieldErrors({}); setLoanDueAt(defaultLoanDue(new Date())); }
                    else if (!a.pendingRef) setReturning(a);
                  }}
                  className={cn(
                    "flex w-full flex-col gap-1.5 rounded-(--radius-card) border p-3 text-left transition-colors duration-(--dur-1)",
                    a ? "border-border bg-surface shadow-card" : "border-dashed border-border-strong",
                    !a && tile.required && "bg-[var(--st-attention-bg)]/40",
                    mayAct && "hover:border-accent",
                  )}
                >
                  {a ? (
                    <>
                      <span aria-hidden className="relative h-[56px] w-full rounded-[6px]" style={{ background: STRIPES }}>
                        <span className="absolute left-1.5 top-1.5"><StatusDot value={a.status} /></span>
                        {a.pendingRef && (
                          <span className="absolute right-1.5 top-1.5"><Pill tone="accent">PENDING</Pill></span>
                        )}
                      </span>
                      <span className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-fg-muted">{tile.name}</span>
                      <span className={cn("text-[11.5px] font-medium", a.pendingRef ? "text-fg-muted" : "text-fg")}>{a.model}</span>
                      <span className="font-mono text-[11px] text-accent">{a.tag}</span>
                      {(tile.loaner || tile.exceptionId) && (
                        <span className="flex flex-wrap items-center gap-1">
                          {tile.loaner && <Pill>LOAN</Pill>}
                          {tile.exceptionId && <Pill title={tile.exceptionReason ?? undefined}>EXCEPTION</Pill>}
                        </span>
                      )}
                      <span className="flex items-center justify-between font-mono text-[10px] text-fg-muted">
                        {a.pendingRef ?? a.age}
                        {mayAct && !a.pendingRef && (
                          <span aria-hidden className="opacity-0 transition-opacity duration-[120ms] group-hover:opacity-100">− return</span>
                        )}
                      </span>
                    </>
                  ) : (
                    <>
                      <span aria-hidden className="grid h-[56px] w-full place-items-center rounded-[6px]">
                        <span className="grid size-[30px] place-items-center rounded-full border border-border-strong text-fg-muted">+</span>
                      </span>
                      <span className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-fg-secondary">{tile.name}</span>
                      <span className="font-mono text-[10px] text-fg-muted">
                        {tile.typeName} · {tile.required ? "required" : "optional"}
                      </span>
                      {(tile.loaner || tile.exceptionId || tile.coveredByLoan) && (
                        <span className="flex flex-wrap items-center gap-1">
                          {(tile.loaner || tile.coveredByLoan) && <Pill>LOAN</Pill>}
                          {tile.exceptionId && <Pill title={tile.exceptionReason ?? undefined}>EXCEPTION</Pill>}
                        </span>
                      )}
                      {/* Phase 20 (spec §6.3, gap 3): someone standing in on
                          their own broken kit's loaner is not a policy gap —
                          "on loan" replaces the attention-toned text. */}
                      {tile.coveredByLoan ? (
                        <span className="font-mono text-[10px] text-fg-muted">on loan</span>
                      ) : tile.required && (
                        <span className="font-mono text-[10px] font-medium" style={{ color: "var(--st-attention-text)" }}>
                          policy gap
                        </span>
                      )}
                    </>
                  )}
                </button>
                {menuItems.length > 0 && (
                  <div className="absolute right-1.5 top-1.5 opacity-0 transition-opacity duration-(--dur-1) group-hover:opacity-100 focus-within:opacity-100">
                    <Menu
                      align="end"
                      trigger={(props) => (
                        <button
                          type="button"
                          {...props}
                          aria-label={`Actions for the ${tile.name} slot`}
                          className="h-auto rounded-[4px] border border-transparent bg-surface/90 px-1.5 py-0.5 font-mono text-[10px] text-fg-muted shadow-card hover:bg-surface hover:text-fg"
                        >
                          ⋯
                        </button>
                      )}
                      items={menuItems}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th width={19} aria-label="Status colour" />
              <Th width={104}>Tag</Th>
              <Th>Model</Th>
              <Th width={110}>Slot</Th>
              <Th width={90}>Status</Th>
              <Th width={110}>Age</Th>
            </Tr>
          </THead>
          <TBody>
            {[...slots.filter((s) => s.asset).map((s) => ({ a: s.asset!, slot: s.name })),
              ...onLoan.filter(Boolean).map((a) => ({ a: a!, slot: "on loan" })),
              ...unslotted.filter(Boolean).map((a) => ({ a: a!, slot: "—" }))].map(({ a, slot }) => (
              <Tr key={a.id}>
                <Td className="pr-0"><StatusDot value={a.status} /></Td>
                <Td mono><TagRef id={a.id} tag={a.tag} visible={a.visible} className="text-accent hover:underline" /></Td>
                <Td>{a.model}</Td>
                <Td mono className="text-[10.5px]">{slot}</Td>
                <Td mono className="text-[10.5px]">{a.status}</Td>
                <Td mono>{a.age}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}

      {onLoan.length > 0 && view === "slots" && (
        <Card>
          <CardHeader title="On loan" />
          <CardBody className="flex flex-col gap-1.5">
            {onLoan.filter(Boolean).map((a) => (
              <div key={a!.id} className="flex items-center gap-2 text-xs text-fg-secondary">
                <StatusDot value={a!.status} />
                <TagRef id={a!.id} tag={a!.tag} visible={a!.visible} className="font-mono text-accent hover:underline" />
                {a!.model}
                <span className="ml-auto font-mono text-[10px] text-fg-muted">on loan</span>
              </div>
            ))}
          </CardBody>
        </Card>
      )}

      {unslotted.length > 0 && view === "slots" && (
        <Card>
          <CardHeader title="Also holding" />
          <CardBody className="flex flex-col gap-1.5">
            {unslotted.filter(Boolean).map((a) => (
              <div key={a!.id} className="flex items-center gap-2 text-xs text-fg-secondary">
                <StatusDot value={a!.status} />
                <TagRef id={a!.id} tag={a!.tag} visible={a!.visible} className="font-mono text-accent hover:underline" />
                {a!.model}
                {a!.pendingRef && <Pill tone="accent">{a!.pendingRef}</Pill>}
              </div>
            ))}
          </CardBody>
        </Card>
      )}

      {holding.length > 0 && (
        <Card>
          <CardHeader title="Holding area" />
          <CardBody className="flex flex-col gap-1.5">
            {holding.map((h) => (
              <div key={h.id} className="flex items-center gap-2 text-xs text-fg-secondary">
                <StatusDot value={h.kind === "reserved" ? "ACTIVE" : "PENDING"} />
                <TagRef
                  id={h.id}
                  tag={h.tag}
                  visible={h.visible}
                  className={cn("font-mono hover:underline", h.kind === "queued" ? "text-fg-muted" : "text-accent")}
                />
                <span className={cn(h.kind === "queued" && "text-fg-muted")}>{h.model}</span>
                <span className="ml-auto font-mono text-[10px] text-fg-muted">{h.note}</span>
              </div>
            ))}
          </CardBody>
        </Card>
      )}

      {waived.length > 0 && (
        <details className="rounded-(--radius-card) border border-border-faint">
          <summary className="cursor-pointer select-none px-4 py-2.5 text-xs font-medium text-fg-secondary">
            Waived for this person ({waived.length})
          </summary>
          <div className="flex flex-col gap-1.5 border-t border-border-faint px-4 py-3">
            {waived.map((w) => (
              <div key={w.id} className="flex items-center gap-2 text-xs text-fg-secondary">
                <span className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-fg-muted">{w.slotName}</span>
                <span className="text-fg-muted">{w.reason}</span>
                {mayAct && (
                  <span className="ml-auto">
                    <RemoveExceptionButton id={w.id} label="Restore" />
                  </span>
                )}
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Fill-slot dialog (the right-panel behaviour, rendered as an overlay for keyboard/mobile sanity) */}
      <Dialog
        open={fillSlot !== null}
        onClose={() => setFillSlot(null)}
        title={fillSlot ? (fillSlot.loaner && direct ? `Lend for the ${fillSlot.name} slot` : `Fill the ${fillSlot.name} slot`) : ""}
        footer={
          <>
            <Button variant="ghost" onClick={() => setFillSlot(null)}>Cancel</Button>
            <Button variant="primary" loading={pending} onClick={submitFill}>{direct ? "Confirm" : "Request assign"}</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {sparesForSlot.length === 0 ? (
            <p className="text-xs text-fg-muted">
              No spare {fillSlot?.typeName} in stock — register one or route a purchase.
            </p>
          ) : (
            <div role="radiogroup" aria-label="Pick a spare" className="flex flex-col gap-1">
              {fieldErrors.spare && <p role="alert" className="text-[11px] font-medium" style={{ color: "var(--error-text)" }}>{fieldErrors.spare}</p>}
              {sparesForSlot.map((s) => (
                <label
                  key={s.id}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-(--radius-ctl) border px-2 py-1.5 text-xs",
                    pickedSpare === s.id ? "border-accent bg-accent-tint" : "border-border hover:bg-surface-subtle",
                  )}
                >
                  <input
                    type="radio"
                    name="spare"
                    className="sr-only"
                    checked={pickedSpare === s.id}
                    onChange={() => setPickedSpare(s.id)}
                  />
                  <span className="font-mono text-accent">{s.tag}</span>
                  <span className="text-fg-secondary">{s.model}</span>
                  <span className="ml-auto font-mono text-[10px] text-fg-muted">
                    {s.reservedForThis ? "reserved for them" : s.reservedFor ? `reserved for ${s.reservedFor}` : "spare"}
                  </span>
                </label>
              ))}
            </div>
          )}
          {fillSlot?.loaner && direct && (
            <FormField label="Loan until" required error={fieldErrors.loanDueAt} hint={`Defaults to ${DEFAULT_LOAN_DAYS} days.`}>
              {(p) => (
                <Input id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid} type="date"
                  min={minLoanDue(new Date())} value={loanDueAt} onChange={(e) => setLoanDueAt(e.target.value)} />
              )}
            </FormField>
          )}
          <FormField
            label="Reason"
            hint={direct ? "Optional — recorded in the audit trail." : "Optional — lands in the approval payload."}
            error={fieldErrors.reason}
          >
            {(p) => (
              <Textarea id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                value={reason} onChange={(e) => setReason(e.target.value)} />
            )}
          </FormField>
        </div>
      </Dialog>

      {/* Return dialog */}
      <Dialog
        open={returning !== null}
        onClose={() => setReturning(null)}
        title={returning ? `Return ${returning.tag}?` : ""}
        footer={
          <>
            <Button variant="ghost" onClick={() => setReturning(null)}>Cancel</Button>
            <Button variant="danger" loading={pending} onClick={submitReturn}>{direct ? "Confirm" : "Request return"}</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-xs text-fg-muted">
            {direct ? (
              "Comes off this loadout now; pick what happens to it."
            ) : (
              <>Creates a <span className="font-mono">lifecycle.return</span> approval — the item stays on
              this loadout until the return executes.</>
            )}
          </p>
          {direct && (
            <FormField label="What happens to it" required error={fieldErrors.outcome}>
              {(p) => (
                <Select id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                  value={outcome} onChange={(e) => setOutcome(e.target.value as ReturnOutcome)}>
                  {RETURN_OUTCOMES.map((o) => <option key={o} value={o}>{RETURN_OUTCOME_LABEL[o]}</option>)}
                </Select>
              )}
            </FormField>
          )}
          <FormField label="Reason" required={!direct || reasonRequiredFor(outcome)} error={fieldErrors.reason}>
            {(p) => (
              <Textarea id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                value={returnReason} onChange={(e) => setReturnReason(e.target.value)} />
            )}
          </FormField>
        </div>
      </Dialog>

      {/* Replace dialog (direct mode only — the tile's ⇄ replace affordance) */}
      <Dialog
        open={replacing !== null}
        onClose={() => setReplacing(null)}
        title={replacing ? `Replace ${replacing.tag}` : ""}
        footer={
          <>
            <Button variant="ghost" onClick={() => setReplacing(null)}>Cancel</Button>
            <Button variant="primary" loading={pending} onClick={submitReplace}>Confirm</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <div role="radiogroup" aria-label="Pick the replacement" className="flex flex-col gap-1">
            {fieldErrors.replacement && <p role="alert" className="text-[11px] font-medium" style={{ color: "var(--error-text)" }}>{fieldErrors.replacement}</p>}
            {sameTypeSpares.length === 0 && otherSpares.length === 0 && (
              <p className="text-xs text-fg-muted">No spares in stock — register one or route a purchase.</p>
            )}
            {sameTypeSpares.map((s) => (
              <label
                key={s.id}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-(--radius-ctl) border px-2 py-1.5 text-xs",
                  replacementId === s.id ? "border-accent bg-accent-tint" : "border-border hover:bg-surface-subtle",
                )}
              >
                <input
                  type="radio"
                  name="replacement"
                  className="sr-only"
                  checked={replacementId === s.id}
                  onChange={() => setReplacementId(s.id)}
                />
                <span className="font-mono text-accent">{s.tag}</span>
                <span className="text-fg-secondary">{s.model}</span>
                <span className="ml-auto font-mono text-[10px] text-fg-muted">
                  {s.reservedForThis ? "reserved for them" : s.reservedFor ? `reserved for ${s.reservedFor}` : "spare"}
                </span>
              </label>
            ))}
            {sameTypeSpares.length > 0 && otherSpares.length > 0 && (
              <p className="pt-1 font-mono text-[10px] uppercase tracking-[0.06em] text-fg-muted">other spares</p>
            )}
            {otherSpares.map((s) => (
              <label
                key={s.id}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-(--radius-ctl) border px-2 py-1.5 text-xs",
                  replacementId === s.id ? "border-accent bg-accent-tint" : "border-border hover:bg-surface-subtle",
                )}
              >
                <input
                  type="radio"
                  name="replacement"
                  className="sr-only"
                  checked={replacementId === s.id}
                  onChange={() => setReplacementId(s.id)}
                />
                <span className="font-mono text-accent">{s.tag}</span>
                <span className="text-fg-secondary">{s.model}</span>
                <span className="ml-auto font-mono text-[10px] text-fg-muted">
                  {s.reservedForThis ? "reserved for them" : s.reservedFor ? `reserved for ${s.reservedFor}` : "spare"}
                </span>
              </label>
            ))}
          </div>
          <FormField label="What happens to it" required error={fieldErrors.outcome}>
            {(p) => (
              <Select id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                value={outcome} onChange={(e) => setOutcome(e.target.value as ReturnOutcome)}>
                {RETURN_OUTCOMES.map((o) => <option key={o} value={o}>{RETURN_OUTCOME_LABEL[o]}</option>)}
              </Select>
            )}
          </FormField>
          <FormField label="Reason" required={reasonRequiredFor(outcome)} error={fieldErrors.reason}>
            {(p) => (
              <Textarea id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                value={returnReason} onChange={(e) => setReturnReason(e.target.value)} />
            )}
          </FormField>
        </div>
      </Dialog>

      <WaiveSlotDialog
        employeeId={employeeId}
        slot={{ id: waivingSlot?.slotId ?? "", name: waivingSlot?.name ?? "" }}
        open={waivingSlot !== null}
        onClose={() => setWaivingSlot(null)}
      />

      <AddSlotDialog
        employeeId={employeeId}
        itTypes={itTypes}
        open={addingSlot}
        onClose={() => setAddingSlot(false)}
      />
    </div>
  );
}
