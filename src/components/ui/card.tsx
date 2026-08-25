import { cn } from "@/lib/cn";

export function Card({
  className,
  style,
  children,
}: {
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn("rounded-(--radius-card) border border-border bg-surface shadow-card", className)}
      style={style}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  actions,
  className,
}: {
  title: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-3 border-b border-border-faint px-4 py-3", className)}>
      <h2 className="text-[15px] font-semibold leading-tight text-fg">{title}</h2>
      {actions}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("px-4 py-3", className)}>{children}</div>;
}
