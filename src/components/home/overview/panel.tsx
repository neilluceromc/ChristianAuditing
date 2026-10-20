import { cn } from "@/lib/cn";

/** One Overview card: a heading with an optional muted sub line and a right-hand action, then the body. */
export function Panel({
  title, sub, action, className, children,
}: {
  title: string;
  sub?: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("min-w-0 rounded-(--radius-card) border border-border bg-surface shadow-card", className)}>
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 px-4 pt-3.5">
        <h2 className="text-[14px] font-semibold leading-tight text-fg">{title}</h2>
        {sub && <span className="text-[12.5px] text-fg-muted">{sub}</span>}
        {action && <span className="ml-auto">{action}</span>}
      </div>
      <div className="px-4 pb-4 pt-3">{children}</div>
    </section>
  );
}
