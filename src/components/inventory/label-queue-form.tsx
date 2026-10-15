import type { AssetClass } from "@prisma/client";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { whenLabel, type QueueGroup } from "@/lib/label-queue";

/**
 * Phase 34 (spec §5, plan P-6): the Waiting to print checklist. A plain GET form back to
 * /inventory/labels, so it renders from the Server Component page with no client JavaScript:
 * each ticked batch travels as `?pick=` and "Make sheet" rebuilds the sheet. `children` is the
 * "Reprint other tags" Tags box, whose fields belong to this form: one "Make sheet" submits the
 * ticks, the tags and the start together, so neither path drops the other. `ids` rides along.
 */
export function LabelQueueForm({
  groups, more, picked, cls, ids, older, olderHref, now, children,
}: {
  groups: QueueGroup[];
  more: boolean;
  picked: ReadonlySet<string>;
  cls: AssetClass;
  ids: string;
  older: boolean;
  olderHref: string;
  now: Date;
  children?: React.ReactNode;
}) {
  return (
    <form method="get" action="/inventory/labels" className="flex flex-col gap-3">
      {cls === "PURCHASING" && <input type="hidden" name="cls" value="PURCHASING" />}
      {ids && <input type="hidden" name="ids" value={ids} />}
      {older && <input type="hidden" name="older" value="1" />}
      <div>
        <h2 className="text-sm font-semibold text-fg">Waiting to print</h2>
        <p className="text-xs text-fg-muted">Tick what goes on this sheet.</p>
      </div>
      {groups.length === 0 ? (
        <p className="rounded-md border border-border px-3 py-2.5 text-[13px] text-fg-secondary">
          Nothing waiting. Everything registered has had its label printed.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {groups.map((g, i) => {
            const value = g.recordId ?? g.key;
            return (
              <li key={g.key}>
                <label className="flex cursor-pointer items-start gap-2.5 px-3 py-2.5 hover:bg-surface-subtle">
                  <input
                    type="checkbox"
                    name="pick"
                    value={value}
                    defaultChecked={picked.has(value)}
                    aria-labelledby={`queue-${i}-title queue-${i}-range`}
                    className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
                  />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span id={`queue-${i}-title`} className="text-[13px] font-semibold text-fg">{g.title}</span>
                    <span id={`queue-${i}-range`} className="truncate font-mono text-[11px] text-fg-secondary">{g.range}</span>
                  </span>
                  <span className="shrink-0 text-[11px] text-fg-muted">{whenLabel(g.createdAt, now)}</span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {more && (
        <Link href={olderHref} className="self-start text-xs text-fg-secondary underline underline-offset-2 hover:text-fg">
          Show older
        </Link>
      )}
      {children}
      <div>
        <Button type="submit">Make sheet</Button>
      </div>
    </form>
  );
}
