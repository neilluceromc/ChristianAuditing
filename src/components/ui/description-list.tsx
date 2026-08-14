export function DescriptionList({
  items,
}: {
  items: Array<{ label: string; value: React.ReactNode; mono?: boolean }>;
}) {
  return (
    <dl className="flex flex-col gap-2">
      {items.map(({ label, value, mono }) => (
        <div key={label} className="flex items-baseline gap-3">
          <dt className="w-[100px] shrink-0 text-[11px] text-fg-muted">{label}</dt>
          <dd className={mono ? "font-mono text-xs text-fg-secondary" : "text-[13px] text-fg-secondary"}>
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
