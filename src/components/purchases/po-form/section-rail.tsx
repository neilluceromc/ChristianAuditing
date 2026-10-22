import { cn } from "@/lib/cn";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Eyebrow } from "./fields";
import { SECTIONS, type SectionKey } from "./po-form-model";

/**
 * A3's "On this page" rail: each section's step number, or a green tick once it is done, linking to its card; then
 * the progress bar, "N of 5 sections done". Sticky beside the form from 900px; above it on narrower screens.
 */
export function SectionRail({ done, className }: { done: Record<SectionKey, boolean>; className?: string }) {
  const count = SECTIONS.filter((s) => done[s.key]).length;
  return (
    <nav
      aria-label="On this page"
      className={cn("flex flex-col gap-1 rounded-(--radius-card) border border-border bg-surface p-3 shadow-card", className)}
    >
      <Eyebrow className="px-2 pb-1.5 pt-1">On this page</Eyebrow>
      {SECTIONS.map((s, i) => {
        const ok = done[s.key];
        return (
          <a
            key={s.key}
            href={s.href}
            className="flex items-center gap-2.5 rounded-(--radius-btn) px-2 py-2 text-[13.5px] text-fg-secondary hover:bg-row-hover hover:text-fg"
          >
            <span
              aria-hidden="true"
              className={cn(
                "inline-flex size-5 shrink-0 items-center justify-center rounded-full border-[1.5px] text-[11px] font-semibold",
                ok ? "border-[var(--st-settled-dot)] bg-[var(--st-settled-dot)] text-[var(--surface)]" : "border-border-strong bg-surface text-fg-secondary",
              )}
            >
              {ok ? (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12l5 5L20 7" />
                </svg>
              ) : i + 1}
            </span>
            <span className="flex-1">{s.label}</span>
            {ok && <span className="sr-only">(done)</span>}
          </a>
        );
      })}
      <div className="mt-1.5 flex flex-col gap-1.5 border-t border-border-faint px-2 pb-0.5 pt-2.5">
        <Eyebrow>Progress</Eyebrow>
        <ProgressBar value={count} max={SECTIONS.length} label="Sections done" />
        <span className="text-[12.5px] text-fg-secondary">{`${count} of ${SECTIONS.length} sections done`}</span>
      </div>
    </nav>
  );
}
