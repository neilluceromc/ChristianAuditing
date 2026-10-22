import { forwardRef, useId, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Icon, type IconName } from "@/components/ui/icon";
import { FormError } from "@/components/ui/form-field";

/**
 * The PO form's building blocks (A3): a section card with its icon badge, a labelled field (required star or
 * "· optional", hint, error, the sent-back "Flagged" ring), an input with a fixed prefix (PO, №, ₱), and the
 * small mono eyebrow labels. App tokens only — the mockup's hex values map onto them.
 */

/** A flagged field (sent back): a fault-coloured ring, and the words "Flagged" so it isn't colour alone. */
export const RING = "ring-2 ring-[color:var(--st-fault-dot)]";
export const FLAGGED_HINT = "Flagged — check this one";

export function Eyebrow({ children, className, id }: { children: ReactNode; className?: string; id?: string }) {
  return (
    <span id={id} className={cn("font-mono text-[10.5px] uppercase tracking-[0.08em] text-fg-muted", className)}>{children}</span>
  );
}

export function SectionCard({
  id, icon, title, sub, aside, className, children,
}: {
  id: string;
  icon: IconName;
  title: string;
  sub: string;
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-h`}
      className={cn("scroll-mt-5 rounded-(--radius-card) border border-border bg-surface shadow-card", className)}
    >
      <header className="flex flex-wrap items-center gap-3 border-b border-border-faint px-4 py-3.5 sm:px-5">
        <span aria-hidden="true" className="inline-flex size-8 shrink-0 items-center justify-center rounded-(--radius-btn) bg-accent-soft text-accent-soft-text">
          <Icon name={icon} size={17} />
        </span>
        <div className="min-w-0 flex-1 basis-[180px]">
          <h2 id={`${id}-h`} className="text-[15px] font-semibold leading-tight text-fg">{title}</h2>
          <p className="mt-0.5 text-xs text-fg-muted">{sub}</p>
        </div>
        {aside}
      </header>
      {children}
    </section>
  );
}

export function Field({
  label, required, optional, hint, error, flagged, mark, className, children,
}: {
  label: string;
  required?: boolean;
  optional?: boolean;
  hint?: string;
  error?: string;
  /** Sent back with this field ticked: the hint says so (the control carries RING). */
  flagged?: boolean;
  /** The field's `data-po-field` mark: a failed save focuses the first field with an error (firstErrorTarget). */
  mark?: string;
  className?: string;
  children: (props: { id: string; "aria-describedby"?: string; invalid: boolean }) => ReactNode;
}) {
  const id = useId();
  const shownHint = flagged ? (hint ? `${FLAGGED_HINT}. ${hint}` : FLAGGED_HINT) : hint;
  const hintId = shownHint && !error ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div data-po-field={mark} className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-[13px] font-medium text-fg">
        {label}
        {required && <span aria-hidden style={{ color: "var(--required-mark)" }}> *</span>}
        {optional && <span className="font-normal text-fg-faint"> · optional</span>}
      </label>
      {children({ id, "aria-describedby": describedBy, invalid: !!error })}
      {shownHint && !error && <p id={hintId} className="text-[11.5px] text-fg-muted">{shownHint}</p>}
      <FormError id={errorId}>{error}</FormError>
    </div>
  );
}

export interface AffixInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  prefix: string;
  invalid?: boolean;
  /** Amber: a figure that doesn't add up (it never blocks the save). */
  warn?: boolean;
  /** Classes for the box (a flagged ring, a height). */
  boxClassName?: string;
}

/** An input with a fixed, decorative prefix inside its box: "PO", "№", "₱". */
export const AffixInput = forwardRef<HTMLInputElement, AffixInputProps>(function AffixInput(
  { prefix, invalid, warn, boxClassName, className, ...rest },
  ref,
) {
  return (
    <span
      className={cn(
        "flex min-w-0 items-center gap-1.5 rounded-(--radius-card) border bg-surface pl-3",
        "transition-[border-color,box-shadow] duration-(--dur-1)",
        invalid
          ? "border-[var(--error-border)] focus-within:shadow-[0_0_0_3px_var(--error-shadow)]"
          : warn
            ? "border-[var(--st-attention-dot)] focus-within:shadow-[0_0_0_3px_var(--focus-shadow)]"
            : "border-border-strong focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--focus-shadow)]",
        boxClassName,
      )}
    >
      <span aria-hidden="true" className="shrink-0 font-mono text-[12.5px] text-fg-faint">{prefix}</span>
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        enterKeyHint="next"
        className={cn("w-full min-w-0 bg-transparent py-2 pr-3 text-[13px] text-fg placeholder:text-fg-faint focus:outline-none", className)}
        {...rest}
      />
    </span>
  );
});

const TINTS = ["inflight", "settled", "attention", "neutral"] as const;

/** A name's badge colours: one of the status families, the same for the same name every time. */
export function tintFor(name: string): React.CSSProperties {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const t = TINTS[h % TINTS.length];
  return { background: `var(--st-${t}-bg)`, color: `var(--st-${t}-text)` };
}

/** A decorative initials badge (hidden from screen readers: the name is said next to it). */
export function Badge({ text, style, className }: { text: string; style?: React.CSSProperties; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-flex size-6 shrink-0 items-center justify-center rounded-[6px] text-[10px] font-semibold", className)}
      style={style}
    >
      {text}
    </span>
  );
}
