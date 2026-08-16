import { EmptyState } from "@/components/ui/empty-state";
import { ButtonLink } from "@/components/ui/button-link";

export default function EmployeeNotFound() {
  return (
    <EmptyState
      title="Employee not found"
      description="They may have been removed, or the link is stale."
      actions={<ButtonLink href="/employees">Back to employees</ButtonLink>}
    />
  );
}
