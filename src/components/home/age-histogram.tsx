import type { AgeBar } from "@/server/modules/home/queries";

const MAX_H = 74; // README: 74px max bar

/** Only the 4y+ bar changes colour — it is next year's capex conversation. */
export function AgeHistogram({ bars }: { bars: AgeBar[] }) {
  const peak = Math.max(1, ...bars.map((b) => b.count));
  return (
    <div className="flex items-end gap-3" role="img" aria-label={bars.map((b) => `${b.bucket}: ${b.count}`).join(", ")}>
      {bars.map((b) => (
        <div key={b.bucket} className="flex flex-1 flex-col items-center gap-1.5">
          <span className="font-mono text-[10.5px] font-semibold text-fg">{b.count}</span>
          <span
            aria-hidden
            className="w-full rounded-t-[3px]"
            style={{
              height: `${Math.max(2, Math.round((b.count / peak) * MAX_H))}px`,
              background: b.bucket === "4y+" ? "var(--st-attention-dot)" : "var(--st-neutral-dot)",
              animation: "grow var(--dur-3) var(--ease-std)",
            }}
          />
          <span className="font-mono text-[10px] text-fg-muted">{b.bucket}</span>
        </div>
      ))}
    </div>
  );
}
