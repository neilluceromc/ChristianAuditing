import { cn } from "@/lib/cn";
import type { Stepper } from "@/lib/purchase-thread";

/**
 * PO saved → With IT → Registered → Approved (With IT only when the order has IT lines), and the loop drawn explicitly: when an order came back, the
 * connector it travelled backwards along is dashed amber/red and labelled
 * "← sent back", so the return path is visible instead of implied.
 */
export function PurchaseStepper({ model }: { model: Stepper }) {
  // stepperModel decides which connector the return travelled back along
  const returnAt = model.returnAt;

  return (
    <ol className="flex flex-wrap items-start gap-1" aria-label="Purchase order progress">
      {model.stops.map((stop, i) => (
        <li key={stop.key} className="flex items-start gap-1">
          <div className="flex w-[104px] flex-col items-center gap-1 text-center">
            <span
              aria-hidden
              className={cn(
                "inline-block size-[9px] rounded-full",
                stop.status === "upcoming" && "border border-border-strong",
              )}
              style={{
                background:
                  stop.status === "done"
                    ? "var(--st-settled-dot)"
                    : stop.status === "current"
                      ? "var(--st-inflight-dot)"
                      : "transparent",
              }}
            />
            <span
              className={cn(
                "text-[11.5px]",
                stop.status === "upcoming" ? "text-fg-muted" : "font-medium text-fg",
              )}
            >
              {stop.label}
            </span>
            {stop.note && (
              <span className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-[color:var(--st-inflight-text)]">
                {stop.note}
              </span>
            )}
            <span className="sr-only">
              {stop.status === "current" ? "current step" : stop.status === "done" ? "completed step" : "upcoming step"}
            </span>
          </div>
          {i < model.stops.length - 1 && (
            <div className="mt-1 flex w-[72px] flex-col items-center gap-0.5">
              <span
                aria-hidden
                className="h-0 w-full"
                style={{
                  borderTop: i === returnAt ? "1.5px dashed var(--st-fault-dot)" : "1.5px solid var(--border-strong)",
                }}
              />
              {i === returnAt && (
                <span className="font-mono text-[9px] uppercase tracking-[0.06em] text-[color:var(--st-fault-text)]">
                  ← sent back
                </span>
              )}
            </div>
          )}
        </li>
      ))}
      {model.cancelled && (
        <li className="ml-2 self-center font-mono text-[10px] uppercase tracking-[0.06em] text-fg-muted">
          cancelled — the rest never happened
        </li>
      )}
    </ol>
  );
}
