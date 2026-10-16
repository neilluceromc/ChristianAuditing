"use client";

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { DescriptionList } from "@/components/ui/description-list";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status";
import { useFocusTrap } from "@/components/ui/use-focus-trap";
import { fmtDayMonth, fmtDayMonthYear } from "@/lib/format";
import { heldItemPanel, type HeldItemPanel as PanelData } from "@/server/modules/employees/panel-actions";

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; panel: PanelData };

/**
 * Phase 37 (spec §4.4): the right-side drawer for one held item. Read-only data
 * from `heldItemPanel`; the only writes are the existing Replace / Return
 * dialogs, which the view opens after this closes.
 *
 * Mounted only while open, so the focus trap installs on mount (focus to ×,
 * the first focusable), Esc and the backdrop close it, and the trap hands focus
 * back on unmount — the view then puts it on the opening tile.
 */
export function HeldItemPanel({
  employeeId, asset, canReplace, canReturn, canEdit, onClose, onReplace, onReturn,
}: {
  employeeId: string;
  /** What the tile already knows, so the heading shows before the data lands. */
  asset: { id: string; tag: string; model: string; status: string };
  canReplace: boolean;
  canReturn: boolean;
  canEdit: boolean;
  onClose: () => void;
  onReplace: () => void;
  onReturn: () => void;
}) {
  const setTrapRef = useFocusTrap(true, onClose);
  const titleId = useId();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    let live = true;
    setLoad({ state: "loading" });
    heldItemPanel({ employeeId, assetId: asset.id }).then(
      (res) => {
        if (!live) return;
        if (res.ok) setLoad({ state: "ready", panel: res.data.panel });
        else if (res.kind === "rate_limited") {
          setLoad({ state: "error", message: `Too many lookups this minute — try again in ${res.retryAfterSec ?? 60} s.` });
        } else setLoad({ state: "error", message: res.fieldErrors?._form ?? res.message });
      },
      () => { if (live) setLoad({ state: "error", message: "This item could not be loaded." }); },
    );
    return () => { live = false; };
  }, [employeeId, asset.id]);

  if (!mounted) return null;
  const panel = load.state === "ready" ? load.panel : null;
  const href = `/inventory/${asset.id}`;

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div
        aria-hidden
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
        style={{ animation: "veil var(--dur-4) var(--ease-std)" }}
      />
      <div
        ref={setTrapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="absolute inset-y-0 right-0 flex h-full w-full flex-col border-l border-border bg-surface-raised shadow-drawer sm:w-[420px]"
        style={{ animation: "sheet var(--dur-4) var(--ease-std)" }}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border-faint px-4 py-3">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h2 id={titleId} className="text-[15px] font-semibold text-fg">
              <span className="font-mono">{asset.tag}</span> · {panel?.model ?? asset.model}
            </h2>
            <span><StatusPill value={panel?.status ?? asset.status} /></span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-(--radius-ctl) px-2 py-1 text-fg-muted hover:bg-surface-subtle"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 py-4">
          {load.state === "loading" && (
            <div className="flex flex-col gap-3" aria-busy="true">
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-3 w-3/5" />
              <Skeleton className="h-3 w-2/5" />
              <Skeleton className="mt-3 h-3 w-full" />
              <Skeleton className="h-3 w-5/6" />
            </div>
          )}

          {load.state === "error" && (
            <div className="flex flex-col gap-3">
              <Banner tone="fault" title={load.message} />
              <span><Button variant="secondary" size="sm" onClick={onClose}>Close</Button></span>
            </div>
          )}

          {panel && (
            <>
              <DescriptionList
                items={[
                  { label: "Category · Type", value: `${panel.categoryName ?? "—"} · ${panel.typeName ?? "—"}` },
                  { label: "Serial", value: panel.serial ?? "—", mono: true },
                  {
                    label: "Status",
                    value: panel.loanDueAt ? `${panel.status} · due ${fmtDayMonthYear(panel.loanDueAt)}` : panel.status,
                    mono: true,
                  },
                  ...(panel.heldSince ? [{ label: "Held since", value: fmtDayMonthYear(panel.heldSince) }] : []),
                  ...(panel.bookValue ? [{ label: "Value at cost", value: panel.bookValue, mono: true }] : []),
                ]}
              />

              <section aria-labelledby={`${titleId}-history`} className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 id={`${titleId}-history`} className="text-[13px] font-semibold text-fg">Recent history</h3>
                  <Link href={href} className="text-xs text-accent hover:underline">See all</Link>
                </div>
                {panel.history.length === 0 ? (
                  <p className="text-xs text-fg-muted">Nothing recorded yet.</p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {panel.history.map((h, i) => (
                      <li key={`${h.at}-${i}`} className="text-xs text-fg-secondary">
                        <span className="font-mono text-[11px] text-fg-muted">{fmtDayMonth(h.at)}</span> — {h.sentence}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border-faint px-4 py-3">
          {canReplace && <Button variant="secondary" size="sm" onClick={onReplace}>Replace…</Button>}
          {canReturn && <Button variant="secondary" size="sm" onClick={onReturn}>Return…</Button>}
          {canEdit && <ButtonLink href={`${href}#status`} size="sm" variant="ghost">Change status</ButtonLink>}
          {canEdit && <ButtonLink href={`${href}/edit`} size="sm" variant="ghost">Edit details</ButtonLink>}
          <ButtonLink href={href} size="sm" variant="primary" className="ml-auto">Open full record</ButtonLink>
        </div>
      </div>
    </div>,
    document.body,
  );
}
