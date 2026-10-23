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
  href, variant = "secondary", size = "md", prefetch, native = false, newTab = false, download, className, onClick, children,
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
  /** Native only: opens in a new tab (`target="_blank"`, no opener or referrer). */
  newTab?: boolean;
  /** Native only: the `download` attribute, the name a saved file gets (a held file's object URL has no name of its own). */
  download?: string;
  className?: string;
  /** Runs before the navigation; `preventDefault()` cancels it (the stocktake count waits for its row saves first). */
  onClick?: React.MouseEventHandler<HTMLAnchorElement>;
  children: React.ReactNode;
}) {
  const classes = cn(
    "inline-flex items-center justify-center gap-1.5 rounded-(--radius-btn) font-medium",
    "[transition:background_var(--dur-1)_linear,border-color_var(--dur-1)_linear,scale_var(--dur-press)_linear] active:scale-[.965]",
    VARIANT[variant], SIZE[size], className,
  );
  if (native) {
    return (
      <a
        href={href} className={classes} onClick={onClick} download={download}
        target={newTab ? "_blank" : undefined} rel={newTab ? "noopener noreferrer" : undefined}
      >
        {children}
      </a>
    );
  }
  return (
    <Link href={href} prefetch={prefetch} className={classes} onClick={onClick}>
      {children}
    </Link>
  );
}
