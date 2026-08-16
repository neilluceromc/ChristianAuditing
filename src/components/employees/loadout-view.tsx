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
import { SegmentedControl } from "@/components/ui/segmented-control";
import { StatusDot } from "@/components/ui/status";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { requestAssign, requestAssignReserved, requestReturn } from "@/server/modules/employees/actions";
import type { ActionResult } from "@/server/action-result";

export interface SlotTile {
  slotId: string;
  name: string;
  typeId: string | null;
  typeName: string;
  required: boolean;
  asset: { id: string; tag: string; model: string; status: string; age: string; pendingRef: string | null } | null;
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
}: {
  employeeId: string;
  slots: SlotTile[];
  unslotted: SlotTile["asset"][];
  spares: SpareOption[];
  holding: HoldingItem[];
  frozen: boolean;
  canMutate: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [view, setView] = useState("slots");
  const [fillSlot, setFillSlot] = useState<SlotTile | null>(null);
  const [pickedSpare, setPickedSpare] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [returning, setReturning] = useState<SlotTile["asset"] | null>(null);
  const [returnReason, setReturnReason] = useState("");
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
      handle(await requestAssign({ employeeId, assetId: pickedSpare, reason }), ({ refNo }) => {
        toast(`${refNo} created — tile shows pending until it executes`, "settled");
        setFillSlot(null);
        setPickedSpare(null);
        setReason("");
        router.refresh();
      });
    });
  }

  function submitReturn() {
    if (!returning) return;
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      handle(await requestReturn({ employeeId, assetId: returning.id, reason: returnReason }), ({ refNo }) => {
        toast(`${refNo} created — return is queued`, "settled");
        setReturning(null);
        setReturnReason("");
        router.refresh();
      });
    });
  }

  function submitReservedBatch() {
    setError(null);
    startTransition(async () => {
      handle(await requestAssignReserved({ employeeId }), ({ created }) => {
        toast(`${created} assign request${created === 1 ? "" : "s"} created from reservations`, "settled");
        router.refresh();
      });
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

  return (
    <div className="flex flex-col gap-4">
      {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
      {error && <Banner tone="fault" title={error} />}
      {frozen && (
        <Banner tone="attention" title="Offboarding in progress — slots are frozen">
          No new assignments for a leaver.{" "}
          <Link href={`/offboarding/${employeeId}`} className="text-accent hover:underline">
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
            Request assign for all {reservedCount} reserved
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
            return (
              <button
                key={tile.slotId}
                ref={(el) => { tileRefs.current[i] = el; }}
                type="button"
                aria-label={name}
                onClick={() => {
                  if (!mayAct) return;
                  if (!a) { setFillSlot(tile); setPickedSpare(null); setFieldErrors({}); }
                  else if (!a.pendingRef) setReturning(a);
                }}
                className={cn(
                  "group flex flex-col gap-1.5 rounded-(--radius-card) border p-3 text-left transition-colors duration-(--dur-1)",
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
                <Td mono><Link href={`/inventory/${a.id}`} className="text-accent hover:underline">{a.tag}</Link></Td>
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
                <Link href={`/inventory/${a!.id}`} className="font-mono text-accent hover:underline">{a!.tag}</Link>
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
                <Link href={`/inventory/${h.id}`} className={cn("font-mono hover:underline", h.kind === "queued" ? "text-fg-muted" : "text-accent")}>
                  {h.tag}
                </Link>
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
            <Button variant="primary" loading={pending} onClick={submitFill}>Request assign</Button>
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
          <FormField label="Reason" hint="Optional — lands in the approval payload." error={fieldErrors.reason}>
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
            <Button variant="danger" loading={pending} onClick={submitReturn}>Request return</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-xs text-fg-muted">
            Creates a <span className="font-mono">lifecycle.return</span> approval — the item stays on
            this loadout until the return executes.
          </p>
          <FormField label="Reason" required error={fieldErrors.reason}>
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
