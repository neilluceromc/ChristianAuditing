"use client";

import { useId } from "react";
import { Select } from "@/components/ui/select";
import { LIST } from "@/components/patterns/list-styles";
import { cn } from "@/lib/cn";

/** A toolbar select with its label beside it (the Finance and Employees toolbars' Sort, Category, Life). */
export function LabelledSelect({
  label, value, onChange, children,
}: {
  label: string; value: string; onChange: (v: string) => void; children: React.ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-1.5 text-[12.5px] text-fg-muted">
      <label htmlFor={id} className="whitespace-nowrap">{label}</label>
      <Select
        // Uncontrolled and keyed on the URL's value: the pick stays shown while its navigation is in flight, and the
        // select takes the URL's value again once the next view lands (or on Back).
        key={value}
        id={id}
        defaultValue={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(LIST.control, "w-auto max-w-[220px] pl-2.5")}
      >
        {children}
      </Select>
    </div>
  );
}
