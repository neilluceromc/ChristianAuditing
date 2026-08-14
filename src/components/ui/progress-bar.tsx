export function ProgressBar({
  value,
  max = 100,
  label,
}: {
  value: number;
  max?: number;
  label?: string;
}) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
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
