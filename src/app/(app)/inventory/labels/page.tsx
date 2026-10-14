import type { CSSProperties } from "react";
import Link from "next/link";
import { requireRole } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { PageHeader } from "@/components/ui/page-header";
import { Banner } from "@/components/ui/banner";
import { ButtonLink } from "@/components/ui/button-link";
import { LabelSheet, QR_NOTE, type LabelRow } from "@/components/inventory/label-sheet";
import { TagsBox } from "@/components/inventory/tags-box";
import { NewEquipmentTabs } from "@/components/inventory/new-equipment-tabs";
import { LabelQueueForm } from "@/components/inventory/label-queue-form";
import { PrintLabelsButton } from "@/components/inventory/print-labels-button";
import { labelQueue, labelScope, queueCount } from "@/server/modules/inventory/label-queue";
import { BULK_MAX } from "@/lib/inventory-list";
import { CALIBRATION_MM, LABELS_PER_PAGE, clampStart, labelSlots } from "@/lib/label-geometry";
import { qrBase } from "@/lib/label-qr";
import { parseTagPaste } from "@/lib/tag-paste";
import { categoryNoun } from "@/lib/register-catalog";
import type { AssetClass } from "@prisma/client";
import { MANAGEABLE_CLASSES, parseCls, withClsQS } from "@/lib/asset-class";

type Params = Record<string, string | string[] | undefined>;
type SheetRow = LabelRow & { id: string; cls: AssetClass };

function firstParam(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function allParams(v: string | string[] | undefined): string[] {
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Spec §5: "3 labels on 1 sheet, starting at sticker 4", or "…, 2 more on a second sheet". */
function summaryLine(n: number, start: number, sheets: number): string {
  if (n === 0) return "Nothing on the sheet yet. Tick a batch or enter tags, then Make sheet.";
  const first = Math.min(n, LABELS_PER_PAGE - start + 1);
  const head = `${plural(first, "label")} on 1 sheet, starting at sticker ${start}`;
  const rest = n - first;
  if (rest === 0) return head;
  const extra = sheets - 1;
  return `${head}, ${rest} more on ${extra === 1 ? "a second sheet" : `${extra} more sheets`}`;
}

const STEP = "inline-grid size-8 place-items-center rounded-md border border-border text-sm text-fg";

function StepLink({ to, href, label, children }: { to: number; href: string; label: string; children: React.ReactNode }) {
  if (to < 1 || to > LABELS_PER_PAGE) {
    return <span role="link" aria-disabled="true" aria-label={label} className={`${STEP} text-fg-faint`}>{children}</span>;
  }
  return <Link href={href} aria-label={label} className={`${STEP} hover:bg-surface-subtle`}>{children}</Link>;
}

export default async function LabelsPage({ searchParams }: { searchParams: Promise<Params> }) {
  // A SET, not a floor — matching both importers. requireRole("it_staff")
  // alone would lock out admin, the role that runs this app.
  const user = await requireRole("admin", "it_staff", "purchasing_staff");
  const sp = await searchParams;
  const idsParam = allParams(sp.ids).join(",");
  const ids = [...new Set(idsParam.split(",").map((s) => s.trim()).filter(Boolean))];
  const tagsRaw = allParams(sp.tags).join("\n");
  const tags = tagsRaw.trim() ? parseTagPaste(tagsRaw) : [];
  const start = clampStart(firstParam(sp.start));
  const just = firstParam(sp.just)?.trim() || undefined;
  const older = firstParam(sp.older) === "1";
  const docsFailed = Number.parseInt(firstParam(sp.docsFailed) ?? "", 10);
  // Plan P-6: the ticked batches; `?just=` (Register's landing) ticks its own.
  const picked = new Set([...allParams(sp.pick).map((s) => s.trim()).filter(Boolean), ...(just ? [just] : [])]);
  // Ruling R20: what the queue lists and what prints is the classes this role
  // MANAGES plus any asset whose purchase record this user created —
  // Purchasing registers IT laptops (Phase 14) and lands here with that batch
  // ticked, so it can print those, but never IT's own batches.
  const manageable = MANAGEABLE_CLASSES[user.role];
  const scope = labelScope(manageable, user.id);
  // The class the operator came from — only for the crumb and the tabs; what
  // prints is scoped by `scope` below (plan P-9; ruling R21). Every link
  // in carries `?cls=` for Purchasing; without it, infer: a role that manages
  // one class means that class, else the class of the resolved assets when
  // they are all one class (decided once they are loaded), else IT.
  const explicitCls = parseCls(firstParam(sp.cls));
  const roleCls: AssetClass | null = manageable.length === 1 ? manageable[0] : null;
  const crumbFor = (cls: AssetClass) => {
    const listHref = "/inventory" + withClsQS("", cls);
    const listLabel = cls === "PURCHASING" ? "Purchasing assets" : "Inventory";
    return [{ label: listLabel, href: listHref }, { label: "Labels" }];
  };
  const waiting = await queueCount(manageable, user.id);

  // Refuse, never slice (the defect §8 records for the export route's ?ids=).
  // The same sentence for a pasted list as for a selection (spec §10).
  const refusal = (asked: number) => {
    const cls = explicitCls ?? roleCls ?? "IT";
    return (
      <>
        <PageHeader title="New equipment" breadcrumb={crumbFor(cls)} />
        <NewEquipmentTabs active="labels" cls={cls} waiting={waiting} />
        <Banner tone="fault" title={`That selection is ${asked} assets, over the ${BULK_MAX}-asset label cap. Narrow the selection and try again. Nothing was printed.`} />
        {tags.length > 0 && (
          <div className="pt-4"><TagsBox mode="tags" tags={tagsRaw} start={start} cls={cls} /></div>
        )}
      </>
    );
  };
  if (ids.length + tags.length > BULK_MAX) return refusal(ids.length + tags.length);

  const queue = await labelQueue(manageable, user.id, older ? 500 : 50);
  const pickedGroups = queue.groups.filter((g) => picked.has(g.recordId ?? g.key));
  const queuedIds = pickedGroups.flatMap((g) => g.assetIds);
  const select = { id: true, tag: true, model: true, cls: true, category: { select: { name: true } } } as const;
  const [queuedAssets, idAssets, tagAssets, justAssets] = await Promise.all([
    queuedIds.length ? prisma.asset.findMany({ where: { id: { in: queuedIds }, ...scope }, select }) : [],
    ids.length ? prisma.asset.findMany({ where: { id: { in: ids }, ...scope }, select, orderBy: { tag: "asc" } }) : [],
    tags.length ? prisma.asset.findMany({ where: { tag: { in: tags }, ...scope }, select }) : [],
    just
      ? prisma.asset.findMany({ where: { purchaseRecordId: just, ...scope }, select: { category: { select: { name: true } } }, orderBy: { tag: "asc" } })
      : [],
  ]);

  const toRow = (a: (typeof idAssets)[number]): SheetRow => ({ id: a.id, tag: a.tag, model: a.model, category: a.category.name, cls: a.cls });
  // Group order, then tag order within a group (the queue already sorts each group's ids by tag).
  const queuedById = new Map(queuedAssets.map((a) => [a.id, a]));
  const queuedAll = queuedIds.flatMap((id) => { const a = queuedById.get(id); return a ? [toRow(a)] : []; });
  const tagById = new Map(tagAssets.map((a) => [a.tag, a]));
  // The typed (or scanned) order is the order the stickers come off the sheet.
  const tagFound = tags.flatMap((t) => { const a = tagById.get(t); return a ? [toRow(a)] : []; });
  const skipped = tags.filter((t) => !tagById.has(t));
  // Plan P-6: picked records, then `ids`, then `tags`, each tag once.
  const seen = new Set<string>();
  const once = (list: SheetRow[]) => list.filter((r) => (seen.has(r.tag) ? false : (seen.add(r.tag), true)));
  const queuedRows = once(queuedAll);
  const rows = [...queuedRows, ...once(idAssets.map(toRow)), ...once(tagFound)];
  if (rows.length > BULK_MAX) return refusal(rows.length);

  const rowClasses = [...new Set(rows.map((r) => r.cls))];
  const cls: AssetClass = explicitCls ?? roleCls ?? (rowClasses.length === 1 ? rowClasses[0] : "IT");

  // Every link on the page keeps the whole query and changes one thing (`pick` repeats).
  const hrefWith = (patch: Record<string, string>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (!(k in patch)) for (const one of allParams(v)) q.append(k, one);
    for (const [k, v] of Object.entries(patch)) q.set(k, v);
    return `/inventory/labels?${q.toString()}`;
  };

  const sheets = labelSlots(rows.map((r) => r.tag), start).length;
  const missing = ids.length - idAssets.length;
  const base = qrBase(process.env.APP_BASE_URL);
  const justInQueue = just ? queue.groups.some((g) => g.recordId === just) : false;
  const justNoun = justAssets.length ? categoryNoun(justAssets[0].category.name, justAssets.length) : "";

  return (
    <>
      <div className="print:hidden">
        <PageHeader title="New equipment" breadcrumb={crumbFor(cls)} />
        <NewEquipmentTabs active="labels" cls={cls} waiting={waiting} />
        <div className="flex flex-col gap-2 pb-4 empty:hidden">
          {docsFailed > 0 && (
            <Banner tone="attention" title={`${plural(docsFailed, "document")} could not be attached.`}>
              The assets are registered. Add the missing {docsFailed === 1 ? "file" : "files"} from each asset&apos;s Documents tab.
            </Banner>
          )}
          {justAssets.length > 0 && (
            <Banner
              tone="settled"
              title={`${justAssets.length} ${justNoun} registered — ${justInQueue ? "their labels are ticked below." : "their labels have been printed."}`}
            />
          )}
          {/* A stale selection must not silently print fewer stickers than the
              operator counted. Cause-neutral: `ids.length - idAssets.length`
              counts an id whose asset was not found, or whose class this role
              cannot print (ruling R20) — "could not be printed" covers both. */}
          {missing > 0 && (
            <Banner tone="attention" title={`${missing} selected asset${missing === 1 ? "" : "s"} could not be printed and ${missing === 1 ? "was" : "were"} skipped.`} />
          )}
          {/* Rule 10: a sheet without QR codes looks finished and is not. The
              plain sentence is for everyone; the precise cause is for the one
              role that can fix it. */}
          {rows.length > 0 && !base.ok && (
            <Banner tone="attention" title="No QR on these labels — the app's address is set to this computer only. Ask the administrator to set the network address.">
              {user.role === "admin" && (
                <details className="mt-1.5">
                  <summary className="cursor-pointer text-fg-secondary">Why</summary>
                  <p className="mt-1 font-mono text-xs">{QR_NOTE[base.reason]}</p>
                </details>
              )}
            </Banner>
          )}
          {rows.length > 0 && (
            <Banner tone="neutral" title="Before you print">
              Set <span className="font-mono">Scale: 100%</span>,{" "}
              <span className="font-mono">Margins: None</span>, and{" "}
              <span className="font-mono">Paper size: A4</span> in the print dialog. Then measure the{" "}
              {CALIBRATION_MM}mm bar on the sheet — if it is short, one of those three settings is
              wrong and the stickers will not line up.
            </Banner>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-start gap-6 print:block">
        <div className="flex min-w-[300px] max-w-[520px] flex-1 flex-col gap-4 print:hidden">
          <LabelQueueForm
            groups={queue.groups}
            more={queue.more && !older}
            picked={picked}
            cls={cls}
            ids={ids.join(",")}
            older={older}
            olderHref={hrefWith({ older: "1" })}
            now={new Date()}
          >
            <div className="flex flex-col gap-2 pt-2">
              <div>
                <h2 className="text-sm font-semibold text-fg">Reprint other tags</h2>
                <p className="text-xs text-fg-muted">Tags entered here go on the sheet too, even if they were printed before.</p>
              </div>
              <TagsBox mode="tags" tags={tags.join("\n")} start={start} cls={cls} inForm />
            </div>
          </LabelQueueForm>
          <div className="flex flex-col gap-2 border-t border-border pt-4">
            <div role="group" aria-labelledby="start-sticker" className="flex items-center gap-2">
              <span id="start-sticker" className="text-xs font-medium text-fg">Start at sticker</span>
              <StepLink to={start - 1} href={hrefWith({ start: String(start - 1) })} label="Earlier sticker">−</StepLink>
              <span className="min-w-6 text-center font-mono text-sm text-fg">{start}</span>
              <StepLink to={start + 1} href={hrefWith({ start: String(start + 1) })} label="Later sticker">+</StepLink>
              <span className="text-[11px] text-fg-muted">or click a sticker on the sheet</span>
            </div>
            {/* The reprint paths' own count lines, as before Phase 34. */}
            {tags.length > 0 && (
              <p className="font-mono text-[11px] text-fg-muted">{`${plural(tagFound.length, "label")} · ${skipped.length} skipped`}</p>
            )}
            {tags.length === 0 && ids.length > 0 && (
              <p className="font-mono text-[11px] text-fg-muted">{`${plural(rows.length, "label")} · ${plural(sheets, "sheet")}`}</p>
            )}
            {skipped.length > 0 && (
              <p className="font-mono text-[11px] text-fg-secondary">{skipped.join(", ")} — not found or not your class</p>
            )}
            <p className="text-[13px] text-fg">{summaryLine(rows.length, start, sheets)}</p>
            <div className="flex flex-wrap gap-2">
              <PrintLabelsButton count={rows.length} queuedAssetIds={queuedRows.map((r) => r.id)} />
              <ButtonLink href={"/inventory/register" + withClsQS("", cls)}>Register more</ButtonLink>
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          {/* Plan P-7: the printable sheet itself, half size on screen only. */}
          <div className="label-preview" style={{ "--sheets": Math.max(1, sheets) } as CSSProperties}>
            {/* Read here rather than inside the component: this is a Server
                Component and the sheet is a pure render of its props, which is what
                keeps label-sheet.tsx drivable from Playwright without stubbing an
                environment. `qrBase` decides whether the value is usable; an unset
                or loopback APP_BASE_URL prints the barcode alone plus a note
                naming the cause, never a dead QR. */}
            <LabelSheet rows={rows} baseUrl={process.env.APP_BASE_URL} startAt={start} startHref={(n) => hrefWith({ start: String(n) })} />
          </div>
          <p className="text-[11px] text-fg-muted print:hidden">A4 · 3 × 4 stickers · about half size</p>
        </div>
      </div>
    </>
  );
}
