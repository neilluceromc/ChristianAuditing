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
import { type MenuItem } from "@/components/ui/menu";
import { Select } from "@/components/ui/select";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { StatusDot } from "@/components/ui/status";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { EntityCombobox, type ComboOption } from "@/components/patterns/entity-combobox";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { ReasonField } from "@/components/patterns/reason-field";
import { REASON_CHIPS, chipsForOutcome } from "@/lib/reason-chips";
import { statusLabel } from "@/lib/asset-class";
import { ReleaseHoldButton } from "@/components/inventory/release-hold-button";
import { TagRef } from "@/components/inventory/tag-ref";
import { EquipmentTile, type EquipmentTileData, type TileAsset } from "@/components/employees/equipment-tile";
import { HeldItemPanel } from "@/components/employees/held-item-panel";
import { AddSlotDialog, RemoveExceptionButton, WaiveSlotDialog, type ItCategoryOption } from "@/components/employees/slot-exception-controls";
import { requestAssign, requestAssignReserved, requestReturn } from "@/server/modules/employees/actions";
import { reserveAsset } from "@/server/modules/reservations/actions";
import { assignAsset, assignReserved, replaceAsset, returnAsset } from "@/server/modules/lifecycle/actions";
import { removeSlotException } from "@/server/modules/employees/exception-actions";
import { saveLoadoutView } from "@/server/preferences";
import { profileTileMenuItems, tileChip, type TileMenuItem } from "@/lib/loadout";
import {
  DEFAULT_LOAN_DAYS, RETURN_OUTCOMES, RETURN_OUTCOME_LABEL, defaultLoanDue, minLoanDue, reasonRequiredFor,
  type ReturnOutcome,
} from "@/lib/lifecycle";
import { defaultHoldExpiry, minHoldExpiry } from "@/lib/holds";
import { SPARE_QUERY_MAX, isUnpickable, replacePicker, solePick, type SpareOption } from "@/lib/spare-candidates";
import { SpareLoadRow, refocusFirstField, useSpareCandidates, type SpareLoad } from "@/components/employees/use-spare-candidates";
import type { ActionResult } from "@/server/action-result";

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

/** A slot tile with no device of its own: empty, or stood in for by a loan. */
const openSlot = (t: EquipmentTileData) => t.kind === "slot" && (!t.asset || t.coveredByLoan);

/**
 * Phase 29 (ruling R8): one hold marks ONE tile. Keyed only on the type, a
 * per-tile `find` lit up every empty slot of that type and gave each its own
 * "Assign reserved" for the SAME asset (and `markChanged` could then ring a
 * tile that never changed). This consumes each reserved-for-this-person spare
 * into the first empty tile of its type, in the order the grid renders.
 */
function reservationsBySlot(ordered: EquipmentTileData[], reserved: SpareOption[]): Map<string, SpareOption> {
  const pool = reserved.filter((s) => s.reservedForThis && s.typeId !== null && !s.pendingRef);
  const out = new Map<string, SpareOption>();
  for (const tile of ordered) {
    if (!openSlot(tile)) continue;
    const i = pool.findIndex((s) => s.typeId === tile.typeId);
    if (i < 0) continue;
    out.set(tile.key, pool[i]);
    pool.splice(i, 1);
  }
  return out;
}

// A spare promised to someone else (held, or — Phase 29 spec §4.5 — queued by an approval): unpickable here,
// and it has to LOOK unpickable (final review M-6). The rule lives beside the server's count of the same thing.
const unpickable = isUnpickable;
/** The one line a picker row shows on the right — shared by Fill and Replace so they never drift. */
const spareNote = (s: SpareOption) =>
  s.pendingRef ? `assignment queued · ${s.pendingRef}`
    : s.reservedForThis ? "reserved for them"
      : s.reservedFor ? `reserved for ${s.reservedFor}`
        : "spare";
/** Fill only ever offers the slot's own type. */
const ofType = (list: SpareOption[], typeId: string | null) => list.filter((s) => s.typeId && s.typeId === typeId);

/** Phase 37 (spec §4.4): `?item=<assetId>` keeps the open side panel across a refresh. */
function setItemParam(assetId: string | null) {
  const url = new URL(window.location.href);
  if (assetId) url.searchParams.set("item", assetId);
  else url.searchParams.delete("item");
  // `null` state: Next's patched replaceState then keeps its own history entry and syncs the router's URL.
  window.history.replaceState(null, "", url);
}

export function LoadoutView({
  employeeId,
  employeeName,
  initialView,
  canLinkPolicies,
  tiles,
  unslotted,
  onLoan,
  waived,
  itCategories,
  currentSlotLabels,
  reservedSpares,
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
  /** Phase 37 (spec §4.3): every tile, in grid order — `profileTiles` on the server. */
  tiles: EquipmentTileData[];
  /** The Table view keeps its own rows: held assets no slot claimed… */
  unslotted: TileAsset[];
  /** …and TEMPORARY devices no loaner slot claimed (Phase 16). */
  onLoan: TileAsset[];
  /** Phase 16: this person's own WAIVE exceptions. */
  waived: Array<{ id: string; slotName: string; reason: string }>;
  /** Phase 37 (spec §4.7): IT categories with their types, offered by the "Add a slot" dialog. */
  itCategories: ItCategoryOption[];
  /** The slot labels this person's tiles already carry, un-numbered, in policy order — the dialog's "Shows as" line numbers against them. */
  currentSlotLabels: string[];
  /**
   * Phase 39 (spec §6): only the spares held for THIS person ship with the page — the tiles' "reserved · {tag}"
   * line and Assign reserved need them at first paint. The pickers ask `spareCandidates` when they open.
   */
  reservedSpares: SpareOption[];
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
  const [fillSlot, setFillSlot] = useState<EquipmentTileData | null>(null);
  const [pickedSpare, setPickedSpare] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [loanDueAt, setLoanDueAt] = useState(defaultLoanDue(new Date()));
  const [returning, setReturning] = useState<TileAsset | null>(null);
  const [returnReason, setReturnReason] = useState("");
  const [replacing, setReplacing] = useState<TileAsset | null>(null);
  const [replacementId, setReplacementId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ReturnOutcome>("TRIAGE");
  const [waivingSlot, setWaivingSlot] = useState<EquipmentTileData | null>(null);
  const [addingSlot, setAddingSlot] = useState(false);
  const [reservingSlot, setReservingSlot] = useState<EquipmentTileData | null>(null);
  const [reserveSpare, setReserveSpare] = useState<string | null>(null);
  // The picked combobox rows, so the field still names a pick the current answer no longer lists.
  const [replacementPick, setReplacementPick] = useState<ComboOption | null>(null);
  const [reservePick, setReservePick] = useState<ComboOption | null>(null);
  const [reserveExpiry, setReserveExpiry] = useState(defaultHoldExpiry(today));
  const [reserveReason, setReserveReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  // Phase 29 (plan P-10): which tile is mid-write, and which one just changed —
  // the tile dims while the action runs, then rings once for 2 s. Keyed on the tile key.
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [changedKey, setChangedKey] = useState<string | null>(null);
  // Phase 29 (plan P-6): the tile "Fill N gaps" wants focused, held until the
  // grid has actually mounted — from the Table view every tile ref is null.
  const [pendingFocusKey, setPendingFocusKey] = useState<string | null>(null);
  // Phase 37 (spec §4.4): the held item open in the side panel, as the tile showed it.
  const [panel, setPanel] = useState<{ key: string; asset: TileAsset } | null>(null);
  const [pending, startTransition] = useTransition();
  // Each tile's one keyboard stop (its opener, else its Fill), by tile key.
  const tileRefs = useRef(new Map<string, HTMLButtonElement>());
  // The tile the panel goes back to on close — null when a dialog takes over instead.
  const returnFocusKey = useRef<string | null>(null);

  const mayAct = canMutate && !frozen;
  const reservedCount = holding.filter((h) => h.kind === "reserved").length;
  const slotTiles = tiles.filter((t) => t.kind === "slot");
  // Ruling R8: resolved once for the whole grid, so a hold cannot mark two tiles.
  const reservedBySlot = reservationsBySlot(tiles, reservedSpares);

  // Phase 39 (spec §6): each picker asks for its spares when its dialog opens, with the slot's type.
  // The tile a Replace dialog opened for isn't self-describing its slot's
  // type — look it up from the tiles so the picker can rank same-type
  // spares first.
  const replacingTypeId = replacing ? tiles.find((t) => t.asset?.id === replacing.id)?.typeId ?? null : null;
  const fillTypeId = fillSlot?.typeId ?? null;
  const fillSpares = useSpareCandidates(employeeId, fillSlot && fillTypeId ? fillSlot.key : null, fillTypeId);
  // Replace and Reserve cannot offer a spare held or queued for someone else: the server leaves those out of the
  // rows (`pickable`), so 50 of them never fill the list while a free spare exists. The counts stay pool-wide.
  const replaceSpares = useSpareCandidates(employeeId, replacing ? replacing.id : null, replacingTypeId, { pickable: true });
  const reserveSpares = useSpareCandidates(
    employeeId, reservingSlot ? reservingSlot.key : null, reservingSlot?.typeId ?? null, { pickable: true },
  );

  // Phase 29 (spec §4.4): opening Fill preselects the sole pickable spare — one less decision. Now that the
  // spares arrive after the dialog opens, the pick is made when they do (and never over one already made),
  // and "sole" is the whole pool's count of the slot's type, not the rows loaded.
  useEffect(() => {
    if (fillSpares.base.status !== "ready" || !fillSpares.base.counts?.sameType) return;
    const id = solePick(fillSpares.base.items, fillTypeId, fillSpares.base.counts.sameType);
    if (id) setPickedSpare((p) => p ?? id);
  }, [fillSpares.base, fillTypeId]);

  // A pick the search has just hidden is dropped, so Confirm never assigns a spare the dialog no longer shows.
  useEffect(() => {
    if (fillSpares.shown.status !== "ready" || !pickedSpare) return;
    if (!fillSpares.shown.items.some((s) => s.id === pickedSpare)) setPickedSpare(null);
  }, [fillSpares.shown, pickedSpare]);

  const refFor = (key: string) => (el: HTMLButtonElement | null) => {
    if (el) tileRefs.current.set(key, el);
    else tileRefs.current.delete(key);
  };

  function markChanged(key: string | null) {
    if (!key) return;
    setChangedKey(key);
    setTimeout(() => setChangedKey((c) => (c === key ? null : c)), 2000);
  }

  function handle<T>(res: ActionResult<T>, onOk: (data: T) => void) {
    setBusyKey(null);
    if (res.ok) onOk(res.data);
    else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
    else if (res.kind === "validation") setFieldErrors(res.fieldErrors ?? {});
    else setError(res.message);
  }

  /**
   * Phase 29 (final review M-3): the reservation-driven writes are the only
   * ones whose REFUSAL leaves a lie on screen — the tile keeps its
   * "reserved · {tag}" line for a hold the server has just told us it could
   * not honour (released, expired, or already assigned elsewhere). Re-read the
   * server state so the line goes with it; the banner `handle` raises is
   * client state and survives the refresh.
   */
  function handleReserved<T>(res: ActionResult<T>, onOk: (data: T) => void) {
    if (!res.ok) router.refresh();
    handle(res, onOk);
  }

  function pickView(v: string) {
    const next: "slots" | "table" = v === "table" ? "table" : "slots";
    setView(next);
    // Fire-and-forget (plan P-11): remembering the view must never block it —
    // but a refusal is not nothing, so spec §7's console warning says so
    // (final review M-2). Never a toast: the operator asked for a view, not
    // for a preference write.
    void saveLoadoutView({ view: next }).then((r) => {
      if (!r.ok) console.warn("view:loadout not saved", r.kind);
    });
  }

  /** The tile a held asset shows on — the Return/Replace dialogs only carry the asset. */
  const keyOf = (assetId: string) => tiles.find((t) => t.asset?.id === assetId)?.key ?? null;

  function submitFill() {
    if (!pickedSpare) {
      setFieldErrors({ spare: "Pick a spare first" });
      return;
    }
    setError(null);
    setFieldErrors({});
    const key = fillSlot?.key ?? null;
    setBusyKey(key);
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
            markChanged(key);
            router.refresh();
          },
        );
      } else {
        handle(await requestAssign({ employeeId, assetId: pickedSpare, reason }), ({ refNo }) => {
          toast(`${refNo} created — tile shows pending until it executes`, "settled");
          setFillSlot(null);
          setPickedSpare(null);
          setReason("");
          markChanged(key);
          router.refresh();
        });
      }
    });
  }

  /** Phase 29 (spec §4.4): the reservation sitting on an empty tile, assigned from the tile itself. */
  function submitAssignReserved(assetId: string, key: string) {
    setError(null);
    setFieldErrors({});
    setBusyKey(key);
    startTransition(async () => {
      if (direct) {
        handleReserved(await assignAsset({ assetId, employeeId, reason: "" }), ({ tag, employeeName: assignedTo }) => {
          toast(`${tag} assigned to ${assignedTo}`, "settled");
          markChanged(key);
          router.refresh();
        });
      } else {
        handleReserved(await requestAssign({ employeeId, assetId, reason: "" }), ({ refNo }) => {
          toast(`${refNo} created — tile shows pending until it executes`, "settled");
          markChanged(key);
          router.refresh();
        });
      }
    });
  }

  function submitReturn() {
    if (!returning) return;
    setError(null);
    setFieldErrors({});
    const key = keyOf(returning.id);
    setBusyKey(key);
    startTransition(async () => {
      if (direct) {
        handle(await returnAsset({ assetId: returning.id, outcome, reason: returnReason }), ({ tag, status }) => {
          toast(`${tag} returned · now ${statusLabel(status)}`, "settled");
          setReturning(null);
          setReturnReason("");
          setOutcome("TRIAGE");
          markChanged(key);
          router.refresh();
        });
      } else {
        handle(await requestReturn({ employeeId, assetId: returning.id, reason: returnReason }), ({ refNo }) => {
          toast(`${refNo} created — return is queued`, "settled");
          setReturning(null);
          setReturnReason("");
          markChanged(key);
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
    const key = keyOf(replacing.id);
    setBusyKey(key);
    startTransition(async () => {
      handle(
        await replaceAsset({ employeeId, oldAssetId: replacing.id, newAssetId: replacementId, outcome, reason: returnReason }),
        ({ oldTag, newTag }) => {
          toast(`${oldTag} replaced by ${newTag}`, "settled");
          setReplacing(null);
          setReplacementId(null);
          setReturnReason("");
          setOutcome("TRIAGE");
          markChanged(key);
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
    const key = reservingSlot.key;
    setBusyKey(key);
    startTransition(async () => {
      handle(
        await reserveAsset({ assetId: reserveSpare, employeeId, expiresAt: reserveExpiry, reason: reserveReason }),
        ({ tag }) => {
          toast(`${tag} reserved`, "settled");
          setReservingSlot(null);
          markChanged(key);
          router.refresh();
        },
      );
    });
  }

  function submitReservedBatch() {
    setError(null);
    startTransition(async () => {
      if (direct) {
        handleReserved(await assignReserved({ employeeId }), ({ assigned }) => {
          toast(`${assigned} reserved spare${assigned === 1 ? "" : "s"} assigned`, "settled");
          router.refresh();
        });
      } else {
        handleReserved(await requestAssignReserved({ employeeId }), ({ created }) => {
          toast(`${created} assign request${created === 1 ? "" : "s"} created from reservations`, "settled");
          router.refresh();
        });
      }
    });
  }

  /** Arrow keys walk the tiles' keyboard stops; up/down jump a row of the CURRENT column count. */
  function onGridKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const stops = tiles.map((t) => tileRefs.current.get(t.key)).filter((el): el is HTMLButtonElement => !!el);
    const idx = stops.findIndex((el) => el === document.activeElement);
    if (idx < 0) return;
    const cols = getComputedStyle(e.currentTarget).gridTemplateColumns.split(" ").filter(Boolean).length || 1;
    const move = (to: number) => stops[Math.min(Math.max(to, 0), stops.length - 1)]?.focus();
    if (e.key === "ArrowRight") { e.preventDefault(); move(idx + 1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); move(idx - 1); }
    else if (e.key === "ArrowDown") { e.preventDefault(); move(idx + cols); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(idx - cols); }
  }

  // Phase 39 (spec §6): the pool-wide count of the slot's type decides "nothing in stock"; the rows follow
  // the search box, and keep the previous answer on screen while the next one loads.
  const fillCounts = fillSpares.base.status === "ready" ? fillSpares.base.counts?.sameType ?? null : null;
  const fillNone = fillSlot !== null && (!fillTypeId || fillCounts?.total === 0);
  const sparesForSlot = fillSpares.rows ? ofType(fillSpares.rows, fillTypeId) : null;

  /** The sole pickable spare is preselected once the spares arrive (the effect above). */
  function openFill(tile: EquipmentTileData) {
    setFillSlot(tile);
    setPickedSpare(null);
    setFieldErrors({});
    setError(null);
    setLoanDueAt(defaultLoanDue(new Date()));
  }

  /**
   * Phase 29 (spec §4.4) / Phase 37 (§4.3): WHICH items a tile's menu offers is
   * a pure rule (`profileTileMenuItems`) — this only feeds it the tile.
   */
  function kindsFor(tile: EquipmentTileData): TileMenuItem[] {
    const a = tile.asset;
    return profileTileMenuItems(
      {
        kind: tile.kind, filled: !!a, pending: !!a?.pendingRef, exceptionId: tile.exceptionId,
        waivable: !tile.exceptionId, coveredByLoan: tile.coveredByLoan,
      },
      { mayAct, direct },
    );
  }

  function startReplace(a: TileAsset) {
    setReplacing(a);
    setReplacementId(null);
    setReplacementPick(null);
    setFieldErrors({});
    setError(null);
  }

  function menuFor(tile: EquipmentTileData): MenuItem[] {
    const a = tile.asset;
    return kindsFor(tile).map((k) => {
      switch (k) {
        case "replace":
          return { label: "Replace…", onSelect: () => startReplace(a!) };
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
              setReservePick(null);
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
  }

  function openPanel(tile: EquipmentTileData) {
    if (!tile.asset) return;
    returnFocusKey.current = tile.key;
    setPanel({ key: tile.key, asset: tile.asset });
    setItemParam(tile.asset.id);
  }

  /** `restoreFocus: false` when a dialog opens in the panel's place and owns focus from here. */
  function closePanel(restoreFocus = true) {
    if (!restoreFocus) returnFocusKey.current = null;
    setPanel(null);
    setItemParam(null);
  }

  // The panel's trap hands focus back as it unmounts; this runs after that
  // cleanup and puts focus on the opening tile — also when the panel was opened
  // from `?item=` and nothing on the page had focus before it.
  useEffect(() => {
    if (panel || !returnFocusKey.current) return;
    tileRefs.current.get(returnFocusKey.current)?.focus();
    returnFocusKey.current = null;
  }, [panel]);

  // Spec §4.4: a refresh with `?item=<assetId>` reopens the panel, when that
  // asset is still one this person holds and this user can open.
  useEffect(() => {
    const item = new URLSearchParams(window.location.search).get("item");
    if (!item) return;
    const tile = tiles.find((t) => t.asset?.id === item && t.asset.visible);
    if (tile) openPanel(tile);
    else setItemParam(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Phase 29 (plan P-6): the header's "Fill N gaps" / "Assign kit" reach the
  // grid through one DOM event — no ref threading across the server boundary.
  useEffect(() => {
    function onLoadout(e: Event) {
      const action = (e as CustomEvent<{ action: "focus-gap" | "fill-first" }>).detail?.action;
      const gap = tiles.find((t) => t.kind === "slot" && !t.asset && !t.coveredByLoan && t.required);
      if (!gap) return;
      // Both actions land on the grid, so the Table view has to give way first
      // — every tile ref is null while it is mounted, and the optional chain
      // would swallow the whole thing silently. Deliberately NOT `pickView`:
      // a jump from the header is not the operator choosing a view, so it
      // must not overwrite the Table they asked to be remembered.
      setView("slots");
      if (action === "focus-gap") setPendingFocusKey(gap.key);
      else if (action === "fill-first" && mayAct) openFill(gap);
    }
    window.addEventListener("br:loadout", onLoadout);
    return () => window.removeEventListener("br:loadout", onLoadout);
  }, [tiles, mayAct]);

  // The focus itself waits for the commit that mounts the grid: refs are set
  // before effects run, so the render `setView("slots")` schedules is the one
  // that finds the tile. Keyed on the tile key, not the index, so a refresh
  // that reorders the grid still lands on the tile the operator asked for.
  useEffect(() => {
    if (!pendingFocusKey || view !== "slots") return;
    // The slot went away (a refresh filled or waived it) — drop the request
    // rather than leaving it armed for whatever reuses that key later.
    if (!tiles.some((t) => t.key === pendingFocusKey)) { setPendingFocusKey(null); return; }
    const el = tileRefs.current.get(pendingFocusKey);
    if (!el) return;
    el.focus();
    setPendingFocusKey(null);
  }, [pendingFocusKey, view, tiles]);

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
  // Phase 39 (spec §6): the count and the "nothing in stock" lines read the
  // untyped answer (`base`); the listed rows follow the typed text.
  // Phase 39 review: both read the POOL-WIDE counts the untyped call returns, never the ≤50 rows loaded.
  const replaceOptions: ComboOption[] = (replaceSpares.rows ?? [])
    .filter((s) => !unpickable(s))
    .sort(sameTypeFirstFor(replacingTypeId))
    .map((s) => ({
      value: s.id, label: s.tag,
      sub: s.reservedForThis ? `${s.model} · reserved for them` : s.model,
      group: s.typeId === replacingTypeId ? "Same type" : "Other spares",
    }));
  const replaceState =
    replaceSpares.base.status === "ready" && replaceSpares.base.counts ? replacePicker(replaceSpares.base.counts.all) : null;
  const excludedCount = replaceState?.kind === "pick" ? replaceState.hidden : 0;

  // Phase 26 (spec §5.2): the Reserve dialog's own picker — unlike Fill/Replace,
  // an already-held spare is excluded outright (reserving one out from under
  // an existing hold is exactly what release-then-reserve is for), including
  // one held for THIS person, which is why the filter is not `unpickable`.
  // Phase 29 (final review I-1): a spare an open approval already promises is
  // excluded here too — the same `pendingRef` rule Fill and Replace apply.
  const reserveOptions: ComboOption[] = reservingSlot
    ? (reserveSpares.rows ?? [])
        .filter((s) => s.reservedFor === null && !s.pendingRef)
        .sort(sameTypeFirstFor(reservingSlot.typeId))
        .map((s) => ({
          value: s.id, label: s.tag, sub: s.model,
          group: s.typeId === reservingSlot.typeId ? "Same type" : "Other spares",
        }))
    : [];

  /** The combobox's empty row while the spares are loading, failed, or matched nothing. */
  const comboEmpty = (load: SpareLoad) =>
    load.status === "loading" ? "Loading spares…"
      : load.status === "error" ? "Couldn't load the spares — try again in a moment."
        : "No spare matches.";

  // Phase 39 review (minor 1): the pickers render from the moment their dialog opens, so the trap's first
  // field is the picker, as before. When the answer then says there is nothing to pick, the picker goes and
  // focus moves on to the dialog's next field rather than dropping to the page.
  const fillBodyRef = useRef<HTMLDivElement>(null);
  const replaceBodyRef = useRef<HTMLDivElement>(null);
  const replaceGone = replaceState !== null && replaceState.kind !== "pick";
  useEffect(() => { if (fillNone) refocusFirstField(fillBodyRef.current); }, [fillNone]);
  useEffect(() => { if (replaceGone) refocusFirstField(replaceBodyRef.current); }, [replaceGone]);

  const panelTile = panel ? tiles.find((t) => t.key === panel.key) ?? null : null;
  const panelKinds = panelTile ? kindsFor(panelTile) : [];

  return (
    <Card>
      <CardHeader
        title="Equipment"
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {/* Phase 37 (spec §4.3): the per-person slot lives in the card header, beside the switch. */}
            {mayAct && (
              <Button variant="secondary" size="sm" onClick={() => setAddingSlot(true)}>
                Add a slot for this person…
              </Button>
            )}
            <SegmentedControl
              aria-label="Loadout view"
              options={[{ value: "slots", label: "Slots" }, { value: "table", label: "Table" }]}
              value={view}
              onChange={pickView}
            />
          </div>
        }
      />
      <CardBody className="flex flex-col gap-4">
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

      {mayAct && reservedCount > 0 && (
        <div className="flex justify-end">
          <Button variant="primary" size="sm" loading={pending} onClick={submitReservedBatch}>
            {direct ? `Assign all ${reservedCount} reserved` : `Request assign for all ${reservedCount} reserved`}
          </Button>
        </div>
      )}

      {/* Phase 29 (spec §4.2): a policy is only actionable for a role that can
          reach Equipment policies, and never for a leaver — the frozen banner
          above already says what to do next. */}
      {slotTiles.length === 0 && !frozen && (
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
        <div
          role="group"
          aria-label="Equipment slots"
          className="grid auto-rows-fr grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
          onKeyDown={onGridKeyDown}
        >
          {tiles.map((tile) => {
            const a = tile.asset;
            // Phase 29 (spec §4.4): the hold this slot got out of the one
            // consuming pass above — the tile says so, and offers the
            // one-click assign. Never the same asset on two tiles (R8).
            const reservedHere = reservedBySlot.get(tile.key) ?? null;
            return (
              <EquipmentTile
                key={tile.key}
                tile={tile}
                chip={tileChip({
                  kind: tile.kind, filled: !!a, required: tile.required, loaner: tile.loaner,
                  coveredByLoan: tile.coveredByLoan, loanDueAt: a?.loanDueAt ?? null,
                }, today)}
                // Ruling R2: a viewer gets no ⋯ at all — the side panel is their read-only view.
                menuItems={canMutate ? menuFor(tile) : []}
                canOpen={!!a?.visible}
                onOpen={() => openPanel(tile)}
                canFill={mayAct && openSlot(tile)}
                onFill={() => openFill(tile)}
                reservedTag={reservedHere?.tag ?? null}
                onAssignReserved={reservedHere && mayAct && direct ? () => submitAssignReserved(reservedHere.id, tile.key) : null}
                busy={busyKey === tile.key}
                changed={changedKey === tile.key}
                focusRef={refFor(tile.key)}
              />
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
                is a row here, not something only the grid can show. Phase 37:
                slot names are the tiles' numbered labels. */}
            {[...slotTiles.map((s) => ({
                key: s.key,
                a: s.coveredByLoan ? null : s.asset,
                slot: s.label,
                gap: !s.asset && !s.coveredByLoan ? (s.required ? "policy gap" : "optional") : s.coveredByLoan ? "on loan" : null,
              })),
              ...onLoan.map((a) => ({ key: a.id, a, slot: "on loan", gap: null })),
              ...unslotted.map((a) => ({ key: a.id, a, slot: "—", gap: null }))].map(({ key, a, slot, gap }) => (
              <Tr key={key}>
                <Td className="pr-0">{a && <StatusDot value={a.status} />}</Td>
                <Td mono>{a ? <TagRef id={a.id} tag={a.tag} visible={a.visible} className="text-accent hover:underline" /> : "—"}</Td>
                <Td>{a ? a.model : "—"}</Td>
                <Td mono className="text-[10.5px]">{slot}</Td>
                <Td mono className="text-[10.5px]">{a ? statusLabel(a.status) : gap ?? "—"}</Td>
                <Td mono>{a ? a.age : "—"}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
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

      {panel && (
        <HeldItemPanel
          employeeId={employeeId}
          asset={panel.asset}
          canReplace={panelKinds.includes("replace")}
          canReturn={panelKinds.includes("return")}
          canEdit={canMutate}
          onClose={() => closePanel()}
          onReplace={() => { const a = panel.asset; closePanel(false); startReplace(a); }}
          onReturn={() => { const a = panel.asset; closePanel(false); setReturning(a); }}
        />
      )}

      {/* Fill-slot dialog (the right-panel behaviour, rendered as an overlay for keyboard/mobile sanity) */}
      <Dialog
        open={fillSlot !== null}
        onClose={() => setFillSlot(null)}
        title={fillSlot ? (fillSlot.loaner && direct ? `Lend for the ${fillSlot.label} slot` : `Fill the ${fillSlot.label} slot`) : ""}
        footer={
          <>
            <Button variant="ghost" onClick={() => setFillSlot(null)}>Cancel</Button>
            <Button variant="primary" loading={pending} onClick={submitFill}>{direct ? "Confirm" : "Request assign"}</Button>
          </>
        }
      >
        <div ref={fillBodyRef} className="flex flex-col gap-3">
          {fillNone ? (
            <p className="text-xs text-fg-muted">
              No spare {fillSlot?.typeName} in stock —{" "}
              <Link href="/inventory/register" className="text-accent underline hover:text-accent-hover">register one</Link> or{" "}
              <Link href="/purchases/new" className="text-accent underline hover:text-accent-hover">route a purchase</Link>.
            </p>
          ) : (
            <>
              {/* Phase 39 (spec §6): at most 50 rows arrive — the box finds the rest by tag or model. It is there
                  from the moment the dialog opens, so the trap's first field is the picker, as before. */}
              <Input
                type="search" aria-label="Search the spares" placeholder="Type a tag or model…" className="py-1.5 text-xs"
                maxLength={SPARE_QUERY_MAX} value={fillSpares.q} onChange={(e) => fillSpares.setQ(e.target.value)}
              />
              {fieldErrors.spare && <p role="alert" className="text-[11px] font-medium" style={{ color: "var(--error-text)" }}>{fieldErrors.spare}</p>}
              {sparesForSlot === null ? (
                <SpareLoadRow load={fillSpares.pending} onRetry={fillSpares.retry} />
              ) : sparesForSlot.length === 0 ? (
                <p aria-busy={fillSpares.busy || undefined} className="text-xs text-fg-muted">No spare matches.</p>
              ) : (
                // Plan P-9: Fill keeps its radiogroup — a row that cannot be picked
                // still has to SAY why, which a combobox has no room for.
                <div role="radiogroup" aria-label="Pick a spare" aria-busy={fillSpares.busy || undefined} className="flex flex-col gap-1">
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
            </>
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
        title={reservingSlot ? `Reserve a spare for the ${reservingSlot.label} slot` : ""}
        footer={
          <>
            <Button variant="ghost" onClick={() => setReservingSlot(null)}>Cancel</Button>
            <Button variant="primary" loading={pending} disabled={!reserveSpare} onClick={submitReserve}>Reserve</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {/* Phase 39 (spec §6): the field is there from the moment the dialog opens; its list says "Loading
              spares…" until they arrive, and a failure adds a row with a retry under it. */}
          <FormField label="Spare" required error={fieldErrors.assetId}>
            {(p) => (
              <EntityCombobox
                id={p.id}
                aria-describedby={p["aria-describedby"]}
                invalid={p.invalid}
                options={reserveOptions}
                value={reserveSpare}
                valueOption={reservePick}
                onChange={(v, o) => { setReserveSpare(v); setReservePick(o ?? null); }}
                onQuery={reserveSpares.setQ}
                serverFiltered
                busy={reserveSpares.busy}
                maxLength={SPARE_QUERY_MAX}
                emptyText={comboEmpty(reserveSpares.pending)}
                placeholder="Type a tag…"
                autoFocus
              />
            )}
          </FormField>
          {reserveSpares.pending.status === "error" && <SpareLoadRow load={reserveSpares.pending} onRetry={reserveSpares.retry} />}
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
              <>Creates a Return request — the item stays on
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
        <div ref={replaceBodyRef} className="flex flex-col gap-3">
          {/* Plan P-9: a searchable picker, and what it CANNOT offer is said in
              one muted line rather than shown as unpickable rows. "There is
              nothing to buy" and "everything there is is promised" are
              different problems and must not share a sentence.
              Phase 39: both lines and the hint read the pool-wide counts; the
              picker is there (its list "Loading spares…") until they arrive. */}
          {replaceState?.kind === "empty" ? (
            <p className="text-xs text-fg-muted">
              No spares in stock —{" "}
              <Link href="/inventory/register" className="text-accent underline hover:text-accent-hover">register one</Link> or{" "}
              <Link href="/purchases/new" className="text-accent underline hover:text-accent-hover">route a purchase</Link>.
            </p>
          ) : replaceState?.kind === "allHeld" ? (
            <p className="text-xs text-fg-muted">
              {replaceState.count === 1
                ? "The only spare is held or queued for someone else"
                : `All ${replaceState.count} spares are held or queued for someone else`}
            </p>
          ) : (
            <>
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
                    valueOption={replacementPick}
                    onChange={(v, o) => { setReplacementId(v); setReplacementPick(o ?? null); }}
                    onQuery={replaceSpares.setQ}
                    serverFiltered
                    busy={replaceSpares.busy}
                    maxLength={SPARE_QUERY_MAX}
                    emptyText={comboEmpty(replaceSpares.pending)}
                    placeholder="Type a tag…"
                    autoFocus
                  />
                )}
              </FormField>
              {replaceSpares.pending.status === "error" && <SpareLoadRow load={replaceSpares.pending} onRetry={replaceSpares.retry} />}
            </>
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
        slot={{ id: waivingSlot?.slotId ?? "", name: waivingSlot?.label ?? "" }}
        open={waivingSlot !== null}
        onClose={() => setWaivingSlot(null)}
      />

      <AddSlotDialog
        employeeId={employeeId}
        employeeName={employeeName}
        itCategories={itCategories}
        currentLabels={currentSlotLabels}
        open={addingSlot}
        onClose={() => setAddingSlot(false)}
      />
      </CardBody>
    </Card>
  );
}
