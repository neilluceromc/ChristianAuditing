import { ButtonLink } from "@/components/ui/button-link";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * Phase 40 (spec §9): the one "filters matched nothing" state behind Approvals, Audit and the activity feeds —
 * the same title everywhere and a Clear filters link to the page's own unfiltered href.
 */
export function FilteredEmpty({ clearHref, description }: { clearHref: string; description?: string }) {
  return (
    <EmptyState
      title="Your filters matched nothing"
      description={description}
      actions={<ButtonLink href={clearHref}>Clear filters</ButtonLink>}
    />
  );
}
