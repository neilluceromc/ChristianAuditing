"use client";

import { forwardRef } from "react";
import { cn } from "@/lib/cn";
import { Spinner } from "./spinner";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const VARIANT: Record<Variant, string> = {
  primary:
    "bg-accent text-accent-fg border border-accent hover:bg-accent-hover hover:border-accent-hover",
  secondary:
    "bg-surface text-fg-secondary border border-border-strong hover:bg-surface-subtle",
  ghost: "bg-transparent text-fg-secondary border border-transparent hover:bg-surface-subtle",
  danger:
    "bg-[var(--danger-bg)] text-[var(--danger-fg)] border border-[var(--danger-bg)] hover:opacity-90",
};

const SIZE: Record<Size, string> = {
  sm: "px-2.5 py-1.5 text-[11.5px]",
  md: "px-3.5 py-[9px] text-[13px]",
  lg: "px-[18px] py-[11px] text-[14px]",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading = false, disabled, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "relative inline-flex items-center justify-center gap-1.5 rounded-(--radius-btn) font-medium",
        "[transition:background_var(--dur-1)_linear,border-color_var(--dur-1)_linear,opacity_var(--dur-1)_linear,scale_var(--dur-press)_linear]",
        "active:scale-[.965] disabled:pointer-events-none disabled:opacity-55",
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...rest}
    >
      {/* loading keeps width: content goes invisible, spinner overlays */}
      <span className={cn("inline-flex items-center gap-1.5", loading && "invisible")}>
        {children}
      </span>
      {loading && (
        <span className="absolute inset-0 grid place-items-center">
          <Spinner size={11} />
        </span>
      )}
    </button>
  );
});

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  "aria-label": string; // required: icon-only buttons must be named
  variant?: Variant;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { variant = "ghost", className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex size-[34px] items-center justify-center rounded-(--radius-btn)",
        "[transition:background_var(--dur-1)_linear,border-color_var(--dur-1)_linear,scale_var(--dur-press)_linear] active:scale-[.965]",
        "disabled:pointer-events-none disabled:opacity-55",
        VARIANT[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});
