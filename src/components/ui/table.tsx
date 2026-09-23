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
  "aria-label": ariaLabel,
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
  /**
   * A column whose header renders nothing visible (a status dot, a row-action
   * cell) still owes screen readers a name. Declared explicitly because this
   * component does not spread rest props — an undeclared aria-label passes the
   * compiler (every prop here is optional, so the excess-property check is
   * relaxed) and is then silently dropped.
   */
  "aria-label"?: string;
}) {
  const content = (
    <span className="inline-flex items-center gap-1">
      {/* A column whose header renders no visible text still owes screen
          readers a name — aria-label alone puts the name on the <th>, but
          axe's empty-table-header rule wants discernible TEXT content too. */}
      {!children && ariaLabel && <span className="sr-only">{ariaLabel}</span>}
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
      aria-label={ariaLabel}
      style={{ width }}
      aria-sort={sort ? (sort === "asc" ? "ascending" : "descending") : undefined}
      className={cn(
        "border-b border-border font-mono text-[10px] font-medium uppercase tracking-[0.06em] text-fg-muted",
        // Phase 30 (spec §6.3, Fitts): a sortable header's button fills the cell, so the cell's
        // padding lives on the button and the whole cell is the target.
        onSort ? "p-0" : "px-3 py-2",
        align === "right" ? "text-right" : "text-left",
        className,
      )}
    >
      {onSort ? (
        <button
          type="button"
          onClick={onSort}
          className={cn(
            "w-full px-3 py-2 uppercase hover:text-fg-secondary",
            align === "right" ? "text-right" : "text-left",
          )}
        >
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

/**
 * Phase 27 (spec §5.4): a whole-row link — focusable, opens on click (not on a text selection) and on
 * Enter pressed on the row itself, never on a link or button inside it. Written once here; the
 * inventory, employees and holds tables spread it onto their <Tr>.
 */
export function rowOpenProps(open: () => void): Pick<React.HTMLAttributes<HTMLTableRowElement>, "tabIndex" | "onClick" | "onKeyDown"> {
  return {
    tabIndex: 0,
    onClick: () => { if (window.getSelection()?.toString()) return; open(); },
    onKeyDown: (e) => { if (e.key === "Enter" && e.target === e.currentTarget) { e.preventDefault(); open(); } },
  };
}
