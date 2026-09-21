import { EmptyState } from "@/components/ui/empty-state";
import { ButtonLink } from "@/components/ui/button-link";

export default function OffboardingNotFound() {
  return (
    <EmptyState
      title="Not in the offboarding queue"
      description="They may be active again, or the link is stale."
      actions={<ButtonLink href="/offboarding">Back to offboarding</ButtonLink>}
    />
  );
}
