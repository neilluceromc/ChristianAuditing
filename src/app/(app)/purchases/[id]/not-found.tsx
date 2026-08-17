import { EmptyState } from "@/components/ui/empty-state";
import { ButtonLink } from "@/components/ui/button-link";

export default function PurchaseNotFound() {
  return (
    <EmptyState
      title="Request not found"
      description="It may have been removed, or the link is stale."
      actions={<ButtonLink href="/purchases">Back to purchase requests</ButtonLink>}
    />
  );
}
