import { Breadcrumb } from "./breadcrumb";
import { BackLink } from "./back-link";

export function PageHeader({
  title,
  breadcrumb,
  badge,
  actions,
}: {
  /** Omitted when the page draws its own h1 (the employee profile's identity band). */
  title?: string;
  breadcrumb?: Array<{ label: string; href?: string }>;
  /** e.g. the READ-ONLY · VIEWER pill */
  badge?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  // Phase 28: the nearest linked crumb is the parent — Back's fallback when this tab has no in-app history.
  const parent = breadcrumb ? [...breadcrumb].reverse().find((c) => c.href) : undefined;
  return (
    <header className="flex flex-wrap items-end justify-between gap-3 pb-4">
      <div className="flex flex-col gap-1.5">
        {breadcrumb && (
          <div className="flex items-center gap-3">
            {parent?.href && <BackLink fallbackHref={parent.href} />}
            <Breadcrumb items={breadcrumb} />
          </div>
        )}
        {(title || badge) && (
          <div className="flex items-center gap-2.5">
            {title && (
              <h1 className="text-xl font-semibold leading-tight tracking-[-0.015em] text-fg">
                {title}
              </h1>
            )}
            {badge}
          </div>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}
