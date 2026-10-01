import { requireRole } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { PageHeader } from "@/components/ui/page-header";
import { Banner } from "@/components/ui/banner";
import { ButtonLink } from "@/components/ui/button-link";
import { PrintButton } from "@/components/ui/print-button";
import { LabelSheet, QR_NOTE } from "@/components/inventory/label-sheet";
import { TagsBox } from "@/components/inventory/tags-box";
import { BULK_MAX } from "@/lib/inventory-list";
import { CALIBRATION_MM, clampStart, labelSlots } from "@/lib/label-geometry";
import { qrBase } from "@/lib/label-qr";
import { parseTagPaste } from "@/lib/tag-paste";
import { MANAGEABLE_CLASSES, parseCls, withClsQS } from "@/lib/asset-class";

/** How many tags the on-page list names before it says "and {k} more" (spec §5.1). */
const LISTED_TAGS = 10;

function firstParam(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function LabelsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // A SET, not a floor — matching both importers. requireRole("it_staff")
  // alone would lock out admin, the role that runs this app.
  const user = await requireRole("admin", "it_staff", "purchasing_staff");
  const sp = await searchParams;
  const idsParam = Array.isArray(sp.ids) ? sp.ids.join(",") : sp.ids ?? "";
  const ids = [...new Set(idsParam.split(",").map((s) => s.trim()).filter(Boolean))];
  const tagsRaw = Array.isArray(sp.tags) ? sp.tags.join("\n") : sp.tags ?? "";
  const start = clampStart(firstParam(sp.start));
  // The class the operator came from — only for the crumb and Back; what
  // prints is still scoped by MANAGEABLE_CLASSES below (plan P-9).
  const cls = parseCls(firstParam(sp.cls)) ?? "IT";
  const listHref = "/inventory" + withClsQS("", cls);
  const listLabel = cls === "PURCHASING" ? "Purchasing assets" : "Inventory";
  const breadcrumb = [{ label: listLabel, href: listHref }, { label: "Print labels" }];
  const manageable = [...MANAGEABLE_CLASSES[user.role]];

  // Which path built this request: a selection (`?ids=`, as before) or the
  // Tags box (`?tags=`). `?ids=` wins when both are present.
  const viaTags = ids.length === 0 && tagsRaw.trim() !== "";
  const tags = viaTags ? parseTagPaste(tagsRaw) : [];
  const asked = viaTags ? tags.length : ids.length;

  // Refuse, never slice (the defect §8 records for the export route's ?ids=).
  // The same sentence for a pasted list as for a selection (spec §10).
  if (asked > BULK_MAX) {
    return (
      <>
        <PageHeader title="Print labels" breadcrumb={breadcrumb} />
        <Banner tone="fault" title={`That selection is ${asked} assets, over the ${BULK_MAX}-asset label cap. Narrow the selection and try again. Nothing was printed.`} />
        {viaTags && (
          <div className="pt-4"><TagsBox mode="tags" tags={tagsRaw} start={start} cls={cls} /></div>
        )}
      </>
    );
  }

  let rows: { tag: string; model: string }[] = [];
  let skipped: string[] = [];
  if (viaTags) {
    const found = await prisma.asset.findMany({
      where: { tag: { in: tags }, cls: { in: manageable } },
      select: { tag: true, model: true },
    });
    const byTag = new Map(found.map((a) => [a.tag, a]));
    // The typed (or scanned) order is the order the stickers come off the sheet.
    rows = tags.flatMap((t) => {
      const a = byTag.get(t);
      return a ? [{ tag: a.tag, model: a.model }] : [];
    });
    skipped = tags.filter((t) => !byTag.has(t));
  } else if (ids.length) {
    const assets = await prisma.asset.findMany({ where: { id: { in: ids }, cls: { in: manageable } }, select: { tag: true, model: true }, orderBy: { tag: "asc" } });
    rows = assets.map((a) => ({ tag: a.tag, model: a.model }));
  }

  const skippedLine = skipped.length > 0 && (
    <p className="font-mono text-[11px] text-fg-secondary">{skipped.join(", ")} — not found or not your class</p>
  );

  if (rows.length === 0) {
    return (
      <>
        <PageHeader title="Print labels" breadcrumb={breadcrumb} />
        <div className="flex flex-col gap-4">
          <Banner tone="attention" title="Nothing to print">
            Select assets on the list, then choose Print labels in the selection bar — or Print label
            from a record&apos;s More menu.
          </Banner>
          {skippedLine}
          <TagsBox mode="tags" tags={tagsRaw} start={start} cls={cls} />
          <div><ButtonLink href={listHref}>{cls === "PURCHASING" ? "Back to Purchasing assets" : "Back to inventory"}</ButtonLink></div>
        </div>
      </>
    );
  }

  const sheetTags = rows.map((r) => r.tag);
  const sheets = labelSlots(sheetTags, start).length;
  const plural = rows.length === 1 ? "" : "s";
  const missing = ids.length - rows.length;
  const base = qrBase(process.env.APP_BASE_URL);
  const more = sheetTags.length - LISTED_TAGS;

  return (
    <>
      <div className="print:hidden">
        <PageHeader title="Print labels" breadcrumb={breadcrumb} actions={<PrintButton />} />
        <div className="flex flex-col gap-2 pb-4">
          <p className="font-mono text-[11px] text-fg-muted">
            {viaTags
              ? `${rows.length} label${plural} · ${skipped.length} skipped`
              : `${rows.length} label${plural} · ${sheets} sheet${sheets === 1 ? "" : "s"}`}
          </p>
          {skippedLine}
          <p className="font-mono text-[11px] text-fg-secondary">
            {sheetTags.slice(0, LISTED_TAGS).join(", ")}
            {more > 0 && <span className="font-sans text-fg-muted"> and {more} more</span>}
          </p>
          {/* A stale selection must not silently print fewer stickers than the
              operator counted. Cause-neutral: `ids.length - rows.length`
              counts an id whose asset was not found, or whose class this role
              cannot manage — "could not be printed" covers both. */}
          {!viaTags && missing > 0 && (
            <Banner tone="attention" title={`${missing} selected asset${missing === 1 ? "" : "s"} could not be printed and ${missing === 1 ? "was" : "were"} skipped.`} />
          )}
          {/* Rule 10: a sheet without QR codes looks finished and is not. The
              plain sentence is for everyone; the precise cause is for the one
              role that can fix it. */}
          {!base.ok && (
            <Banner tone="attention" title="No QR on these labels — the app's address is set to this computer only. Ask the administrator to set the network address.">
              {user.role === "admin" && (
                <details className="mt-1.5">
                  <summary className="cursor-pointer text-fg-secondary">Why</summary>
                  <p className="mt-1 font-mono text-xs">{QR_NOTE[base.reason]}</p>
                </details>
              )}
            </Banner>
          )}
          <Banner tone="neutral" title="Before you print">
            Set <span className="font-mono">Scale: 100%</span>,{" "}
            <span className="font-mono">Margins: None</span>, and{" "}
            <span className="font-mono">Paper size: A4</span> in the print dialog. Then measure the{" "}
            {CALIBRATION_MM}mm bar on the sheet — if it is short, one of those three settings is
            wrong and the stickers will not line up.
          </Banner>
          <div className="pt-1">
            {viaTags
              ? <TagsBox mode="tags" tags={tags.join("\n")} start={start} cls={cls} />
              : <TagsBox mode="start" ids={ids.join(",")} start={start} cls={cls} />}
          </div>
        </div>
      </div>
      {/* Read here rather than inside the component: this is a Server
          Component and the sheet is a pure render of its props, which is what
          keeps label-sheet.tsx drivable from Playwright without stubbing an
          environment. `qrBase` decides whether the value is usable; an unset
          or loopback APP_BASE_URL prints the barcode alone plus a note
          naming the cause, never a dead QR. */}
      <LabelSheet rows={rows} baseUrl={process.env.APP_BASE_URL} startAt={start} />
    </>
  );
}
