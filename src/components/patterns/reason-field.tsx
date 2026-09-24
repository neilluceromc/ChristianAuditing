"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/textarea";

/**
 * Spec §6.1: a reason textarea with quick-pick chips. A chip only fills the box
 * (decision 8); validation is the caller's.
 *
 * Ruling R6 — nothing here may carry an `aria-label` containing a field label
 * word ("Reason", "Purpose"): Playwright's `getByLabel(text)` matches
 * `aria-label` by case-insensitive SUBSTRING, so a group named
 * `Quick reasons` or a chip labelled `…reason: Damaged` would make the 21
 * pre-existing `getByLabel("Reason")` / `("Purpose")` sites in `e2e/` resolve
 * to the textarea plus the group plus every chip. Hence the fixed group name
 * "Quick picks" and chips with NO `aria-label` at all — a button's accessible
 * name is its visible text, which `getByLabel` does not match.
 */
export function ReasonField({
  label = "Reason", required, hint, error, value, onChange, chips, rows = 3, disabled, className, inputRef,
}: {
  label?: string; required?: boolean; hint?: string; error?: string;
  value: string; onChange: (value: string) => void;
  chips: readonly string[]; rows?: number; disabled?: boolean; className?: string;
  /** Lets a caller (item-decision.tsx's client reason check) focus the textarea directly on a validation failure. */
  inputRef?: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const ownRef = useRef<HTMLTextAreaElement>(null);
  const ref = inputRef ?? ownRef;
  return (
    <FormField label={label} required={required} hint={hint} error={error} className={className}>
      {(p) => (
        <div className="flex flex-col gap-1.5">
          {chips.length > 0 && (
            <div role="group" aria-label="Quick picks" className="flex flex-wrap gap-1.5">
              {chips.map((chip) => (
                <Button
                  key={chip} type="button" size="sm" variant={value === chip ? "secondary" : "ghost"}
                  aria-pressed={value === chip} disabled={disabled}
                  onClick={() => { onChange(chip); ref.current?.focus(); }}
                >
                  {chip}
                </Button>
              ))}
            </div>
          )}
          <Textarea
            ref={ref} id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid} rows={rows}
            disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)}
          />
        </div>
      )}
    </FormField>
  );
}
