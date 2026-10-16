import { notFound } from "next/navigation";
import { requireRole } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { financeAssetDetail } from "@/server/modules/finance/asset-detail";
import { CLASS_LABEL } from "@/lib/asset-class";
import { lifeLabel } from "@/lib/depreciation-input";
import { fmtDate, fmtDateTime, fmtMoneyExact } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status";
import { ButtonLink } from "@/components/ui/button-link";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DescriptionList } from "@/components/ui/description-list";
import { ProgressBar } from "@/components/ui/progress-bar";
import { ReviewBox } from "@/components/finance/review-box";
import { SettingsButton } from "./settings-button";
import { YearSchedule } from "./year-schedule";

const peso = (c: number | null) => (c === null ? "Not recorded" : fmtMoneyExact(c / 100));
const text = (v: string | null | undefined) => (v ? v : "Not recorded");

export default async function FinanceAssetPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("admin", "finance_staff");
  const { id } = await params;
  const d = await financeAssetDetail(id);
  if (!d) notFound();

  const extra = await prisma.asset.findUnique({
    where: { id },
    select: {
      depreciationNote: true,
      category: { select: { depreciationLifeMonths: true, depreciationSalvagePercent: true } },
    },
  });
  const catLife = extra?.category.depreciationLifeMonths ?? null;
  const catPct = extra?.category.depreciationSalvagePercent === null || extra?.category.depreciationSalvagePercent === undefined
    ? null
    : Number(extra.category.depreciationSalvagePercent);

  const dept = CLASS_LABEL[d.cls];
  const hasCost = d.costC !== null;
  const capitalised = d.result !== null;
  const subtitle = [d.model, d.category, dept, d.serial ? `S/N ${d.serial}` : null, d.holder].filter(Boolean).join(" · ");
  const crumbHref = d.cls === "PURCHASING" ? "/finance/assets?cls=PURCHASING" : "/finance/assets";
  const policyLabel = d.custom
    ? "Custom override"
    : d.lifeMonths !== null ? "Category policy" : "No policy";

  return (
    <>
      <PageHeader
        title={d.tag}
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
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-fg-secondary">
          <span>{subtitle}</span>
          <StatusPill value={d.status} />
          {d.reg === "registered" && d.notCapitalised ? (
            <span className="text-xs text-fg-secondary">Not capitalised</span>
          ) : (
            <StatusPill ns="registration" value={d.reg} label={d.regFinanceLabel} />
          )}
        </div>

        {d.reg === "with-finance" && (
          <ReviewBox id={d.id} tag={d.tag} hasCost={hasCost} reply={d.resubmitNote} deptLabel={dept} />
        )}

        {d.reg === "needs-correction" && (
          <p className="text-[13px] text-fg-secondary">
            Sent back to {dept}
            {d.returnSummary.items.length > 0 ? `: ${d.returnSummary.items.join(", ")}` : ""}
            {d.returnSummary.note ? ` — “${d.returnSummary.note}”` : ""}
          </p>
        )}

        <Card>
          <CardHeader title="Money summary" />
          <CardBody>
            {!capitalised ? (
              <p className="text-[13px] text-fg-secondary">{d.note}</p>
            ) : (
              <div className="flex flex-col gap-3">
                <DescriptionList
                  items={[
                    { label: "Cost", value: peso(d.costC), mono: true },
                    { label: "Depreciation to date", value: peso(d.result!.accumulated), mono: true },
                    { label: "Book value", value: peso(d.result!.bookValue), mono: true },
                    { label: "Monthly amount", value: d.result!.monthly === null ? "—" : peso(d.result!.monthly), mono: true },
                    { label: "Salvage", value: d.salvageC === null ? "—" : peso(d.salvageC), mono: true },
                  ]}
                />
                {d.note && <p className="text-xs text-fg-muted">{d.note}</p>}
                {d.monthsUsed !== null && d.lifeMonths !== null && (
                  <div className="flex flex-col gap-1.5">
                    <ProgressBar value={d.monthsUsed} max={d.lifeMonths} label="Months used" />
                    <p className="font-mono text-[11px] text-fg-muted">
                      {d.monthsUsed} of {d.lifeMonths} months · {d.startLabel} → {d.endLabel} · as of today ({d.asOfLabel} counted)
                    </p>
                  </div>
                )}
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Purchase" />
          <CardBody>
            <DescriptionList
              items={[
                {
                  label: "Purchase request",
                  value: d.pr ? (
                    <a href={`/purchases/${d.pr.id}`} className="text-accent hover:underline">
                      {d.pr.refNo} · {fmtMoneyExact(d.pr.totalC / 100)}
                    </a>
                  ) : "Not recorded",
                },
                { label: "Requested by", value: text(d.pr?.requester) },
                { label: "Vendor", value: text(d.vendor) },
                { label: "Invoice no.", value: text(d.invoiceRef) },
                { label: "OR no.", value: text(d.receiptRef) },
                { label: "Purchase date", value: d.purchasedAt ? fmtDate(d.purchasedAt) : "Not recorded" },
                { label: "Delivery and fees", value: peso(d.feesC) },
                { label: "Warranty until", value: d.warrantyUntil ? fmtDate(d.warrantyUntil) : "Not recorded" },
                { label: "Covered by", value: text(d.coveredBy) },
                { label: "Who to call", value: text(d.contact) },
              ]}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Capitalization & depreciation" />
          <CardBody>
            <DescriptionList
              items={[
                {
                  label: "Approved by",
                  value: d.approvedAt ? `${d.approvedBy ?? "Unknown"} on ${fmtDate(d.approvedAt)}` : "Not yet approved",
                },
                { label: "Starts", value: d.startLabel ?? "—" },
                { label: "Ends", value: d.endLabel ?? "—" },
                { label: "Method", value: "Straight-line" },
                { label: "Basis", value: capitalised ? `${policyLabel} — ${d.policyText}` : d.policyText },
                {
                  label: "Override",
                  value: d.custom && d.lifeMonths !== null && d.salvageC !== null
                    ? `${lifeLabel(d.lifeMonths)}, ${fmtMoneyExact(d.salvageC / 100)} salvage${extra?.depreciationNote ? ` — ${extra.depreciationNote}` : ""}`
                    : "None",
                },
              ]}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Documents" />
          <CardBody>
            <ul className="flex flex-col gap-1.5">
              {d.docs.map((doc, i) => (
                <li key={`${doc.kind}-${i}`} className="flex items-baseline gap-3 text-[13px]">
                  <span className="w-[140px] shrink-0 text-[11px] text-fg-muted">{doc.title}</span>
                  {doc.file ? (
                    <a href={`/inventory/${d.id}/documents/${doc.file.id}/download`} className="text-accent hover:underline">
                      {doc.file.fileName}
                    </a>
                  ) : (
                    <span className="text-fg-muted">Not uploaded</span>
                  )}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>

        {capitalised && d.years.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="text-[15px] font-semibold text-fg">Depreciation schedule</h2>
            <YearSchedule years={d.years} />
          </section>
        )}

        <Card>
          <CardHeader title="Financial history" />
          <CardBody>
            {d.history.length === 0 ? (
              <p className="text-[13px] text-fg-muted">Nothing recorded yet.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {d.history.map((h, i) => (
                  <li key={i} className="flex items-baseline gap-3 text-[13px] text-fg-secondary">
                    <span className="w-[130px] shrink-0 font-mono text-[11px] text-fg-muted">{fmtDateTime(h.at)}</span>
                    <span>{h.sentence}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
