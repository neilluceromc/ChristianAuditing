import Link from "next/link";
import type { AssetStatus } from "@prisma/client";
import { cn } from "@/lib/cn";
import { fmtMoneyExact } from "@/lib/format";
import { assetPageHref, fmtFileSize, type AssetPageState, type LifeSummary } from "@/lib/finance-asset-page";
import type { RegState } from "@/lib/registration";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { StatusPill } from "@/components/ui/status";

const peso = (c: number | null) => (c === null ? "—" : fmtMoneyExact(c / 100));

export interface PanelDoc {
  kind: string;
  title: string;
  file: { id: string; fileName: string; size: number | null } | null;
}

export interface AssetPanelProps {
  id: string;
  state: AssetPageState;
  tag: string;
  model: string;
  category: string;
  serial: string | null;
  status: AssetStatus;
  statusLabel: string;
  reg: RegState;
  regLabel: string;
  notCapitalised: boolean;
  /** `lifeSummary(...)`; null when there is no schedule (then `lifeNote` says why). */
  life: LifeSummary | null;
  costC: number | null;
  lifeNote: string | null;
  /** The holder, linked only for roles that can open Employees (`href` null otherwise). */
  holder: { name: string; href: string | null } | null;
  /** The holder's client or department. */
  worksFor: string | null;
  docs: PanelDoc[];
}

function FileIcon() {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.3">
      <path d="M4 1.5h5.5L13 5v9.5H4z" />
      <path d="M9.5 1.5V5H13" />
    </svg>
  );
}

/** The conic "life used" ring with the percentage in the middle. */
function LifeRing({ pct }: { pct: number }) {
  return (
    <div
      role="img"
      aria-label={`Life used ${pct}%`}
      className="relative grid size-[84px] shrink-0 place-items-center rounded-full"
      style={{ background: `conic-gradient(var(--accent) ${pct * 3.6}deg, var(--border-faint) 0deg)` }}
    >
      <div className="grid size-[64px] place-items-center rounded-full bg-surface">
        <span className="flex flex-col items-center leading-tight">
          <span className="font-mono text-[15px] font-semibold tabular-nums text-fg">{pct}%</span>
          <span className="text-[10px] text-fg-muted">life used</span>
        </span>
      </div>
    </div>
  );
}

/**
 * Phase 47 (spec §4.1): the left panel (about 320 px; stacked above the main column on a phone) — identity (the tag
 * is the page's h1), the life card (ring, book value today, months left, the cost-versus-depreciated bar and the money
 * list), the Asset card, and the Documents card whose uploaded slots open the preview at the top of the main column.
 */
export function AssetPanel(p: AssetPanelProps) {
  const life = p.life;
  return (
    <aside aria-label="Asset summary" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <h1 className="font-mono text-xl font-semibold leading-tight tracking-[-0.01em] text-fg">{p.tag}</h1>
        <p className="text-[13px] text-fg-secondary">{p.model} · {p.category}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusPill value={p.status} label={p.statusLabel} />
          {p.reg === "registered" && p.notCapitalised ? (
            <Pill>Not capitalised</Pill>
          ) : (
            <StatusPill ns="registration" value={p.reg} label={p.regLabel} />
          )}
        </div>
      </div>

      <Card>
        <CardBody className="flex flex-col gap-3">
          {life ? (
            <>
              <div className="flex items-center gap-4">
                <LifeRing pct={life.usedPct} />
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[11px] text-fg-muted">Book value today</span>
                  <span className="font-mono text-[18px] font-semibold tabular-nums text-fg">{peso(life.bookC)}</span>
                  <span className="text-[12px] text-fg-secondary">
                    {`${life.monthsLeft} of ${life.lifeMonths} months left · ends ${life.endsLabel}`}
                  </span>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <div
                  role="img"
                  aria-label={`${life.depreciatedPct}% of the cost depreciated`}
                  className="flex h-2 w-full overflow-hidden rounded-full bg-accent-soft"
                >
                  <span className="block h-full bg-accent" style={{ width: `${life.depreciatedPct}%` }} />
                </div>
                <div className="flex justify-between text-[10.5px] text-fg-muted">
                  <span>Depreciated</span>
                  <span>Cost</span>
                </div>
              </div>
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-[12.5px]">
                {([
                  ["Cost", life.costC],
                  ["Depreciated", life.accC],
                  ["Book value", life.bookC],
                  ["Per month", life.monthlyC],
                ] as const).map(([label, c]) => (
                  <div key={label} className="contents">
                    <dt className="text-fg-muted">{label}</dt>
                    <dd className="text-right font-mono tabular-nums text-fg-secondary">{peso(c)}</dd>
                  </div>
                ))}
              </dl>
            </>
          ) : (
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-[12.5px]">
              <dt className="text-fg-muted">Cost</dt>
              <dd className="text-right font-mono tabular-nums text-fg-secondary">{p.costC === null ? "Not recorded" : peso(p.costC)}</dd>
              <dt className="text-fg-muted">Depreciation</dt>
              <dd className="text-right text-fg-secondary">{p.lifeNote ?? "No schedule"}</dd>
            </dl>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Asset" />
        <CardBody>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[12.5px]">
            <dt className="text-fg-muted">Serial</dt>
            <dd className="min-w-0 break-words font-mono text-xs text-fg-secondary">{p.serial ?? "—"}</dd>
            <dt className="text-fg-muted">Category</dt>
            <dd className="text-fg-secondary">{p.category}</dd>
            <dt className="text-fg-muted">Status</dt>
            <dd className="text-fg-secondary">{p.statusLabel}</dd>
            <dt className="text-fg-muted">Held by</dt>
            <dd className="text-fg-secondary">
              {p.holder ? (
                p.holder.href ? <Link href={p.holder.href} className="text-accent hover:underline">{p.holder.name}</Link> : p.holder.name
              ) : "—"}
            </dd>
            <dt className="text-fg-muted">Works for</dt>
            <dd className="text-fg-secondary">{p.worksFor ?? "—"}</dd>
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Documents" />
        <CardBody>
          <ul className="flex flex-col gap-1.5">
            {p.docs.map((d, i) => {
              if (!d.file) {
                return (
                  <li
                    key={`${d.kind}-${i}`}
                    data-missing="true"
                    className="flex items-center gap-2 rounded-(--radius-ctl) border border-dashed border-border-strong px-2.5 py-2 text-fg-faint"
                  >
                    <FileIcon />
                    <span className="flex min-w-0 flex-col">
                      <span className="text-[12px] text-fg-muted">{d.title}</span>
                      <span className="text-[11px]">not uploaded</span>
                    </span>
                  </li>
                );
              }
              const on = p.state.doc === d.file.id;
              return (
                <li key={`${d.kind}-${i}`}>
                  <Link
                    href={assetPageHref(p.id, p.state, { doc: d.file.id })}
                    scroll={false}
                    prefetch={false}
                    aria-current={on ? "true" : undefined}
                    className={cn(
                      "flex items-center gap-2 rounded-(--radius-ctl) border px-2.5 py-2 transition-colors duration-(--dur-1)",
                      on ? "border-accent bg-accent-tint" : "border-border hover:bg-surface-subtle",
                    )}
                  >
                    <span className="text-accent"><FileIcon /></span>
                    <span className="flex min-w-0 flex-col">
                      <span className="text-[11px] text-fg-muted">{d.title}</span>
                      <span className="truncate text-[12.5px] text-fg">{d.file.fileName}</span>
                    </span>
                    {d.file.size !== null && (
                      <span className="ml-auto shrink-0 font-mono text-[10.5px] text-fg-faint">{fmtFileSize(d.file.size)}</span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </CardBody>
      </Card>
    </aside>
  );
}
