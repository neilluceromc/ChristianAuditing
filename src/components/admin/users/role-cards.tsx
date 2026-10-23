"use client";

import type { Role } from "@prisma/client";
import { cn } from "@/lib/cn";
import { Radio } from "@/components/ui/radio";
import { ROLE_CARD_OPENS, ROLE_LABELS, ROLE_OPTIONS } from "@/lib/admin-users";

/**
 * Users & access (spec §4.4): the five roles as radio cards, each saying what it opens. The panel's Access section,
 * Approve sign-up and Add user all pick a role with these.
 */
export function RoleCards({
  name,
  legend,
  legendClassName,
  value,
  onChange,
  disabled,
  children,
}: {
  /** the radio group's name, unique on the page */
  name: string;
  legend: string;
  legendClassName?: string;
  value: Role;
  onChange: (role: Role) => void;
  disabled?: boolean;
  /** under the cards: the role-change note */
  children?: React.ReactNode;
}) {
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
      <legend className={cn("mb-2", legendClassName ?? "text-xs font-medium text-fg")}>{legend}</legend>
      {ROLE_OPTIONS.map((role) => {
        const on = role === value;
        return (
          <label
            key={role}
            className={cn(
              "flex items-start gap-2.5 rounded-(--radius-card) border px-3 py-2.5",
              disabled ? "cursor-default opacity-70" : "cursor-pointer",
              on ? "border-accent bg-accent-tint" : "border-border bg-surface hover:bg-surface-subtle",
            )}
          >
            <Radio
              name={name}
              value={role}
              checked={on}
              disabled={disabled}
              onChange={() => onChange(role)}
              className="mt-0.5 shrink-0"
            />
            <span className="flex min-w-0 flex-col gap-px">
              <span className="text-[13.5px] font-semibold text-fg">{ROLE_LABELS[role]}</span>
              <span className="text-[12px] text-fg-secondary">{ROLE_CARD_OPENS[role]}</span>
            </span>
          </label>
        );
      })}
      {children}
    </fieldset>
  );
}
