import { EmptyState } from "@/components/ui/empty-state";
import { ButtonLink } from "@/components/ui/button-link";

export default function AssetNotFound() {
  return (
    <EmptyState
      title="Asset not found"
      description="It may have been removed, or the link is stale."
      actions={<ButtonLink href="/inventory">Back to inventory</ButtonLink>}
    />
  );
}
