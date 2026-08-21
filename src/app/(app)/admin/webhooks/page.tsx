import Link from "next/link";
import { requireRole } from "@/server/auth/guards";
import { PageHeader } from "@/components/ui/page-header";
import { Banner } from "@/components/ui/banner";
import { EndpointCard, NewEndpointCard } from "@/components/admin/endpoint-editor";
import { listEndpoints } from "@/server/modules/admin/queries";
import { MAX_JOB_ATTEMPTS } from "@/lib/jobs";

export default async function WebhooksPage() {
  await requireRole("admin");
  const endpoints = await listEndpoints();

  return (
    <>
      <PageHeader
        title="Webhooks"
        actions={
          <Link href="/admin/webhooks/deliveries" className="text-[12px] font-medium text-accent hover:underline">
            Delivery attempts →
          </Link>
        }
      />
      <div className="flex max-w-[720px] flex-col gap-3">
        <Banner tone="neutral" title="Every POST is signed, and every attempt is recorded">
          The signing secret is shown once when you create or rotate it and is stored encrypted, so it
          can never be read back — only replaced. A failed delivery is retried with a widening gap,{" "}
          {/* MAX_JOB_ATTEMPTS, not the literal "five": the worker enforces this
              cap and the deliveries chip reads `DEAD · 5/5` from the same
              constant, so tuning the worker must not leave this sentence
              claiming a number nothing enforces (§6a rule 26). It is attempts
              in TOTAL, not retries after the first — the worker dead-letters
              when `attempts >= MAX_JOB_ATTEMPTS`. */}
          {MAX_JOB_ATTEMPTS} attempts in all, before it dead-letters — and a dead one can be replayed.
        </Banner>

        {endpoints.length === 0 && (
          <p className="text-xs text-fg-muted">
            No endpoints yet — nothing is being notified when approvals execute, offboardings complete
            or purchases are approved.
          </p>
        )}

        {endpoints.map((endpoint) => (
          <EndpointCard key={endpoint.id} endpoint={endpoint} />
        ))}

        <NewEndpointCard />
      </div>
    </>
  );
}
