"use client";

import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-field";
import { Icon, type IconName } from "@/components/ui/icon";

export type SlotKind = "invoice" | "official-receipt" | "warranty-slip" | "delivery-receipt";

export interface SlotFiles {
  invoice: File | null;
  "official-receipt": File | null;
  "warranty-slip": File | null;
  "delivery-receipt": File | null;
  other: File[];
}

export const EMPTY_SLOTS: SlotFiles = {
  invoice: null, "official-receipt": null, "warranty-slip": null, "delivery-receipt": null, other: [],
};

export const SLOTS: ReadonlyArray<{ kind: SlotKind; title: string; hint: string; icon: IconName }> = [
  { kind: "invoice", title: "Sales invoice", hint: "Not uploaded yet", icon: "audit" },
  { kind: "official-receipt", title: "Official receipt", hint: "Not uploaded yet", icon: "audit" },
  { kind: "warranty-slip", title: "Warranty slip", hint: "A photo of the warranty card is fine", icon: "approval" },
  { kind: "delivery-receipt", title: "Delivery receipt", hint: "The signed delivery receipt", icon: "inventory" },
];

/** Every chosen file with the kind it is stored as: the four slots in order, then the extras as `other`. */
export function slotUploads(slots: SlotFiles): Array<{ kind: SlotKind | "other"; file: File }> {
  const out: Array<{ kind: SlotKind | "other"; file: File }> = [];
  for (const s of SLOTS) {
    const file = slots[s.kind];
    if (file) out.push({ kind: s.kind, file });
  }
  for (const file of slots.other) out.push({ kind: "other", file });
  return out;
}

export const slotCount = (slots: SlotFiles) => slotUploads(slots).length;

// The same limits `src/server/uploads.ts` enforces (it imports node:fs, so it cannot be imported here).
const ACCEPT = "application/pdf,image/png,image/jpeg";
const MAX_BYTES = 4 * 1024 * 1024;
const TYPES: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" };
export const SLOT_REFUSAL = "PDF, PNG or JPG up to 4 MB";

function allowed(file: File): boolean {
  if (file.size === 0 || file.size > MAX_BYTES) return false;
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  const type = TYPES[ext];
  return !!type && (!file.type || file.type === type);
}

/**
 * Phase 34 (spec §4.5): the Documents box — one slot per paper a delivery
 * comes with, plus extras. Nothing uploads here: the form uploads them once
 * the assets exist. A batch saves each file on every unit.
 */
export function DocumentSlots({
  slots,
  onSlots,
  single,
  disabled,
}: {
  slots: SlotFiles;
  onSlots: (next: SlotFiles) => void;
  single: boolean;
  disabled?: boolean;
}) {
  const base = useId();
  const [refused, setRefused] = useState<string | null>(null);
  // A reset to EMPTY_SLOTS ("Register and add another") drops a stale refusal.
  // Adjusted during render (React's prop-change pattern), not in an effect.
  const [seen, setSeen] = useState(slots);
  if (seen !== slots) {
    setSeen(slots);
    if (slots === EMPTY_SLOTS) setRefused(null);
  }
  const inputs = useRef<Partial<Record<SlotKind | "other", HTMLInputElement | null>>>({});

  function take(list: FileList | null, apply: (files: File[]) => void) {
    const files = Array.from(list ?? []);
    if (files.length === 0) return;
    if (files.some((f) => !allowed(f))) {
      setRefused(SLOT_REFUSAL);
      return;
    }
    setRefused(null);
    apply(files);
  }

  const errorId = `${base}-refused`;
  const row = "flex items-center gap-3 border-b border-border py-2 last:border-b-0";

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col">
        {SLOTS.map((s) => {
          const file = slots[s.kind];
          const titleId = `${base}-${s.kind}`;
          const fileId = `${titleId}-file`;
          return (
            <li key={s.kind} className={row}>
              <Icon name={s.icon} size={16} className="text-fg-muted" />
              <div className="flex min-w-0 flex-1 flex-col">
                <span id={titleId} className="text-[12.5px] font-medium text-fg">{s.title}</span>
                {file ? (
                  <span id={fileId} className="truncate text-[11px] font-medium text-[var(--st-settled-text)]">{file.name}</span>
                ) : (
                  <span className="text-[11px] text-fg-muted">{s.hint}</span>
                )}
              </div>
              <input
                ref={(el) => {
                  inputs.current[s.kind] = el;
                }}
                type="file"
                accept={ACCEPT}
                disabled={disabled}
                className="sr-only"
                // The Upload button opens it; a second, invisible tab stop would only lose the focus ring.
                tabIndex={-1}
                aria-label={s.title}
                aria-describedby={refused ? errorId : undefined}
                onChange={(e) => {
                  take(e.target.files, ([f]) => onSlots({ ...slots, [s.kind]: f }));
                  e.target.value = "";
                }}
              />
              {file ? (
                // Named "Remove" and described by the slot title: an aria-label carrying the
                // title would also answer getByLabel(title) (global constraint on field words).
                <Button
                  type="button" variant="ghost" size="sm" disabled={disabled}
                  aria-describedby={`${titleId} ${fileId}`}
                  onClick={() => {
                    setRefused(null);
                    onSlots({ ...slots, [s.kind]: null });
                  }}
                >
                  Remove
                </Button>
              ) : (
                <Button
                  type="button" variant="secondary" size="sm" disabled={disabled}
                  aria-describedby={titleId}
                  onClick={() => inputs.current[s.kind]?.click()}
                >
                  Upload
                </Button>
              )}
            </li>
          );
        })}
        {slots.other.map((file, i) => {
          const nameId = `${base}-other-${i}`;
          return (
            <li key={`${file.name}-${i}`} className={row}>
              <Icon name="other" size={16} className="text-fg-muted" />
              <span id={nameId} className="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--st-settled-text)]">{file.name}</span>
              <Button
                type="button" variant="ghost" size="sm" disabled={disabled}
                aria-describedby={nameId}
                onClick={() => {
                  setRefused(null);
                  onSlots({ ...slots, other: slots.other.filter((_, j) => j !== i) });
                }}
              >
                Remove
              </Button>
            </li>
          );
        })}
      </ul>
      <div>
        <input
          ref={(el) => {
            inputs.current.other = el;
          }}
          type="file"
          accept={ACCEPT}
          multiple
          disabled={disabled}
          className="sr-only"
          tabIndex={-1}
          aria-label="Another file"
          aria-describedby={refused ? errorId : undefined}
          onChange={(e) => {
            take(e.target.files, (fs) => onSlots({ ...slots, other: [...slots.other, ...fs] }));
            e.target.value = "";
          }}
        />
        <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => inputs.current.other?.click()}>
          + Another file
        </Button>
      </div>
      <FormError id={errorId}>{refused}</FormError>
      {!single && <p className="text-[11px] text-fg-muted">Saved on every unit in this batch.</p>}
    </div>
  );
}
