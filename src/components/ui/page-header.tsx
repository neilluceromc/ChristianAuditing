import { Breadcrumb } from "./breadcrumb";

export function PageHeader({
  title,
  breadcrumb,
  badge,
  actions,
}: {
  title: string;
  breadcrumb?: Array<{ label: string; href?: string }>;
  /** e.g. the READ-ONLY · VIEWER pill */
  badge?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3 pb-4">
      <div className="flex flex-col gap-1.5">
        {breadcrumb && <Breadcrumb items={breadcrumb} />}
        <div className="flex items-center gap-2.5">
          <h1 className="text-xl font-semibold leading-tight tracking-[-0.015em] text-fg">
            {title}
          </h1>
          {badge}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}
