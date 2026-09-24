import { ButtonLink } from "@/components/ui/button-link";
import { fmtDate } from "@/lib/format";

/** Spec §4.4 Peak-End: what the operator who just finished sees. */
export function OffboardedCard({ name, decisions, completedAt, reportHref, next }: {
  name: string; decisions: number; completedAt: Date | null; reportHref: string; next: { id: string; name: string } | null;
}) {
  return (
    <section aria-labelledby="offboarded-title" className="flex flex-col gap-3 rounded-(--radius-card) border border-border bg-surface p-4">
      <h2 id="offboarded-title" className="text-[15px] font-semibold text-fg">
        {name} offboarded · {decisions} decision{decisions === 1 ? "" : "s"} · {fmtDate(completedAt)}
      </h2>
      <div className="flex flex-wrap gap-2">
        <ButtonLink variant="primary" href={reportHref}>Print farewell report</ButtonLink>
        {next
          ? <ButtonLink variant="secondary" href={`/offboarding/${next.id}`}>Next leaver →</ButtonLink>
          : <ButtonLink variant="secondary" href="/offboarding">Queue clear</ButtonLink>}
      </div>
    </section>
  );
}
