export function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.09em] text-fg-muted">
        {label}
      </span>
      <span className="font-mono text-lg font-semibold leading-tight text-fg">{value}</span>
      {hint && <span className="text-[10.5px] text-fg-muted">{hint}</span>}
    </div>
  );
}
