import { requireRole } from "@/server/auth/guards";
import { toSearchParams } from "@/lib/url-state";
import { DELIVERY_TABS, parseDeliveryTab } from "@/lib/webhooks";
import { listDeliveries } from "@/server/modules/admin/queries";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs } from "@/components/ui/tabs";
import { DeliveryTable } from "@/components/admin/delivery-table";

export default async function DeliveriesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole("admin");
  const tab = parseDeliveryTab(toSearchParams(await searchParams).get("state"));
  const { rows, total, deadReplayable } = await listDeliveries(tab);

  return (
    <>
      <PageHeader
        title="Delivery attempts"
        breadcrumb={[{ label: "Webhooks", href: "/admin/webhooks" }, { label: "Delivery attempts" }]}
      />
      <div className="flex flex-col gap-3">
        {/* `Tabs`, not a hand-rolled nav: this is the same `?state=` contract
            and the same affordance /purchases and /reservations render, and
            `endpoint-editor.tsx` already links into `?state=DEAD`. The labels
            come off DELIVERY_TABS rather than a map beside this markup, so
            there is only one list to keep true. */}
        <Tabs
          items={DELIVERY_TABS.map((t) => ({
            label: t.label,
            href:
              t.id === "ALL"
                ? "/admin/webhooks/deliveries"
                : `/admin/webhooks/deliveries?state=${t.id}`,
            active: t.id === tab,
          }))}
          className="pb-1"
        />

        <DeliveryTable
          rows={rows}
          total={total}
          deadReplayable={deadReplayable}
          empty={
            <EmptyState
              title={tab === "ALL" ? "Nothing has been sent yet" : "Nothing in this tab"}
              description={
                tab === "ALL"
                  ? "An attempt is recorded the moment an approval executes, an offboarding completes or a purchase request is completed — provided an endpoint subscribes to that event."
                  : "Attempts move between these tabs as the worker retries them."
              }
            />
          }
        />
      </div>
    </>
  );
}
