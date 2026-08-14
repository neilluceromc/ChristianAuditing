import Link from "next/link";
import { Fragment } from "react";

export function Breadcrumb({
  items,
}: {
  items: Array<{ label: string; href?: string }>;
}) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex items-center gap-2 text-xs">
        {items.map((item, i) => (
          <Fragment key={`${item.label}-${i}`}>
            {i > 0 && (
              <li aria-hidden className="text-border-strong select-none">/</li>
            )}
            <li>
              {item.href ? (
                <Link href={item.href} className="text-fg-muted hover:text-accent">
                  {item.label}
                </Link>
              ) : (
                <span aria-current="page" className="font-medium text-fg">{item.label}</span>
              )}
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  );
}
