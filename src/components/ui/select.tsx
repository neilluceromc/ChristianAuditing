import { forwardRef } from "react";
import { cn } from "@/lib/cn";
import { fieldClasses } from "./input";

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { invalid, className, children, ...rest },
  ref,
) {
  // chevron comes from .select-chevron in globals.css (theme-aware, per token discipline)
  return (
    <select
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(fieldClasses(invalid), "select-chevron rounded-(--radius-btn) appearance-none pr-8", className)}
      {...rest}
    >
      {children}
    </select>
  );
});
