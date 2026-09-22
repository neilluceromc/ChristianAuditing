"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { DuePill } from "@/components/ui/due-pill";
import { FormField } from "@/components/ui/form-field";
import { HoldPill } from "@/components/ui/hold-pill";
import { Input } from "@/components/ui/input";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { StatusDot } from "@/components/ui/status";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { EntityCombobox, type ComboOption } from "@/components/patterns/entity-combobox";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { ReasonField } from "@/components/patterns/reason-field";
import { REASON_CHIPS, chipsForOutcome } from "@/lib/reason-chips";
import { ReleaseHoldButton } from "@/components/inventory/release-hold-button";
import { TagRef } from "@/components/inventory/tag-ref";
import { AddSlotDialog, RemoveExceptionButton, WaiveSlotDialog } from "@/components/employees/slot-exception-controls";
import { requestAssign, requestAssignReserved, requestReturn } from "@/server/modules/employees/actions";
import { reserveAsset } from "@/server/modules/reservations/actions";
import { assignAsset, assignReserved, replaceAsset, returnAsset } from "@/server/modules/lifecycle/actions";
import { removeSlotException } from "@/server/modules/employees/exception-actions";
import { saveLoadoutView } from "@/server/preferences";
import { orderTiles, tileMenuItems } from "@/lib/loadout";
import { statusFamily } from "@/lib/status";
import {
  DEFAULT_LOAN_DAYS, RETURN_OUTCOMES, RETURN_OUTCOME_LABEL, defaultLoanDue, minLoanDue, reasonRequiredFor,
  type ReturnOutcome,
} from "@/lib/lifecycle";
import { defaultHoldExpiry, minHoldExpiry } from "@/lib/holds";
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
  /** Phase 29 (spec §4.5): an open approval already promises this spare — unpickable, and it says which request. */
  pendingRef: string | null;
}

export interface HoldingItem {
  id: string;
  tag: string;
  model: string;
  note: string; // "reserved · expires 23 Aug 2026" | "assignment queued · APR-2042"
  kind: "reserved" | "queued";
  visible: boolean;
  /** Phase 26 (spec §5.2): the live reservation this row came from — null for a queued (approval) row. */
  reservationId: string | null;
  expiresAt: Date | null;
}

export function LoadoutView({
  employeeId,
  employeeName,
  initialView,
  canLinkPolicies,
  slots,
  unslotted,
  onLoan,
  waived,
  itTypes,
  spares,
  holding,
  frozen,
  dueAt,
  today,
  canMutate,
  direct,
}: {
  employeeId: string;
  /** Phase 29 (spec §4.6): the Return dialog names the holder, not just the tag. */
  employeeName: string;
  /** Phase 29 (spec §4.8): the remembered Slots/Table choice for this user. */
  initialView: "slots" | "table";
  /** Phase 29 (spec §4.2): only a role that can reach Equipment policies gets the link, everyone else the words. */
  canLinkPolicies: boolean;
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
  /** Phase 25: the leaver's complete-by date (OFFBOARDING only; null otherwise) and the Asia/Manila today for the pill. */
  dueAt: Date | null;
  today: string;
  canMutate: boolean;
  direct: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [view, setView] = useState<"slots" | "table">(initialView);
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
  const [reservingSlot, setReservingSlot] = useState<SlotTile | null>(null);
  const [reserveSpare, setReserveSpare] = useState<string | null>(null);
  const [reserveExpiry, setReserveExpiry] = useState(defaultHoldExpiry(today));
  const [reserveReason, setReserveReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  // Phase 29 (plan P-10): which tile is mid-write, and which one just changed —
  // the tile dims while the action runs, then rings once for 2 s.
  const [busySlotId, setBusySlotId] = useState<string | null>(null);
  const [changedSlotId, setChangedSlotId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const tileRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const mayAct = canMutate && !frozen;
  const reservedCount = holding.filter((h) => h.kind === "reserved").length;
  // Phase 29 (spec §4.4): required gaps first, then what is filled or on loan,
  // then optional gaps. `tileRefs` and the roving grid keys index THIS order.
  const ordered = orderTiles(slots);

  function markChanged(slotId: string | null) {
    if (!slotId) return;
    setChangedSlotId(slotId);
    setTimeout(() => setChangedSlotId((c) => (c === slotId ? null : c)), 2000);
  }

  function handle<T>(res: ActionResult<T>, onOk: (data: T) => void) {
    setBusySlotId(null);
    if (res.ok) onOk(res.data);
    else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
    else if (res.kind === "validation") setFieldErrors(res.fieldErrors ?? {});
    else setError(res.message);
  }

  function pickView(v: string) {
    const next: "slots" | "table" = v === "table" ? "table" : "slots";
    setView(next);
    // Fire-and-forget (plan P-11): remembering the view must never block it.
    void saveLoadoutView({ view: next });
  }

  /** The slot a held asset sits in — the Return/Replace dialogs only carry the asset. */
  const slotIdOf = (assetId: string) => slots.find((s) => s.asset?.id === assetId)?.slotId ?? null;

  function submitFill() {
    if (!pickedSpare) {
      setFieldErrors({ spare: "Pick a spare first" });
      return;
    }
    setError(null);
    setFieldErrors({});
    const slotId = fillSlot?.slotId ?? null;
    setBusySlotId(slotId);
    startTransition(async () => {
      if (direct) {
        const isLoan = fillSlot?.loaner ?? false;
        handle(
          await assignAsset({
            assetId: pickedSpare, employeeId, status: isLoan ? "TEMPORARY" : undefined,
            loanDueAt: isLoan ? loanDueAt : undefined, reason,
          }),
          ({ tag, employeeName: assignedTo }) => {
            toast(isLoan ? `${tag} on loan to ${assignedTo} until ${loanDueAt}` : `${tag} assigned to ${assignedTo}`, "settled");
            setFillSlot(null);
            setPickedSpare(null);
            setReason("");
            setLoanDueAt(defaultLoanDue(new Date()));
            markChanged(slotId);
            router.refresh();
          },
        );
      } else {
        handle(await requestAssign({ employeeId, assetId: pickedSpare, reason }), ({ refNo }) => {
          toast(`${refNo} created — tile shows pending until it executes`, "settled");
          setFillSlot(null);
          setPickedSpare(null);
          setReason("");
          markChanged(slotId);
          router.refresh();
        });
      }
    });
  }

  /** Phase 29 (spec §4.4): the reservation sitting on an empty tile, assigned from the tile itself. */
  function submitAssignReserved(assetId: string, slotId: string) {
    setError(null);
    setFieldErrors({});
    setBusySlotId(slotId);
    startTransition(async () => {
      if (direct) {
        handle(await assignAsset({ assetId, employeeId, reason: "" }), ({ tag, employeeName: assignedTo }) => {
          toast(`${tag} assigned to ${assignedTo}`, "settled");
          markChanged(slotId);
          router.refresh();
        });
      } else {
        handle(await requestAssign({ employeeId, assetId, reason: "" }), ({ refNo }) => {
          toast(`${refNo} created — tile shows pending until it executes`, "settled");
          markChanged(slotId);
          router.refresh();
        });
      }
    });
  }

  function submitReturn() {
    if (!returning) return;
    setError(null);
    setFieldErrors({});
    const slotId = slotIdOf(returning.id);
    setBusySlotId(slotId);
    startTransition(async () => {
      if (direct) {
        handle(await returnAsset({ assetId: returning.id, outcome, reason: returnReason }), ({ tag, status }) => {
          toast(`${tag} returned · now ${status}`, "settled");
          setReturning(null);
          setReturnReason("");
          setOutcome("TRIAGE");
          markChanged(slotId);
          router.refresh();
        });
      } else {
        handle(await requestReturn({ employeeId, assetId: returning.id, reason: returnReason }), ({ refNo }) => {
          toast(`${refNo} created — return is queued`, "settled");
          setReturning(null);
          setReturnReason("");
          markChanged(slotId);
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
    const slotId = slotIdOf(replacing.id);
    setBusySlotId(slotId);
    startTransition(async () => {
      handle(
        await replaceAsset({ employeeId, oldAssetId: replacing.id, newAssetId: replacementId, outcome, reason: returnReason }),
        ({ oldTag, newTag }) => {
          toast(`${oldTag} replaced by ${newTag}`, "settled");
          setReplacing(null);
          setReplacementId(null);
          setReturnReason("");
          setOutcome("TRIAGE");
          markChanged(slotId);
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

  function submitReserve() {
    if (!reservingSlot || !reserveSpare) return;
    setError(null);
    setFieldErrors({});
    const slotId = reservingSlot.slotId;
    setBusySlotId(slotId);
    startTransition(async () => {
      handle(
        await reserveAsset({ assetId: reserveSpare, employeeId, expiresAt: reserveExpiry, reason: reserveReason }),
        ({ tag }) => {
          toast(`${tag} reserved`, "settled");
          setReservingSlot(null);
          markChanged(slotId);
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
      const el = tileRefs.current[Math.min(Math.max(to, 0), ordered.length - 1)];
      el?.focus();
    };
    if (e.key === "ArrowRight") { e.preventDefault(); move(idx + 1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); move(idx - 1); }
    else if (e.key === "ArrowDown") { e.preventDefault(); move(idx + 4); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(idx - 4); }
    else if (e.key === "Backspace" && mayAct) {
      // Phase 29 (plan P-7): the tile IS the menu trigger now — Backspace opens
      // the same menu Enter/Space and a click do, instead of jumping to Return.
      const tile = ordered[idx];
      if (tile.asset) { e.preventDefault(); tileRefs.current[idx]?.click(); }
    }
  }

  // A spare promised to someone else: unpickable here, and it has to LOOK unpickable (final review M-6).
  const isHeld = (s: { reservedFor: string | null; reservedForThis: boolean }) => s.reservedFor !== null && !s.reservedForThis;
  // Phase 29 (spec §4.5): a queued approval promises a spare just as firmly as a hold does.
  const unpickable = (s: SpareOption) => isHeld(s) || !!s.pendingRef;
  /** The one line a picker row shows on the right — shared by Fill and Replace so they never drift. */
  const spareNote = (s: SpareOption) =>
    s.pendingRef ? `assignment queued · ${s.pendingRef}`
      : s.reservedForThis ? "reserved for them"
        : s.reservedFor ? `reserved for ${s.reservedFor}`
          : "spare";

  const sparesForSlot = fillSlot ? spares.filter((s) => s.typeId && s.typeId === fillSlot.typeId) : [];

  /** Phase 29 (spec §4.4): opening Fill preselects the sole pickable spare — one less decision. */
  function openFill(tile: SlotTile) {
    const eligible = spares.filter((s) => s.typeId && s.typeId === tile.typeId && !unpickable(s));
    setFillSlot(tile);
    setPickedSpare(eligible.length === 1 ? eligible[0].id : null);
    setFieldErrors({});
    setError(null);
    setLoanDueAt(defaultLoanDue(new Date()));
  }

  // Phase 29 (plan P-6): the header's "Fill N gaps" / "Assign kit" reach the
  // grid through one DOM event — no ref threading across the server boundary.
  useEffect(() => {
    function onLoadout(e: Event) {
      const action = (e as CustomEvent<{ action: "focus-gap" | "fill-first" }>).detail?.action;
      const idx = ordered.findIndex((t) => !t.asset && !t.coveredByLoan && t.required);
      if (idx < 0) return;
      if (action === "focus-gap") tileRefs.current[idx]?.focus();
      else if (action === "fill-first" && mayAct) openFill(ordered[idx]);
    }
    window.addEventListener("br:loadout", onLoadout);
    return () => window.removeEventListener("br:loadout", onLoadout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordered, mayAct]);

  // The tile a Replace dialog opened for isn't self-describing its slot's
  // type — look it up from `slots` so the picker can rank same-type
  // spares first. Not `slotTypeOf(replacing)`: no such helper exists.
  const replacingTypeId = replacing ? slots.find((s) => s.asset?.id === replacing.id)?.typeId ?? null : null;

  // Phase 26 (spec §5.2) / Phase 29 (plan P-9): both comboboxes rank same-type
  // spares first and group them under "Same type" / "Other spares".
  const sameTypeFirstFor = (typeId: string | null) => (a: SpareOption, b: SpareOption) => {
    const aSame = a.typeId === typeId ? 0 : 1;
    const bSame = b.typeId === typeId ? 0 : 1;
    return aSame !== bSame ? aSame - bSame : a.tag.localeCompare(b.tag);
  };

  // Phase 29 (plan P-9): EntityCombobox has no disabled options, so a spare
  // held for someone else or already promised by an approval is left OUT of
  // Replace — the count under the field says how many that was.
  const replaceable = replacing ? spares.filter((s) => !unpickable(s)) : [];
  const excludedCount = replacing ? spares.length - replaceable.length : 0;
  const replaceOptions: ComboOption[] = replaceable
    .sort(sameTypeFirstFor(replacingTypeId))
    .map((s) => ({
      value: s.id, label: s.tag,
      sub: s.reservedForThis ? `${s.model} · reserved for them` : s.model,
      group: s.typeId === replacingTypeId ? "Same type" : "Other spares",
    }));

  // Phase 26 (spec §5.2): the Reserve dialog's own picker — unlike Fill/Replace,
  // an already-held spare is excluded outright (reserving one out from under
  // an existing hold is exactly what release-then-reserve is for).
  const reserveOptions: ComboOption[] = reservingSlot
    ? spares
        .filter((s) => s.reservedFor === null)
        .sort(sameTypeFirstFor(reservingSlot.typeId))
        .map((s) => ({
          value: s.id, label: s.tag, sub: s.model,
          group: s.typeId === reservingSlot.typeId ? "Same type" : "Other spares",
        }))
    : [];

  return (
    <div className="flex flex-col gap-4">
      {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
      {error && <Banner tone="fault" title={error} />}
      {frozen && (
        <Banner tone="attention" title="Offboarding in progress — slots are frozen">
          {dueAt && (
            <span className="mr-2 inline-flex align-middle">
              <DuePill dueAt={dueAt} today={today} withDate />
            </span>
          )}
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
          onChange={pickView}
        />
        <div className="flex items-center gap-2">
          {mayAct && reservedCount > 0 && (
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

      {/* Phase 29 (spec §4.2): a policy is only actionable for a role that can
          reach Equipment policies, and never for a leaver — the frozen banner
          above already says what to do next. */}
      {slots.length === 0 && !frozen && (
        <Banner tone="neutral" title="No equipment policy applies">
          Held items are listed below;{" "}
          {canLinkPolicies ? (
            <Link href="/admin/equipment-policies" className="underline">define a policy under Equipment policies</Link>
          ) : (
            "define a policy under Equipment policies"
          )}{" "}
          to get the slot grid.
        </Banner>
      )}

      {view === "slots" ? (
        <div role="group" aria-label="Equipment slots" className="grid grid-cols-2 gap-[11px] lg:grid-cols-4" onKeyDown={onGridKeyDown}>
          {ordered.map((tile, i) => {
            const a = tile.asset;
            // Phase 20 (spec §6.3): a loan-covered empty slot says so in its
            // accessible name too — the LOAN pill alone was sighted-only.
            const name = `${tile.name} slot, ${a ? a.model : tile.coveredByLoan ? "on loan" : "empty"}, ${tile.required ? "required" : "optional"}`;
            // Phase 29 (spec §4.4): WHICH items the menu offers is a pure rule
            // (`tileMenuItems`) — this only turns each kind into its handler.
            const kinds = tileMenuItems(
              { filled: !!a, pending: !!a?.pendingRef, required: tile.required, exceptionId: tile.exceptionId, waivable: !tile.exceptionId },
              { mayAct, direct },
            );
            const menuItems: MenuItem[] = kinds.map((k) => {
              switch (k) {
                case "replace":
                  return { label: "Replace…", onSelect: () => { setReplacing(a!); setReplacementId(null); setFieldErrors({}); setError(null); } };
                case "return":
                  return { label: "Return…", danger: true, onSelect: () => setReturning(a!) };
                case "open":
                  return { label: "Open record", onSelect: () => router.push(`/inventory/${a!.id}`) };
                case "reserve":
                  return {
                    label: "Reserve a spare…",
                    onSelect: () => {
                      setReservingSlot(tile);
                      setReserveSpare(null);
                      setReserveExpiry(defaultHoldExpiry(today));
                      setReserveReason("");
                      setFieldErrors({});
                      setError(null);
                    },
                  };
                case "waive":
                  return { label: "Waive this slot…", onSelect: () => setWaivingSlot(tile) };
                case "remove-exception":
                  return { label: "Remove exception", onSelect: () => removeException(tile.exceptionId!) };
              }
            });
            // Phase 29 (spec §4.4): a hold placed for THIS person that fits this
            // empty slot — the tile says so, and offers the one-click assign.
            const reservedHere = !a
              ? spares.find((s) => s.reservedForThis && s.typeId && s.typeId === tile.typeId && !s.pendingRef) ?? null
              : null;
            const busy = busySlotId === tile.slotId;
            const changed = changedSlotId === tile.slotId;

            // Shared by all three branches below — the tile is a <div> for a
            // viewer, a Menu trigger when filled, a Fill trigger when empty.
            const tileBody = () =>
              a ? (
                <>
                  <span
                    aria-hidden
                    className="h-1.5 w-full rounded-full"
                    style={{ background: `var(--st-${statusFamily(a.status)}-dot, var(--st-neutral-dot))` }}
                  />
                  <span className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-fg-muted">{tile.name}</span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className={cn("text-[11.5px] font-medium", a.pendingRef ? "text-fg-muted" : "text-fg")}>{a.model}</span>
                    {a.pendingRef && <Pill tone="accent">PENDING</Pill>}
                  </span>
                  {/* Plan P-8: the tag is text, not a link — a link inside the tile
                      button is axe's nested-interactive. "Open record" is the route. */}
                  <span className="font-mono text-[11px] text-fg">{a.tag}</span>
                  {(tile.loaner || tile.exceptionId) && (
                    <span className="flex flex-wrap items-center gap-1">
                      {tile.loaner && <Pill>LOAN</Pill>}
                      {tile.exceptionId && <Pill title={tile.exceptionReason ?? undefined}>EXCEPTION</Pill>}
                    </span>
                  )}
                  <span className="font-mono text-[10px] text-fg-muted">{a.pendingRef ?? a.age}</span>
                </>
              ) : (
                <>
                  <span aria-hidden className="grid h-[42px] w-full place-items-center rounded-[6px]">
                    {mayAct && (
                      <span className="grid size-[30px] place-items-center rounded-full border border-border-strong text-fg-muted">+</span>
                    )}
                  </span>
                  <span className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-fg-secondary">{tile.name}</span>
                  {/* Phase 29 (spec §4.4): an empty OPTIONAL slot is not work — say
                      so, instead of repeating the type and the same word again. */}
                  <span className="font-mono text-[10px] text-fg-muted">
                    {!tile.required && !tile.coveredByLoan
                      ? "optional — not a gap"
                      : `${tile.typeName} · ${tile.required ? "required" : "optional"}`}
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
                  {reservedHere && (
                    <span className="font-mono text-[10px] text-fg-muted">reserved · {reservedHere.tag}</span>
                  )}
                </>
              );

            const tileClass = cn(
              "flex w-full flex-col gap-1.5 rounded-(--radius-card) border p-3 text-left transition-colors duration-(--dur-1)",
              a ? "border-border bg-surface shadow-card" : "border-dashed border-border-strong",
              !a && tile.required && !tile.coveredByLoan && "bg-[var(--st-attention-bg)]/40",
              mayAct && "hover:border-accent",
              busy && "opacity-60",
              changed && "tile-changed",
            );
            // Plan P-10: the tile says it is mid-write, then that it just changed.
            const shared = {
              "aria-label": name,
              "data-pending": busy || undefined,
              "aria-busy": busy || undefined,
              "data-changed": changed || undefined,
            } as const;

            return (
              // A real Menu trigger cannot nest inside the tile's own <button>
              // (axe: nested-interactive) — the ⋯ and "Assign reserved" are
              // SIBLINGS inside this "group relative" wrapper.
              <div key={tile.slotId} className="group relative flex flex-col gap-1">
                {!canMutate ? (
                  // Ruling R2: the inert branch is the VIEWER — no button, no menu, no "+".
                  <div role="group" {...shared} className={tileClass}>{tileBody()}</div>
                ) : a ? (
                  // Plan P-7: the filled tile IS the menu's trigger. Menu's root is
                  // `relative inline-flex`, so stretch it to fill the grid cell.
                  <div className="[&>div]:w-full">
                    <Menu
                      align="start"
                      items={menuItems}
                      trigger={(props) => (
                        <button ref={(el) => { tileRefs.current[i] = el; }} type="button" {...props} {...shared} className={tileClass}>
                          {tileBody()}
                        </button>
                      )}
                    />
                  </div>
                ) : (
                  <button
                    ref={(el) => { tileRefs.current[i] = el; }}
                    type="button"
                    {...shared}
                    className={tileClass}
                    onClick={() => { if (mayAct) openFill(tile); }}
                  >
                    {tileBody()}
                  </button>
                )}
                {menuItems.length > 0 && canMutate && (
                  // Plan P-7: always visible, not hover-revealed — the same items as the tile's own menu.
                  <div className="absolute right-1.5 top-1.5">
                    <Menu
                      align="end"
                      items={menuItems}
                      trigger={(props) => (
                        <button
                          type="button"
                          {...props}
                          aria-label={`Actions for the ${tile.name} slot`}
                          className="grid size-7 place-items-center rounded-[6px] border border-transparent bg-surface/90 font-mono text-[12px] text-fg-faint shadow-card hover:text-fg"
                        >
                          ⋯
                        </button>
                      )}
                    />
                  </div>
                )}
                {reservedHere && mayAct && direct && (
                  <Button size="sm" variant="secondary" loading={busy} onClick={() => submitAssignReserved(reservedHere.id, tile.slotId)}>
                    Assign reserved
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
            {/* Phase 29 (spec §4.8): the Table lists the EMPTY slots too — a gap
                is a row here, not something only the grid can show. */}
            {[...ordered.map((s) => ({
                key: s.slotId,
                a: s.asset,
                slot: s.name,
                gap: !s.asset && !s.coveredByLoan ? (s.required ? "policy gap" : "optional") : s.coveredByLoan ? "on loan" : null,
              })),
              ...onLoan.filter(Boolean).map((a) => ({ key: a!.id, a: a!, slot: "on loan", gap: null })),
              ...unslotted.filter(Boolean).map((a) => ({ key: a!.id, a: a!, slot: "—", gap: null }))].map(({ key, a, slot, gap }) => (
              <Tr key={key}>
                <Td className="pr-0">{a && <StatusDot value={a.status} />}</Td>
                <Td mono>{a ? <TagRef id={a.id} tag={a.tag} visible={a.visible} className="text-accent hover:underline" /> : "—"}</Td>
                <Td>{a ? a.model : "—"}</Td>
                <Td mono className="text-[10.5px]">{slot}</Td>
                <Td mono className="text-[10.5px]">{a ? a.status : gap ?? "—"}</Td>
                <Td mono>{a ? a.age : "—"}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}

      {onLoan.length > 0 && (
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

      {unslotted.length > 0 && (
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
                {h.kind === "reserved" ? (
                  <span className="ml-auto inline-flex items-center gap-2">
                    {h.expiresAt && <HoldPill expiresAt={h.expiresAt} today={today} />}
                    {mayAct && direct && h.reservationId && (
                      <ReleaseHoldButton reservationId={h.reservationId} tag={h.tag} size="sm" />
                    )}
                  </span>
                ) : (
                  <span className="ml-auto font-mono text-[10px] text-fg-muted">{h.note}</span>
                )}
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
              No spare {fillSlot?.typeName} in stock —{" "}
              <Link href="/inventory/register" className="text-accent underline hover:text-accent-hover">register one</Link> or{" "}
              <Link href="/purchases/new" className="text-accent underline hover:text-accent-hover">route a purchase</Link>.
            </p>
          ) : (
            // Plan P-9: Fill keeps its radiogroup — a row that cannot be picked
            // still has to SAY why, which a combobox has no room for.
            <div role="radiogroup" aria-label="Pick a spare" className="flex flex-col gap-1">
              {fieldErrors.spare && <p role="alert" className="text-[11px] font-medium" style={{ color: "var(--error-text)" }}>{fieldErrors.spare}</p>}
              {sparesForSlot.map((s) => (
                <label
                  key={s.id}
                  className={cn(
                    "flex items-center gap-2 rounded-(--radius-ctl) border px-2 py-1.5 text-xs",
                    unpickable(s) ? "cursor-not-allowed opacity-55" : "cursor-pointer",
                    pickedSpare === s.id ? "border-accent bg-accent-tint" : cn("border-border", !unpickable(s) && "hover:bg-surface-subtle"),
                  )}
                >
                  <input
                    type="radio"
                    name="spare"
                    className="sr-only"
                    checked={pickedSpare === s.id}
                    disabled={unpickable(s)}
                    onChange={() => setPickedSpare(s.id)}
                  />
                  <span className="font-mono text-accent">{s.tag}</span>
                  <span className="text-fg-secondary">{s.model}</span>
                  <span className="ml-auto font-mono text-[10px] text-fg-muted">{spareNote(s)}</span>
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
          <ReasonField
            hint={direct ? "Optional — recorded in the audit trail." : "Optional — lands in the approval payload."}
            error={fieldErrors.reason} value={reason} onChange={setReason}
            chips={REASON_CHIPS["asset.assign"]} disabled={pending}
          />
        </div>
      </Dialog>

      {/* Reserve-a-spare dialog (spec §5.2): the empty slot's ⋯ menu affordance, a sibling of the fill-slot dialog above. */}
      <Dialog
        open={reservingSlot !== null}
        onClose={() => setReservingSlot(null)}
        title={reservingSlot ? `Reserve a spare for the ${reservingSlot.name} slot` : ""}
        footer={
          <>
            <Button variant="ghost" onClick={() => setReservingSlot(null)}>Cancel</Button>
            <Button variant="primary" loading={pending} disabled={!reserveSpare} onClick={submitReserve}>Reserve</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <FormField label="Spare" required error={fieldErrors.assetId}>
            {(p) => (
              <EntityCombobox
                id={p.id}
                aria-describedby={p["aria-describedby"]}
                invalid={p.invalid}
                options={reserveOptions}
                value={reserveSpare}
                onChange={setReserveSpare}
                placeholder="Type a tag…"
                autoFocus
              />
            )}
          </FormField>
          <FormField label="Expires" required error={fieldErrors.expiresAt}>
            {(p) => (
              <Input id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid} type="date"
                min={minHoldExpiry(today)} value={reserveExpiry} onChange={(e) => setReserveExpiry(e.target.value)} />
            )}
          </FormField>
          <ReasonField
            hint="Optional — recorded in the audit trail."
            error={fieldErrors.reason} value={reserveReason} onChange={setReserveReason}
            chips={REASON_CHIPS["hold.place"]} disabled={pending}
          />
        </div>
      </Dialog>

      {/* Return dialog */}
      <Dialog
        open={returning !== null}
        onClose={() => setReturning(null)}
        title={returning ? `Return ${returning.tag} · ${returning.model} from ${employeeName}?` : ""}
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
          <ReasonField
            required={!direct || reasonRequiredFor(outcome)} error={fieldErrors.reason} value={returnReason} onChange={setReturnReason}
            chips={direct ? chipsForOutcome(outcome) : []} disabled={pending}
          />
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
          {/* Plan P-9: a searchable picker, and what it CANNOT offer is said in
              one muted line rather than shown as unpickable rows. */}
          {replaceOptions.length === 0 ? (
            <p className="text-xs text-fg-muted">
              No spares in stock —{" "}
              <Link href="/inventory/register" className="text-accent underline hover:text-accent-hover">register one</Link> or{" "}
              <Link href="/purchases/new" className="text-accent underline hover:text-accent-hover">route a purchase</Link>.
            </p>
          ) : (
            <FormField
              label="Replacement"
              required
              error={fieldErrors.replacement}
              hint={excludedCount ? `${excludedCount} more spare${excludedCount === 1 ? "" : "s"} ${excludedCount === 1 ? "is" : "are"} held or queued for someone else` : undefined}
            >
              {(p) => (
                <EntityCombobox
                  id={p.id}
                  aria-describedby={p["aria-describedby"]}
                  invalid={p.invalid}
                  options={replaceOptions}
                  value={replacementId}
                  onChange={setReplacementId}
                  placeholder="Type a tag…"
                  autoFocus
                />
              )}
            </FormField>
          )}
          <FormField label="What happens to it" required error={fieldErrors.outcome}>
            {(p) => (
              <Select id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                value={outcome} onChange={(e) => setOutcome(e.target.value as ReturnOutcome)}>
                {RETURN_OUTCOMES.map((o) => <option key={o} value={o}>{RETURN_OUTCOME_LABEL[o]}</option>)}
              </Select>
            )}
          </FormField>
          <ReasonField
            required={reasonRequiredFor(outcome)} error={fieldErrors.reason} value={returnReason} onChange={setReturnReason}
            chips={chipsForOutcome(outcome)} disabled={pending}
          />
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
