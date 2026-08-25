import { requireRole } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { PageHeader } from "@/components/ui/page-header";
import { Banner } from "@/components/ui/banner";
import { ButtonLink } from "@/components/ui/button-link";
import { PrintButton } from "@/components/ui/print-button";
import { LabelSheet } from "@/components/inventory/label-sheet";
import { BULK_MAX } from "@/lib/inventory-list";
import { labelPages } from "@/lib/label-geometry";

export default async function LabelsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // A SET, not a floor — matching both importers. requireRole("it_staff")
  // alone would lock out admin, the role that runs this app.
  await requireRole("admin", "it_staff");
  const raw = (await searchParams).ids;
  const idsParam = Array.isArray(raw) ? raw.join(",") : raw ?? "";
  const ids = [...new Set(idsParam.split(",").map((s) => s.trim()).filter(Boolean))];

  // Refuse, never slice (the defect §8 records for the export route's ?ids=).
  if (ids.length > BULK_MAX) {
    return (
      <>
        <PageHeader title="Print labels" breadcrumb={[{ label: "Inventory", href: "/inventory" }, { label: "Labels" }]} />
        <Banner tone="fault" title={`That selection is ${ids.length} assets, over the ${BULK_MAX}-asset label cap. Narrow the selection and try again. Nothing was printed.`} />
      </>
    );
  }

  const assets = ids.length
    ? await prisma.asset.findMany({ where: { id: { in: ids } }, select: { tag: true, model: true }, orderBy: { tag: "asc" } })
    : [];

  if (assets.length === 0) {
    return (
      <>
        <PageHeader title="Print labels" breadcrumb={[{ label: "Inventory", href: "/inventory" }, { label: "Labels" }]} />
        <Banner tone="attention" title="Nothing to print">
          Pick assets on the inventory list first — select rows, then choose Print labels from Bulk
          actions. A label sheet is built from a selection, never from the whole fleet.
        </Banner>
        <div className="pt-3"><ButtonLink href="/inventory">Back to inventory</ButtonLink></div>
      </>
    );
  }

  const rows = assets.map((a) => ({ tag: a.tag, model: a.model }));
  const missing = ids.length - assets.length;
  const sheets = labelPages(rows.map((r) => r.tag)).length;

  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title="Print labels"
          breadcrumb={[{ label: "Inventory", href: "/inventory" }, { label: "Labels" }]}
          actions={<PrintButton />}
        />
        <div className="flex flex-col gap-2 pb-4">
          <p className="font-mono text-[11px] text-fg-muted">
            {rows.length} label{rows.length === 1 ? "" : "s"} · {sheets} sheet{sheets === 1 ? "" : "s"}
          </p>
          {/* A stale selection must not silently print fewer stickers than the
              operator counted. */}
          {missing > 0 && (
            <Banner tone="attention" title={`${missing} selected asset${missing === 1 ? "" : "s"} no longer exist${missing === 1 ? "s" : ""} and ${missing === 1 ? "was" : "were"} skipped.`} />
          )}
          <Banner tone="neutral" title="Before you print">
            Set <span className="font-mono">Scale: 100%</span> and{" "}
            <span className="font-mono">Margins: None</span> in the print dialog. Then measure the
            100mm bar on the sheet — if it is short, the browser scaled the page and the stickers will
            not line up.
          </Banner>
        </div>
      </div>
      <LabelSheet rows={rows} />
    </>
  );
}
