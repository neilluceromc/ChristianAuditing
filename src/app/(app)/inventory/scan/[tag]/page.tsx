import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/guards";
import { fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status";
import { Banner } from "@/components/ui/banner";
import { ButtonLink } from "@/components/ui/button-link";

/**
 * Where a scanned label QR lands. Deliberately NOT the full record: a phone
 * held next to a device should answer "whose is this, and is it healthy?"
 * without scrolling.
 *
 * Keyed on the TAG, never on the id. Cuids change on every reseed — the seed
 * TRUNCATEs and reinserts, and every e2e spec reseeds in its own beforeAll —
 * so a QR encoding an id would die the first time anyone ran the suite, on
 * paper already stuck to hardware. Asset.tag is @unique, so this is a natural
 * findUnique.
 *
 * Gating comes from the general /inventory PATH_RULES entry, which this route
 * matches by living under /inventory/. That is deliberate: PATH_RULES is
 * first-match-wins, three separate comments in that file warn about ordering,
 * and adding nothing to it is the safest possible change. The static `scan`
 * segment wins over the sibling [id] route the same way /inventory/labels
 * already does.
 *
 * Reading Prisma inline rather than via queries.ts follows the accountability
 * form page, which does the same for the same reason: one read, no reuse.
 */
export default async function ScanCardPage({ params }: { params: Promise<{ tag: string }> }) {
  await requireUser();
  const { tag: raw } = await params;
  const tag = decodeURIComponent(raw).trim().toUpperCase();

  const asset = await prisma.asset.findUnique({
    where: { tag },
    select: {
      id: true,
      tag: true,
      model: true,
      serial: true,
      status: true,
      purchasedAt: true,
      warrantyUntil: true,
      category: { select: { name: true } },
      assignee: {
        select: {
          id: true,
          name: true,
          employeeNo: true,
          employment: true,
          department: { select: { name: true } },
        },
      },
    },
  });

  // NOT notFound(): a sticker outlives the row it names. Assets get disposed
  // and the label stays on the hardware, so a miss is an expected outcome of
  // scanning, not an error. Name the tag back so the person holding the thing
  // knows the scan worked and the record is what is gone.
  if (!asset) {
    return (
      <>
        <PageHeader title="Unknown tag" breadcrumb={[{ label: "Inventory", href: "/inventory" }, { label: "Scan" }]} />
        <Banner tone="attention" title={`No asset is registered as ${tag}.`}>
          The label may belong to an asset that has been disposed, or the code may have been misread.
        </Banner>
        <div className="pt-3"><ButtonLink href="/inventory">Back to inventory</ButtonLink></div>
      </>
    );
  }

  const rows: Array<[string, string]> = [
    ["Held by", asset.assignee ? `${asset.assignee.name} · ${asset.assignee.employeeNo}` : "Unassigned"],
    ["Department", asset.assignee ? asset.assignee.department.name : "—"],
    ["Employment", asset.assignee ? asset.assignee.employment : "—"],
    ["Category", asset.category.name],
    ["Purchased", fmtDate(asset.purchasedAt)],
    ["Warranty", fmtDate(asset.warrantyUntil)],
    ["Serial", asset.serial ?? "—"],
  ];

  return (
    <>
      <PageHeader
        title={asset.tag}
        breadcrumb={[{ label: "Inventory", href: "/inventory" }, { label: "Scan" }]}
        badge={<StatusPill value={asset.status} />}
      />
      <p className="-mt-2 pb-4 text-[13px] text-fg-secondary">{asset.model}</p>

      {/*
        Cost, vendor, repair quote and notes are deliberately absent. This page
        is reachable by anyone physically holding the device who has a login,
        including `viewer` — a wider audience than the full record's, because
        the full record is somewhere you navigate to deliberately and this is
        somewhere a sticker sends you. Acquisition cost behind an adhesive
        label is a disclosure nobody asked for. Anyone who needs it taps
        through.
      */}
      <dl className="flex flex-col gap-0 rounded-(--radius-card) border border-border bg-surface">
        {rows.map(([label, value]) => (
          <div key={label} className="flex gap-4 border-b border-border px-4 py-2.5 last:border-b-0">
            <dt className="w-28 shrink-0 text-[13px] text-fg-muted">{label}</dt>
            <dd className="text-[13px]">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="pt-4">
        <ButtonLink href={`/inventory/${asset.id}`}>Open full record</ButtonLink>
      </div>
    </>
  );
}
