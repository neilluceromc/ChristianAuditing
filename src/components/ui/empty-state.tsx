export function EmptyState({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <p className="text-[13px] font-medium text-fg">{title}</p>
      {description && <p className="max-w-[360px] text-xs text-fg-muted">{description}</p>}
      {actions && <div className="mt-2 flex gap-2">{actions}</div>}
    </div>
  );
}
