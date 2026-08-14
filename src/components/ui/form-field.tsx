import { useId } from "react";
import { cn } from "@/lib/cn";

export function FormError({ children, id }: { children: React.ReactNode; id?: string }) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="text-[11px] font-medium" style={{ color: "var(--error-text)" }}>
      {children}
    </p>
  );
}

export function FormField({
  label,
  required,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: (props: { id: string; "aria-describedby"?: string; invalid: boolean }) => React.ReactNode;
  className?: string;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-xs font-medium text-fg">
        {label}
        {required && (
          <span aria-hidden style={{ color: "var(--required-mark)" }}> *</span>
        )}
      </label>
      {children({ id, "aria-describedby": describedBy, invalid: !!error })}
      {hint && !error && (
        <p id={hintId} className="text-[11px] text-fg-muted">{hint}</p>
      )}
      <FormError id={errorId}>{error}</FormError>
    </div>
  );
}
