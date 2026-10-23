"use client";

import { useId, useState } from "react";
import { cn } from "@/lib/cn";
import { Input } from "@/components/ui/input";
import { FormError } from "@/components/ui/form-field";
import { PASSWORD_RULE_LABELS, passwordChecks, type PasswordChecks } from "@/lib/password-rules";

/**
 * Users & access (spec §4.3, §4.5; boards PhoneFirst2, Account2): the password inputs with Show/Hide and the live
 * checklist, shared by the first-sign-in form, Account settings and (Task 4) Add user's one-time display.
 */

export function PasswordInput({
  label,
  name,
  value,
  onChange,
  autoComplete,
  error,
  defaultShown = false,
  autoFocus,
  readOnly,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password" | "off";
  error?: string;
  /** Start revealed (a test, or a display of a password the admin must read out). */
  defaultShown?: boolean;
  autoFocus?: boolean;
  readOnly?: boolean;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  const [shown, setShown] = useState(defaultShown);
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-medium text-fg">
        {label}
      </label>
      <div className="relative">
        <Input
          id={id}
          name={name}
          type={shown ? "text" : "password"}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="next"
          value={value}
          readOnly={readOnly}
          autoFocus={autoFocus}
          onChange={(e) => onChange(e.target.value)}
          invalid={!!error}
          aria-describedby={error ? errorId : undefined}
          className="pr-[68px]"
        />
        <button
          type="button"
          aria-pressed={shown}
          aria-controls={id}
          aria-label={`${shown ? "Hide" : "Show"} ${label.toLowerCase()}`}
          onClick={() => setShown((s) => !s)}
          className="absolute inset-y-0 right-1 my-1 rounded-(--radius-btn) px-2.5 text-[11.5px] font-medium text-fg-secondary hover:bg-surface-subtle"
        >
          {shown ? "Hide" : "Show"}
        </button>
      </div>
      <FormError id={errorId}>{error}</FormError>
    </div>
  );
}

/** One rule's state: met, not met, or (the temporary password, which the browser never sees) checked on save. */
type RuleState = "true" | "false" | "unknown";

function Rule({ state, children }: { state: RuleState; children: string }) {
  const met = state === "true";
  return (
    <li data-met={state} className={cn("flex items-center gap-2 text-xs", met ? "text-[var(--st-settled-text)]" : "text-fg-muted")}>
      <span aria-hidden="true" className="w-3 text-center font-semibold">
        {state === "unknown" ? "•" : met ? "✓" : "○"}
      </span>
      <span className="sr-only">{state === "unknown" ? "Checked when you save: " : met ? "Met: " : "Not met: "}</span>
      {children}
      {state === "unknown" && <span aria-hidden="true" className="text-fg-faint">· Checked when you save</span>}
    </li>
  );
}

export function PasswordChecklist({
  checks,
  freshLabel,
  freshUnknown = false,
}: {
  checks: PasswordChecks;
  freshLabel: string;
  /** The fresh rule can't be checked in the browser (first sign-in: the temporary password is never sent to it). */
  freshUnknown?: boolean;
}) {
  return (
    <ul aria-label="Password rules" className="flex flex-col gap-1">
      <Rule state={String(checks.long) as RuleState}>{PASSWORD_RULE_LABELS.long}</Rule>
      <Rule state={String(checks.mixed) as RuleState}>{PASSWORD_RULE_LABELS.mixed}</Rule>
      <Rule state={freshUnknown ? "unknown" : (String(checks.fresh) as RuleState)}>{freshLabel}</Rule>
    </ul>
  );
}

export type PasswordField = "current" | "password" | "confirm";
export type PasswordValues = Record<PasswordField, string>;

/**
 * The full set: (Account settings) Current password, then New password and "Type it again", each with Show/Hide,
 * and the checklist ticking as the person types. The server checks the same rules again.
 */
export function PasswordFields({
  mode,
  values,
  onChange,
  errors,
}: {
  /** "first": first sign-in (no current password); "change": Account settings */
  mode: "first" | "change";
  values: PasswordValues;
  onChange: (field: PasswordField, value: string) => void;
  errors: Partial<Record<PasswordField, string>>;
}) {
  const checks = passwordChecks(values.password, mode === "change" ? { current: values.current } : {});
  return (
    <div className="flex flex-col gap-3.5">
      {mode === "change" && (
        <PasswordInput
          label="Current password"
          name="current"
          autoComplete="current-password"
          value={values.current}
          onChange={(v) => onChange("current", v)}
          error={errors.current}
          autoFocus
        />
      )}
      <PasswordInput
        label="New password"
        name="password"
        autoComplete="new-password"
        value={values.password}
        onChange={(v) => onChange("password", v)}
        error={errors.password}
        autoFocus={mode === "first"}
      />
      <PasswordInput
        label="Type it again"
        name="confirm"
        autoComplete="new-password"
        value={values.confirm}
        onChange={(v) => onChange("confirm", v)}
        error={errors.confirm}
      />
      <PasswordChecklist
        checks={checks}
        freshLabel={mode === "change" ? "Not your current password" : "Not the temporary password"}
        freshUnknown={mode === "first"}
      />
    </div>
  );
}
