import { cn } from "@/lib/cn";
import type { StatusFamily } from "@/lib/status";

export function Banner({
  tone = "neutral",
  title,
  children,
  actions,
  className,
}: {
  tone?: StatusFamily;
  title?: React.ReactNode;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === "fault" || tone === "attention" ? "alert" : "status"}
      className={cn("rounded-(--radius-card) border px-4 py-3", className)}
      style={{
        background: `var(--st-${tone}-bg)`,
        borderColor: `var(--st-${tone}-border)`,
        borderLeft: `3px solid var(--st-${tone === "closed" ? "neutral" : tone}-dot)`,
      }}
    >
      {title && (
        <p className="text-[13px] font-semibold" style={{ color: `var(--st-${tone}-text)` }}>{title}</p>
      )}
      {children && <div className="mt-0.5 text-xs text-fg-secondary">{children}</div>}
      {actions && <div className="mt-2 flex gap-2">{actions}</div>}
    </div>
  );
}
