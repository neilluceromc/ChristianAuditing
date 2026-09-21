"use client";

import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * Phase 25 (spec §6.1): the one error boundary under the app shell — sidebar
 * and topbar stay mounted, only the page segment is replaced. The message is
 * never `error.message` (it may carry internals); the digest is enough to find
 * the server log line.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <EmptyState
      title="Something went wrong"
      description={error.digest ? `Reference ${error.digest}` : "The page hit an unexpected error."}
      actions={
        <>
          <Button onClick={reset}>Try again</Button>
          <ButtonLink href="/">Home</ButtonLink>
        </>
      }
    />
  );
}
