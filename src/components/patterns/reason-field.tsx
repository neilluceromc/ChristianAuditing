"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/textarea";

/** Spec §6.1: a reason textarea with quick-pick chips. A chip only fills the box (decision 8); validation is the caller's. */
export function ReasonField({
  label = "Reason", required, hint, error, value, onChange, chips, rows = 3, disabled, className,
}: {
  label?: string; required?: boolean; hint?: string; error?: string;
  value: string; onChange: (value: string) => void;
  chips: readonly string[]; rows?: number; disabled?: boolean; className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  return (
    <FormField label={label} required={required} hint={hint} error={error} className={className}>
      {(p) => (
        <div className="flex flex-col gap-1.5">
          {chips.length > 0 && (
            <div role="group" aria-label={`Quick ${label.toLowerCase()}s`} className="flex flex-wrap gap-1.5">
              {chips.map((chip) => (
                <Button
                  key={chip} type="button" size="sm" variant={value === chip ? "secondary" : "ghost"}
                  aria-label={`Use reason: ${chip}`} aria-pressed={value === chip} disabled={disabled}
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
