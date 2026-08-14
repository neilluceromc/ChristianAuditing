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

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid, className, ...rest },
  ref,
) {
  return <input ref={ref} aria-invalid={invalid || undefined} className={cn(fieldClasses(invalid), className)} {...rest} />;
});
