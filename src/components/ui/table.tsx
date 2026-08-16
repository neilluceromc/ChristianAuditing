import { cn } from "@/lib/cn";

export function Table({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("overflow-x-auto rounded-(--radius-card) border border-border bg-surface shadow-card", className)}>
      <table className="w-full border-collapse text-[12.5px]">{children}</table>
    </div>
  );
}

export function THead({ children }: { children: React.ReactNode }) {
  return <thead className="sticky top-0 z-10 bg-surface-subtle">{children}</thead>;
}

export function Th({
  className,
  align = "left",
  width,
  children,
  sort,
  sortIndex,
  onSort,
}: {
  className?: string;
  align?: "left" | "right";
  width?: number;
  children?: React.ReactNode;
  /** "asc" | "desc" when this column participates in the sort */
  sort?: "asc" | "desc";
  /** 1-based position in a multi-sort (max 2 keys) — renders the numbered badge */
  sortIndex?: number;
  onSort?: () => void;
}) {
  const content = (
    <span className="inline-flex items-center gap-1">
      {children}
      {sort && (
        <span aria-hidden className="text-accent">{sort === "asc" ? "↑" : "↓"}</span>
      )}
      {sort && sortIndex && (
        <span
          aria-hidden
          className="inline-flex size-3.5 items-center justify-center rounded-full bg-accent-soft font-mono text-[8.5px] text-accent-soft-text"
        >
          {sortIndex}
        </span>
      )}
    </span>
  );
  return (
    <th
      scope="col"
      style={{ width }}
      aria-sort={sort ? (sort === "asc" ? "ascending" : "descending") : undefined}
      className={cn(
        "border-b border-border px-3 py-2 font-mono text-[10px] font-medium uppercase tracking-[0.06em] text-fg-muted",
        align === "right" ? "text-right" : "text-left",
        className,
      )}
    >
      {onSort ? (
        <button type="button" onClick={onSort} className="hover:text-fg-secondary">
          {content}
        </button>
      ) : (
        content
      )}
    </th>
  );
}

export function TBody({ children }: { children: React.ReactNode }) {
  return <tbody>{children}</tbody>;
}

export function Tr({
  selected,
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLTableRowElement> & { selected?: boolean }) {
  return (
    <tr
      aria-selected={selected || undefined}
      className={cn(
        "group border-b border-border-faint transition-colors duration-(--dur-1)",
        selected ? "bg-accent-tint" : "hover:bg-surface-subtle",
        className,
      )}
      style={{ height: "var(--row-h)" }}
      {...rest}
    >
      {children}
    </tr>
  );
}

export function Td({
  className,
  align = "left",
  mono,
  children,
  ...rest
}: React.TdHTMLAttributes<HTMLTableCellElement> & { align?: "left" | "right"; mono?: boolean }) {
  return (
    <td
      className={cn(
        "px-3 py-0 text-fg-secondary",
        mono && "font-mono text-xs text-fg-muted",
        align === "right" ? "text-right" : "text-left",
        className,
      )}
      {...rest}
    >
      {children}
    </td>
  );
}
