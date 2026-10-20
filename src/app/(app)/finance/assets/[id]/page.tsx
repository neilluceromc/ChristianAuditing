import type { Metadata } from "next";
import Link from "next/link";
import { pageTitle } from "@/lib/page-title";
import { assetTagFor } from "@/server/page-titles";
import { notFound } from "next/navigation";
import { requireRole } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { financeAssetDetail } from "@/server/modules/finance/asset-detail";
import { assetAttachments, assetNotes } from "@/server/modules/assets/queries";
import { CLASS_LABEL, STATUS_LABEL } from "@/lib/asset-class";
import { asOfMonth } from "@/lib/depreciation";
import { lifeLabel } from "@/lib/depreciation-input";
import { coveredByLabel } from "@/lib/purchase-summary";
import { fmtDate, fmtMoneyExact } from "@/lib/format";
import { toSearchParams } from "@/lib/url-state";
import { pathAllowedForRole } from "@/lib/workspaces";
import { canPostOnAsset } from "@/lib/asset-notes";
import { buildHistory } from "@/lib/finance-history";
import { defaultLedgerYear, ledgerMonths, ledgerYears } from "@/lib/finance-ledger";
import { assetPageHref, lifeSummary, noScheduleReason, parseAssetPageState } from "@/lib/finance-asset-page";
import { PageHeader } from "@/components/ui/page-header";
import { ButtonLink } from "@/components/ui/button-link";
import { ReviewBox } from "@/components/finance/review-box";
import { ListNavigationProvider, ListPendingRegion } from "@/components/patterns/list-navigation";
import { AssetPanel } from "@/components/finance/asset/asset-panel";
import { AssetTabs } from "@/components/finance/asset/asset-tabs";
import { LedgerCards, LedgerTab } from "@/components/finance/asset/ledger-tab";
import { HistoryTab } from "@/components/finance/asset/history-tab";
import { NotesTab } from "@/components/assets/notes-tab";
import { AttachmentsTab } from "@/components/assets/attachments-tab";
import { DocPreview } from "@/components/assets/doc-preview";
import { SettingsButton } from "./settings-button";

const peso = (c: number | null | undefined) => (c === null || c === undefined ? "Not recorded" : fmtMoneyExact(c / 100));
const text = (v: string | null | undefined) => (v ? v : "Not recorded");

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: pageTitle((await assetTagFor(id)) ?? "Asset") };
}

/**
 * Phase 47 (spec §4, mockup Option B · Ledger): the Finance asset page. The left panel (identity, life, Asset and
 * Documents cards) and the main column — a document preview when one is open, then four underlined tabs: the
 * Depreciation ledger (with the Purchase, Cost breakdown and Depreciation cards), Notes, Attachments and Financial
 * history. Every tab, year, filter, page and preview is in the URL (`parseAssetPageState`); the hrefs are built here.
 */
export default async function FinanceAssetPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireRole("admin", "finance_staff");
  const { id } = await params;
  const state = parseAssetPageState(toSearchParams(await searchParams));
  // one clock for the whole page: the detail, the ledger's "this month" and the history agree across a month boundary
  const now = new Date();
  const d = await financeAssetDetail(id, now);
  if (!d) notFound();

  // Only the open tab's shared notes or attachments are read; the badges come from the detail's counts.
  const [extra, threads, attachments] = await Promise.all([
    prisma.asset.findUnique({
      where: { id },
      select: {
        depreciationNote: true,
        category: { select: { depreciationLifeMonths: true, depreciationSalvagePercent: true } },
        assignee: { select: { id: true, department: { select: { name: true } } } },
      },
    }),
    state.tab === "notes" ? assetNotes(id) : Promise.resolve([]),
    state.tab === "files" ? assetAttachments(id) : Promise.resolve([]),
  ]);
  const catLife = extra?.category.depreciationLifeMonths ?? null;
  const catPct = extra?.category.depreciationSalvagePercent === null || extra?.category.depreciationSalvagePercent === undefined
    ? null
    : Number(extra.category.depreciationSalvagePercent);

  const dept = CLASS_LABEL[d.cls];
  const hasCost = d.costC !== null;
  const capitalised = d.result !== null;
  const crumbHref = d.cls === "PURCHASING" ? "/finance/assets?cls=PURCHASING" : "/finance/assets";
  const canPost = canPostOnAsset(user.role, d.cls);

  // ledger (spec §4.2): read from the engine's lifeYears through finance-ledger.ts
  const asOf = asOfMonth(now);
  const years = ledgerYears(d.years, asOf);
  const selected: number | "all" = state.year === "all"
    ? "all"
    : state.year !== null && years.some((y) => y.year === state.year)
      ? state.year
      : defaultLedgerYear(d.years, asOf) ?? "all";
  const lifeYear = selected === "all" ? null : d.years.find((y) => y.year === selected) ?? null;
  const months = lifeYear ? ledgerMonths(lifeYear, d.years, asOf) : null;
  const emptyReason = years.length ? null : noScheduleReason({ notCapitalised: d.notCapitalised, costC: d.costC, approvedAt: d.approvedAt, note: d.note });

  // the document open in the preview: only one of this asset's own document slots
  const openDoc = state.doc ? d.docs.find((x) => x.file?.id === state.doc) ?? null : null;
  const holderId = extra?.assignee?.id ?? null;

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Assets", href: crumbHref }, { label: d.tag }]}
        actions={
          <>
            {capitalised && d.costC !== null && (
              <SettingsButton
                asset={{
                  id: d.id, tag: d.tag, costC: d.costC,
                  startMonth: d.result?.startMonth ?? null,
                  custom: d.custom, lifeMonths: d.lifeMonths, salvageC: d.salvageC,
                  note: extra?.depreciationNote ?? null,
                  categoryText: catLife === null ? `${d.category}: no policy` : `${d.category}: ${lifeLabel(catLife)}, ${catPct ?? 0}% salvage`,
                  categoryLife: catLife, categorySalvagePercent: catPct,
                }}
              />
            )}
            <ButtonLink native href={`/finance/assets/${d.id}/export`}>Export</ButtonLink>
          </>
        }
      />

      {(d.reg === "with-finance" || d.reg === "needs-correction") && (
        <div className="mb-4">
          {d.reg === "with-finance" ? (
            <ReviewBox id={d.id} tag={d.tag} hasCost={hasCost} reply={d.resubmitNote} deptLabel={dept} />
          ) : (
            <p className="text-[13px] text-fg-secondary">
              Sent back to {dept}
              {d.returnSummary.items.length > 0 ? `: ${d.returnSummary.items.join(", ")}` : ""}
              {d.returnSummary.note ? ` — “${d.returnSummary.note}”` : ""}
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        <AssetPanel
          id={d.id}
          state={state}
          tag={d.tag}
          model={d.model}
          category={d.category}
          serial={d.serial}
          status={d.status}
          statusLabel={STATUS_LABEL[d.status]}
          reg={d.reg}
          regLabel={d.regFinanceLabel}
          notCapitalised={d.notCapitalised}
          life={lifeSummary(d.result, d.monthsUsed)}
          costC={d.costC}
          lifeNote={emptyReason ?? d.note}
          holder={d.holder ? { name: d.holder, href: holderId && pathAllowedForRole("/employees", user.role) ? `/employees/${holderId}` : null } : null}
          worksFor={extra?.assignee?.department.name ?? null}
          docs={d.docs}
        />

        <ListNavigationProvider>
          <div className="flex min-w-0 flex-col gap-4">
            {openDoc?.file && (
              <DocPreview
                assetId={d.id}
                doc={openDoc.file}
                title={openDoc.title}
                closeHref={assetPageHref(d.id, state, { doc: null })}
              />
            )}
            <AssetTabs
              id={d.id}
              state={state}
              lifeMonths={years.length ? d.lifeMonths : null}
              noteCount={d.noteCount}
              openNoteCount={d.openNoteCount}
              attachmentCount={d.attachmentCount}
              historyCount={d.audit.length + d.depLines.length}
            />
            <ListPendingRegion className="flex flex-col gap-4">
              {state.tab === "ledger" && (
                <>
                  <LedgerTab id={d.id} state={state} years={years} selected={selected} months={months} emptyReason={emptyReason} />
                  <LedgerCards
                    purchase={[
                      {
                        label: "Purchase request",
                        value: d.purchase.pr
                          ? <Link href={`/purchases/${d.purchase.pr.id}`} className="text-accent hover:underline">{d.purchase.pr.refNo}</Link>
                          : "Not recorded",
                      },
                      { label: "Requested by", value: text(d.purchase.requestedBy) },
                      { label: "Supplier", value: text(d.purchase.supplier) },
                      { label: "Invoice no.", value: text(d.purchase.invoiceRef) },
                      { label: "OR no.", value: text(d.purchase.receiptRef) },
                      { label: "Purchase date", value: d.purchase.purchasedAt ? fmtDate(d.purchase.purchasedAt) : "Not recorded" },
                      { label: "Warranty until", value: d.purchase.warrantyUntil ? fmtDate(d.purchase.warrantyUntil) : "Not recorded" },
                      { label: "Covered by", value: text(d.purchase.coveredBy && coveredByLabel(d.purchase.coveredBy)) },
                    ]}
                    cost={[
                      { label: "Purchase price", value: peso(d.cost.priceC), mono: true },
                      {
                        label: "Delivery and fees",
                        value: d.cost.feesC === null
                          ? "Not recorded"
                          : `${fmtMoneyExact(d.cost.feesC / 100)}${d.cost.feesUnits !== null && d.cost.feesUnits > 1 ? ` for the whole delivery of ${d.cost.feesUnits}` : ""}`,
                        mono: true,
                      },
                      { label: "Salvage value", value: d.cost.salvageC === null ? "—" : peso(d.cost.salvageC), mono: true },
                      { label: "Depreciable base", value: d.cost.baseC === null ? "—" : peso(d.cost.baseC), mono: true },
                    ]}
                    depreciation={[
                      { label: "Method", value: "Straight-line" },
                      { label: "Policy", value: d.policyText },
                      { label: "Useful life", value: d.lifeMonths !== null ? lifeLabel(d.lifeMonths) : "—" },
                      { label: "Starts", value: d.startLabel ?? "—" },
                      { label: "Ends", value: d.endLabel ?? "—" },
                      { label: "Per month", value: d.result?.monthly ? peso(d.result.monthly) : "—", mono: true },
                      {
                        label: "Override",
                        value: d.custom && d.lifeMonths !== null && d.salvageC !== null
                          ? `${lifeLabel(d.lifeMonths)}, ${fmtMoneyExact(d.salvageC / 100)} salvage${extra?.depreciationNote ? ` — ${extra.depreciationNote}` : ""}`
                          : "None",
                      },
                      {
                        label: "Approved",
                        value: d.approvedAt ? `${d.approvedBy ?? "Unknown"} on ${fmtDate(d.approvedAt)}` : "Not yet approved",
                      },
                    ]}
                  />
                </>
              )}
              {state.tab === "notes" && <NotesTab assetId={d.id} threads={threads} canPost={canPost} />}
              {state.tab === "files" && (
                <AttachmentsTab
                  assetId={d.id}
                  attachments={attachments}
                  canUpload={canPost}
                  kind={state.ak}
                  selectedId={state.att}
                  hrefFor={(patch) => assetPageHref(d.id, state, { tab: "files", ...patch })}
                />
              )}
              {state.tab === "history" && (
                <HistoryTab
                  id={d.id}
                  state={state}
                  history={buildHistory(
                    d.audit,
                    d.depLines,
                    { kind: state.hk, person: state.hw ?? undefined, page: state.hp },
                    { assetTag: d.tag, categoryName: d.category, purchaseUnits: d.purchaseUnits, names: d.historyNames },
                  )}
                />
              )}
            </ListPendingRegion>
          </div>
        </ListNavigationProvider>
      </div>
    </>
  );
}
