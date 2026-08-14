"use client";

import { forwardRef, useEffect, useRef } from "react";
import { cn } from "@/lib/cn";

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  indeterminate?: boolean;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { indeterminate, className, ...rest },
  ref,
) {
  const inner = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (inner.current) inner.current.indeterminate = !!indeterminate;
  }, [indeterminate]);
  return (
    <input
      type="checkbox"
      ref={(node) => {
        inner.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      }}
      className={cn(
        "size-4 appearance-none rounded-[4px] border border-border-strong bg-surface align-middle",
        "transition-[background,border-color] duration-(--dur-1)",
        "checked:border-accent checked:bg-accent indeterminate:border-accent indeterminate:bg-accent",
        "checked:bg-[url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='8' fill='none' stroke='white' stroke-width='1.8'%3E%3Cpath d='M1 4l2.7 2.7L9 1'/%3E%3C/svg%3E\")] checked:bg-center checked:bg-no-repeat",
        "indeterminate:bg-[url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='2' fill='white'%3E%3Crect width='8' height='2'/%3E%3C/svg%3E\")] indeterminate:bg-center indeterminate:bg-no-repeat",
        className,
      )}
      {...rest}
    />
  );
});
