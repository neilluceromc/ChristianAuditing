export function ProgressBar({
  value,
  max = 100,
  label,
}: {
  value: number;
  max?: number;
  label?: string;
}) {
  // Task 11 round two, V-5: `max <= 0` used to fall through to `(value/max)*100`
  // → `NaN` → `width: "NaN%"`, which every browser discards, leaving the
  // accent div at its default full width — the most confident-looking
  // element on a page reporting zero of zero. Guarded here rather than only
  // at each call site, since any future caller can hand this a `max` of 0.
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={label}
      className="h-[6px] w-full overflow-hidden rounded-full bg-border-faint"
    >
      <div
        className="h-full rounded-full bg-accent origin-left"
        style={{ width: `${pct}%`, animation: "grow var(--dur-3) var(--ease-std)" }}
      />
    </div>
  );
}
