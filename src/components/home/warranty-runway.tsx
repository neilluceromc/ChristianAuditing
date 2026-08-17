import Link from "next/link";
import type { WarrantyRow } from "@/server/modules/home/queries";

/** Next 90 days. A clustered pair is the point: one is a diary note, two is a PO. */
export function WarrantyRunway({ rows }: { rows: WarrantyRow[] }) {
  if (rows.length === 0) {
    return <p className="text-xs text-fg-muted">Nothing comes off warranty in the next 90 days.</p>;
  }
  return (
    <ul className="flex flex-col gap-1.5">
      {rows.map((r) => (
        <li key={r.id} className="flex items-baseline gap-2">
          <Link href={`/inventory/${r.id}`} className="font-mono text-[11px] text-accent hover:underline">
            {r.tag}
          </Link>
          <span className="min-w-0 flex-1 truncate text-[12px] text-fg-secondary">{r.model}</span>
          {r.clustered && (
            <span className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-[color:var(--st-attention-text)]">
              same week
            </span>
          )}
          <span className="font-mono text-[10.5px] text-fg-muted">
            {r.days < 0 ? `expired ${-r.days} d ago` : `${r.days} d`}
          </span>
        </li>
      ))}
    </ul>
  );
}
