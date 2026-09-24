import Link from "next/link";
import type { ReadinessLine } from "@/lib/offboarding";

/** Spec §4.4: the three server gates, shown before anyone clicks Complete. */
export function ReadinessChecklist({ lines }: { lines: ReadinessLine[] }) {
  return (
    <ul aria-label="Ready to complete" className="flex flex-col gap-1.5">
      {lines.map((l) => (
        <li key={l.kind + l.label} className="flex items-center gap-2 text-[12.5px]">
          <span aria-hidden className={l.ok ? "text-[color:var(--st-settled-dot)]" : "text-[color:var(--st-fault-text)]"}>{l.ok ? "✓" : "✗"}</span>
          <span className="sr-only">{l.ok ? "Done:" : "Blocking:"}</span>
          {l.href ? <Link href={l.href} className="text-accent hover:underline">{l.label}</Link> : <span className="text-fg">{l.label}</span>}
        </li>
      ))}
    </ul>
  );
}
