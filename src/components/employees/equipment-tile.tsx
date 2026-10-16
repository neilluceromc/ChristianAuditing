"use client";

import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { Pill } from "@/components/ui/pill";
import { TagRef } from "@/components/inventory/tag-ref";
import type { ChipTone, TileKind } from "@/lib/loadout";

/** What one tile knows about the asset it shows — serializable, built on the server. */
export interface TileAsset {
  id: string;
  tag: string;
  model: string;
  status: string;
  age: string;
  pendingRef: string | null;
  visible: boolean;
  /** ISO; set for a device on loan with a due date. */
  loanDueAt: string | null;
}

/**
 * Phase 37 (spec §4.3): one tile of the profile's equal grid — a policy slot, an
 * extra item no slot claimed, or a loan no slot claimed. Built from
 * `profileTiles` on the server; `label` is already numbered ("Monitor 2").
 */
export interface EquipmentTileData {
  key: string;
  kind: TileKind;
  label: string;
  /** The slot's id (a policy slot, or `x:<exception id>`); null for extras and loans. */
  slotId: string | null;
  typeId: string | null;
  typeName: string;
  required: boolean;
  /** Phase 16: filled only by a device on loan (TEMPORARY). */
  loaner: boolean;
  exceptionId: string | null;
  exceptionReason: string | null;
  /** Phase 20 (spec §6.3): a standard slot a loan stands in for — `asset` is that loan. */
  coveredByLoan: boolean;
  asset: TileAsset | null;
}

const CHIP_FAMILY: Record<ChipTone, string> = {
  danger: "fault", warning: "attention", success: "settled", neutral: "neutral",
};

export function TileChip({ tone, children }: { tone: ChipTone; children: React.ReactNode }) {
  const f = CHIP_FAMILY[tone];
  return (
    <span
      data-tone={tone}
      className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-tight"
      style={{ background: `var(--st-${f}-bg)`, color: `var(--st-${f}-text)`, borderColor: `var(--st-${f}-border)` }}
    >
      {children}
    </span>
  );
}

/**
 * The tile: a fixed three-band card (label and ⋯ / model and tag / chip) that
 * fills its grid cell, so every tile in a row is the same size.
 *
 * Clicking the body of a tile with an asset opens the side panel. The opener is
 * a real <button> (Enter/Space for free) whose ::after stretches over the whole
 * card; the ⋯ menu, the tag link and the Fill button sit above it (z-10) as
 * siblings, never inside it — a control nested in a button is axe's
 * nested-interactive.
 */
export function EquipmentTile({
  tile, chip, menuItems, canOpen, onOpen, canFill, onFill, reservedTag, onAssignReserved, busy, changed, focusRef,
}: {
  tile: EquipmentTileData;
  chip: { text: string; tone: ChipTone };
  menuItems: MenuItem[];
  canOpen: boolean;
  onOpen: () => void;
  canFill: boolean;
  onFill: () => void;
  /** Ruling R8: the hold this empty slot got, if any. */
  reservedTag: string | null;
  onAssignReserved: (() => void) | null;
  busy: boolean;
  changed: boolean;
  /** The tile's one keyboard stop — the opener when it has an asset, else Fill. */
  focusRef: (el: HTMLButtonElement | null) => void;
}) {
  const a = tile.asset;
  const gap = !a;
  return (
    <div
      role="group"
      aria-label={tile.label}
      data-tile={tile.key}
      data-kind={tile.kind}
      data-pending={busy || undefined}
      aria-busy={busy || undefined}
      data-changed={changed || undefined}
      className={cn(
        "relative flex h-full min-w-0 flex-col gap-2 rounded-(--radius-card) border p-3 transition-colors duration-(--dur-1)",
        gap ? "border-dashed border-border-strong" : "border-border bg-surface shadow-card",
        canOpen && "hover:border-accent",
        busy && "opacity-60",
        changed && "tile-changed",
      )}
    >
      <div className="flex min-h-7 items-start justify-between gap-2">
        <span className="pt-1 font-mono text-[10.5px] uppercase tracking-[0.06em] text-fg-secondary">{tile.label}</span>
        {menuItems.length > 0 && (
          <div className="relative z-10 -mr-1.5 -mt-1.5">
            <Menu
              align="end"
              items={menuItems}
              trigger={(props) => (
                <button
                  type="button"
                  {...props}
                  aria-label={`More for ${tile.label}`}
                  className="grid size-7 place-items-center rounded-[6px] border border-transparent font-mono text-[12px] text-fg-muted hover:bg-surface-subtle hover:text-fg"
                >
                  ⋯
                </button>
              )}
            />
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {a ? (
          <>
            {canOpen ? (
              <button
                ref={focusRef}
                type="button"
                onClick={onOpen}
                aria-label={`${tile.label}: ${a.model} ${a.tag}`}
                className={cn(
                  "w-fit max-w-full truncate text-left text-[13px] font-medium",
                  a.pendingRef ? "text-fg-muted" : "text-fg",
                  "after:absolute after:inset-0 after:rounded-(--radius-card) after:content-['']",
                  "focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-accent",
                )}
              >
                {a.model}
              </button>
            ) : (
              <span className={cn("truncate text-[13px] font-medium", a.pendingRef ? "text-fg-muted" : "text-fg")}>{a.model}</span>
            )}
            <span className="relative z-10 w-fit text-[11.5px]">
              <TagRef id={a.id} tag={a.tag} visible={a.visible} className="font-mono text-accent hover:underline" />
            </span>
            {a.pendingRef && (
              <span className="flex flex-wrap items-center gap-1.5">
                <Pill tone="accent">PENDING</Pill>
                <span className="font-mono text-[10px] text-fg-muted">{a.pendingRef}</span>
              </span>
            )}
          </>
        ) : (
          <span className="text-[13px] text-fg-muted">Nothing assigned</span>
        )}
        {reservedTag && <span className="font-mono text-[10.5px] text-fg-muted">reserved · {reservedTag}</span>}
        {tile.exceptionId && (
          <span className="relative z-10 w-fit">
            <Pill title={tile.exceptionReason ?? undefined}>EXCEPTION</Pill>
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <TileChip tone={chip.tone}>{chip.text}</TileChip>
        <span className="flex flex-wrap items-center gap-1.5">
          {reservedTag && onAssignReserved && (
            <Button size="sm" variant="secondary" className="z-10" loading={busy} onClick={onAssignReserved}>
              Assign reserved
            </Button>
          )}
          {canFill && (
            <Button
              ref={a ? undefined : focusRef}
              size="sm"
              variant={tile.required && !tile.coveredByLoan ? "primary" : "secondary"}
              className="z-10"
              aria-label={`Fill the ${tile.label} slot`}
              onClick={onFill}
            >
              Fill
            </Button>
          )}
        </span>
      </div>
    </div>
  );
}
