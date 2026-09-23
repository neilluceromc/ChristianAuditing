import Link from "next/link";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost";
type Size = "sm" | "md";

const VARIANT: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg border border-accent hover:bg-accent-hover hover:border-accent-hover",
  secondary: "bg-surface text-fg-secondary border border-border-strong hover:bg-surface-subtle",
  ghost: "bg-transparent text-fg-secondary border border-transparent hover:bg-surface-subtle",
};

const SIZE: Record<Size, string> = {
  sm: "px-2.5 py-1.5 text-[11.5px]",
  md: "px-3.5 py-[9px] text-[13px]",
};

export function ButtonLink({
  href, variant = "secondary", size = "md", prefetch, native = false, className, children,
}: {
  href: string;
  variant?: Variant;
  size?: Size;
  prefetch?: boolean;
  /**
   * A plain `<a>` instead of Next's `Link` — for a route handler that streams a file (an export),
   * which a client-side navigation or a prefetch would fetch for nothing.
   */
  native?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const classes = cn(
    "inline-flex items-center justify-center gap-1.5 rounded-(--radius-btn) font-medium",
    "[transition:background_var(--dur-1)_linear,border-color_var(--dur-1)_linear,scale_var(--dur-press)_linear] active:scale-[.965]",
    VARIANT[variant], SIZE[size], className,
  );
  if (native) {
    return <a href={href} className={classes}>{children}</a>;
  }
  return (
    <Link href={href} prefetch={prefetch} className={classes}>
      {children}
    </Link>
  );
}
