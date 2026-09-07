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
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { StatusDot } from "@/components/ui/status";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { TagRef } from "@/components/inventory/tag-ref";
import { requestAssign, requestAssignReserved, requestReturn } from "@/server/modules/employees/actions";
import { assignAsset, assignReserved, replaceAsset, returnAsset } from "@/server/modules/lifecycle/actions";
import { RETURN_OUTCOMES, RETURN_OUTCOME_LABEL, reasonRequiredFor, type ReturnOutcome } from "@/lib/lifecycle";
import type { ActionResult } from "@/server/action-result";

export interface SlotTile {
  slotId: string;
  name: string;
  typeId: string | null;
  typeName: string;
  required: boolean;
  asset: { id: string; tag: string; model: string; status: string; age: string; pendingRef: string | null; visible: boolean } | null;
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
  spares,
  holding,
  frozen,
  canMutate,
  direct,
}: {
  employeeId: string;
  slots: SlotTile[];
  unslotted: SlotTile["asset"][];
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
  const [returning, setReturning] = useState<SlotTile["asset"] | null>(null);
  const [returnReason, setReturnReason] = useState("");
  const [replacing, setReplacing] = useState<SlotTile["asset"] | null>(null);
  const [replacementId, setReplacementId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ReturnOutcome>("TRIAGE");
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
        handle(await assignAsset({ assetId: pickedSpare, employeeId, reason }), ({ tag, employeeName }) => {
          toast(`${tag} assigned to ${employeeName}`, "settled");
          setFillSlot(null);
          setPickedSpare(null);
          setReason("");
          router.refresh();
        });
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
        {mayAct && dayOne && reservedCount > 0 && (
          <Button variant="primary" size="sm" loading={pending} onClick={submitReservedBatch}>
            {direct ? `Assign all ${reservedCount} reserved` : `Request assign for all ${reservedCount} reserved`}
          </Button>
        )}
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
            return (
              // A real Replace <button> cannot nest inside the tile's own
              // <button> (axe: nested-interactive / no-focusable-content) —
              // it renders as an absolutely positioned SIBLING instead, both
              // inside this "group relative" wrapper so hover/focus reveal
              // still works via group-hover / focus-visible.
              <div key={tile.slotId} className="group relative">
                <button
                  ref={(el) => { tileRefs.current[i] = el; }}
                  type="button"
                  aria-label={name}
                  onClick={() => {
                    if (!mayAct) return;
                    if (!a) { setFillSlot(tile); setPickedSpare(null); setFieldErrors({}); }
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
                      {tile.required && (
                        <span className="font-mono text-[10px] font-medium" style={{ color: "var(--st-attention-text)" }}>
                          policy gap
                        </span>
                      )}
                    </>
                  )}
                </button>
                {showReplace && a && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setReplacing(a)}
                    className="absolute right-1.5 top-1.5 h-auto rounded-[4px] border border-transparent bg-surface/90 px-1.5 py-0.5 font-mono text-[10px] text-fg-muted opacity-0 shadow-card transition-opacity duration-(--dur-1) hover:bg-surface hover:text-fg group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    ⇄ replace
                  </Button>
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

      {/* Fill-slot dialog (the right-panel behaviour, rendered as an overlay for keyboard/mobile sanity) */}
      <Dialog
        open={fillSlot !== null}
        onClose={() => setFillSlot(null)}
        title={fillSlot ? `Fill the ${fillSlot.name} slot` : ""}
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
    </div>
  );
}
