import { forwardRef } from "react";
import { cn } from "@/lib/cn";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const fieldClasses = (invalid?: boolean) =>
  cn(
    "w-full rounded-(--radius-card) border bg-surface px-3 py-2 text-[13px] text-fg",
    "placeholder:text-fg-faint transition-[border-color,box-shadow] duration-(--dur-1)",
    "focus:outline-none disabled:opacity-55",
    invalid
      ? "border-[var(--error-border)] focus:border-[var(--error-border)] focus:shadow-[0_0_0_3px_var(--error-shadow)]"
      : "border-border-strong focus:border-accent focus:shadow-[0_0_0_3px_var(--focus-shadow)]",
  );

/**
 * Spec §6.1 / §8 (ruling R7): text-ish inputs get `enterKeyHint="next"` so a
 * soft keyboard offers "next" instead of "go". One default here rather than ~20
 * call sites; a caller that wants "done"/"send"/"search" just passes its own.
 * Types with their own keyboard affordance (`date`, `checkbox`, `radio`,
 * `file`, `submit`, …) and `<Textarea>` are left alone. Desktop browsers ignore
 * the attribute entirely — no rendering, a11y-tree or test-surface change.
 */
const HINTED_TYPES = ["text", "search", "email", "tel", "url", "number"];

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid, className, ...rest },
  ref,
) {
  const enterKeyHint =
    rest.enterKeyHint ?? (rest.type === undefined || HINTED_TYPES.includes(rest.type) ? "next" : undefined);
  return (
    <input
      ref={ref} aria-invalid={invalid || undefined} className={cn(fieldClasses(invalid), className)}
      {...rest} enterKeyHint={enterKeyHint}
    />
  );
});
