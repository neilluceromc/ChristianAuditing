import { EmptyState } from "@/components/ui/empty-state";
import { ButtonLink } from "@/components/ui/button-link";

export default function ApprovalNotFound() {
  return (
    <EmptyState
      title="Approval not found"
      description="It may have been removed, or the link is stale."
      actions={<ButtonLink href="/approvals">Back to approvals</ButtonLink>}
    />
  );
}
