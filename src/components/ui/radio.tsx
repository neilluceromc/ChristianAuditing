import { forwardRef } from "react";
import { cn } from "@/lib/cn";

export const Radio = forwardRef<HTMLInputElement, Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">>(
  function Radio({ className, ...rest }, ref) {
    return (
      <input
        type="radio"
        ref={ref}
        className={cn(
          "size-4 appearance-none rounded-full border border-border-strong bg-surface align-middle",
          "transition-[border-color,box-shadow] duration-(--dur-1)",
          "checked:border-[5px] checked:border-accent",
          className,
        )}
        {...rest}
      />
    );
  },
);
