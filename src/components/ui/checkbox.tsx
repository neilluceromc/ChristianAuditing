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
        // tick/dash glyphs come from .checkbox-glyphs in globals.css — see the
        // comment there for why they can't be Tailwind arbitrary url() classes
        "checkbox-glyphs size-4 appearance-none rounded-[4px] border border-border-strong bg-surface align-middle",
        "transition-[background,border-color] duration-(--dur-1)",
        className,
      )}
      {...rest}
    />
  );
});
