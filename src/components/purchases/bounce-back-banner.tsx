import { Banner } from "@/components/ui/banner";
import { fmtDateTime } from "@/lib/format";
import { unitAnchor, type BounceBack } from "@/lib/purchase-thread";

/**
 * README 1j: "a purchasing user landing on a bounced-back request understands
 * *why* it came back within two seconds." Red left border, the sender by name,
 * the reason verbatim, and the honest transition line — nothing was cleared.
 */
export function BounceBackBanner({ bounce }: { bounce: BounceBack }) {
  const jump = unitAnchor(bounce.reason);
  const sender = bounce.from === "finance" ? "Finance" : "IT";
  return (
    <Banner
      tone="fault"
      title={`${sender} sent this back — ${bounce.by} · ${fmtDateTime(bounce.at)}`}
      actions={
        <>
          <a href={jump.anchor} className="text-xs font-medium text-accent hover:underline">{jump.label}</a>
          <a href="#thread" className="text-xs font-medium text-accent hover:underline">Reply in thread</a>
        </>
      }
    >
      <p className="text-[13px] text-fg">{bounce.reason}</p>
      <p className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.06em] text-fg-muted">{bounce.transition}</p>
    </Banner>
  );
}
