import type { SetupDot } from "@/lib/side-card";

const STYLE: Record<SetupDot, React.CSSProperties> = {
  done: { background: "var(--st-settled-dot)" },
  notyet: { background: "var(--st-attention-dot)" },
  off: { background: "var(--st-neutral-dot)" },
  // Not recorded: a hollow grey ring, so "nothing said yet" never reads as a decision.
  unrecorded: { border: "1.5px solid var(--st-closed-ring)" },
};

/** Phase 39 (spec §2.3, §2.4): the side card's status dot. Decorative — the text beside it carries the meaning. */
export function StatusDot({ dot }: { dot: SetupDot }) {
  return <span aria-hidden className="inline-block size-2 shrink-0 rounded-full" style={STYLE[dot]} />;
}
