import type { AssetClass, AssetStatus, Role } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { auditSentence } from "@/lib/activity";
import { depLines, isFinanceRelevant, type AuditRow, type DepLine } from "@/lib/finance-history";
import {
  asOfMonth, depStartMonth, depreciate, lifeYears, monthLabel, resolvePolicy, stateNote, toCentavos, type DepResult, type LifeYear,
} from "@/lib/depreciation";
import { lifeLabel } from "@/lib/depreciation-input";
import { fmtMoneyExact } from "@/lib/format";
import { REG_LABEL_FINANCE, registrationState, returnSummary, type RegState } from "@/lib/registration";

/** The four document slots of a registration (copied from the client-only document-slots.tsx, which server code cannot import). */
const SLOT_KINDS: ReadonlyArray<{ kind: string; title: string }> = [
  { kind: "invoice", title: "Sales invoice" },
  { kind: "official-receipt", title: "Official receipt" },
  { kind: "warranty-slip", title: "Warranty slip" },
  { kind: "delivery-receipt", title: "Delivery receipt" },
];

export interface FinanceAssetDetail {
  id: string; tag: string; model: string; brand: string | null; serial: string | null;
  cls: AssetClass; status: AssetStatus; category: string; holder: string | null;
  reg: RegState; regFinanceLabel: string;
  returnSummary: { items: string[]; note: string | null }; resubmitNote: string | null;
  approvedBy: string | null; approvedAt: Date | null; notCapitalised: boolean;
  costC: number | null; result: DepResult | null; note: string | null; policyText: string; custom: boolean;
  lifeMonths: number | null; salvageC: number | null;
  startLabel: string | null; endLabel: string | null; monthsUsed: number | null; asOfLabel: string;
  pr: { id: string; refNo: string; requester: string; totalC: number } | null;
  vendor: string | null; invoiceRef: string | null; receiptRef: string | null; purchasedAt: Date | null; feesC: number | null;
  warrantyUntil: Date | null; coveredBy: string | null; contact: string | null;
  docs: Array<{ kind: string; title: string; file: { id: string; fileName: string; size: number | null } | null }>;
  years: LifeYear[];
  history: Array<{ at: Date; sentence: string }>;
  /**
   * Phase 47 (spec §4.2 ruling): agrees with the engine — the depreciable base is cost − salvage; the purchase
   * record's fees never depreciate, so there is no "total acquisition cost". `feesUnits` > 1 reads "for the whole
   * delivery of N". Null salvage/base when there is no cost, it is not capitalised, or there is no policy.
   */
  cost: { priceC: number | null; feesC: number | null; feesUnits: number | null; salvageC: number | null; baseC: number | null };
  /** Phase 47 (spec §4.2): the Purchase card. */
  purchase: {
    pr: { id: string; refNo: string } | null; requestedBy: string | null; supplier: string | null;
    invoiceRef: string | null; receiptRef: string | null; purchasedAt: Date | null; warrantyUntil: Date | null; coveredBy: string | null;
  };
  /** Phase 47 (spec §4.5): finance-relevant audit rows of the asset, its purchase record and its category policy, newest first. */
  audit: AuditRow[];
  /** Phase 47 (spec §4.5): one derived System line per depreciation month counted. */
  depLines: DepLine[];
  /** Units the purchase record covered (history's "Purchase record (N units)"). */
  purchaseUnits: number | null;
  /** Phase 47: note threads, and the unresolved ones (the Notes badge is amber while any is open). */
  noteCount: number; openNoteCount: number;
  /** Phase 47: `attachment:*` documents (the Attachments tab; they are not document slots). */
  attachmentCount: number;
}

export async function financeAssetDetail(id: string, now: Date = new Date()): Promise<FinanceAssetDetail | null> {
  const a = await prisma.asset.findUnique({
    where: { id },
    include: {
      category: true,
      assignee: { select: { name: true } },
      vendor: { select: { name: true } },
      purchaseRequest: {
        select: { id: true, refNo: true, requestedBy: { select: { name: true } }, units: { select: { qty: true, unitPrice: true } } },
      },
      purchaseRecord: { select: { id: true, fees: true, quantity: true } },
      documents: { select: { id: true, kind: true, fileName: true, size: true, createdAt: true }, orderBy: { createdAt: "asc" } },
      financeConfirmedBy: { select: { name: true } },
    },
  });
  if (!a) return null;

  const asOf = asOfMonth(now);
  const reg = registrationState(a);
  const costC = toCentavos(a.cost);
  const salvageC = toCentavos(a.depreciationSalvage);
  const catSalvage = a.category.depreciationSalvagePercent === null ? null : Number(a.category.depreciationSalvagePercent);
  const capitalised = costC !== null && !a.financeNotCapitalised;
  const policy = capitalised
    ? resolvePolicy(
        { cost: costC, lifeMonths: a.depreciationLifeMonths, salvage: salvageC },
        { lifeMonths: a.category.depreciationLifeMonths, salvagePercent: catSalvage },
      )
    : null;
  const depStart = depStartMonth({ purchasedAt: a.purchasedAt, financeConfirmedAt: a.financeConfirmedAt });
  const result = capitalised ? depreciate(costC, depStart, policy, asOf) : null;
  const note = result ? stateNote(result, a.category.name) : a.financeNotCapitalised ? "Not capitalised" : "No cost recorded";

  let policyText: string;
  if (!capitalised) policyText = a.financeNotCapitalised ? "Not capitalised" : "No cost recorded";
  else if (!policy) policyText = `No policy for ${a.category.name}`;
  else if (policy.basis === "custom") {
    policyText = `Custom · ${lifeLabel(policy.lifeMonths)}, ${fmtMoneyExact(policy.salvage / 100)} salvage${a.depreciationNote ? ` — ${a.depreciationNote}` : ""}`;
  } else {
    policyText = `${a.category.name} policy · ${lifeLabel(policy.lifeMonths)}, ${catSalvage ?? 0}% salvage`;
  }

  const start = result?.startMonth ?? null;
  const startOk = policy && start !== null;
  const monthsUsed = startOk ? Math.min(Math.max(asOf - start + 1, 0), policy.lifeMonths) : null;

  const prTotalC = a.purchaseRequest
    ? a.purchaseRequest.units.reduce((sum, u) => sum + (toCentavos(u.unitPrice) ?? 0) * u.qty, 0)
    : 0;

  type DocFile = { id: string; fileName: string; size: number | null };
  const bySlot = new Map<string, DocFile>();
  const others: Array<{ kind: string; title: string; file: DocFile | null }> = [];
  let attachmentCount = 0;
  for (const d of a.documents) {
    const file = { id: d.id, fileName: d.fileName, size: d.size };
    if (d.kind.startsWith("attachment:")) attachmentCount++; // the Attachments tab's, not a document slot
    else if (SLOT_KINDS.some((s) => s.kind === d.kind)) bySlot.set(d.kind, file); // newest wins
    else others.push({ kind: "other", title: d.kind === "other" ? "Other" : d.kind, file });
  }
  const docs = [...SLOT_KINDS.map((s) => ({ kind: s.kind, title: s.title, file: bySlot.get(s.kind) ?? null })), ...others];

  const [audits, notes] = await Promise.all([
    prisma.auditEntry.findMany({
      where: {
        OR: [
          {
            entityType: "asset", entityId: a.id,
            OR: [
              { action: { in: ["create", "register", "update", "it.verify", "import-create", "import-update"] } },
              { action: { startsWith: "finance." } },
              { action: { startsWith: "depreciation." } },
              { action: { startsWith: "document." } },
              { action: { startsWith: "attachment." } },
              { action: { startsWith: "note." } },
              { action: { startsWith: "asset-note." } },
            ],
          },
          // Phase 47 (spec §4.5): the purchase record's entries, where the purchase and its fees are recorded
          ...(a.purchaseRecord ? [{ entityType: "purchase-record", entityId: a.purchaseRecord.id }] : []),
          { entityType: "asset-category", entityId: a.categoryId, action: "depreciation.policy" },
        ],
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, actorId: true, actorLabel: true, entityType: true, entityId: true, action: true, diff: true,
        source: true, reason: true, createdAt: true,
      },
    }),
    prisma.assetNote.findMany({ where: { assetId: a.id }, select: { parentId: true, resolvedAt: true } }),
  ]);

  // The signed-in account and role of each actor (AuditEntry keeps only the id and a display name).
  const actorIds = [...new Set(audits.map((e) => e.actorId).filter((x): x is string => x !== null))];
  const actors = actorIds.length
    ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, email: true, role: true } })
    : [];
  const actorById = new Map<string, { email: string; role: Role }>(actors.map((u) => [u.id, { email: u.email, role: u.role }]));
  const audit: AuditRow[] = audits.filter(isFinanceRelevant).map((e) => ({
    ...e,
    actorEmail: e.actorId ? actorById.get(e.actorId)?.email ?? null : null,
    actorRole: e.actorId ? actorById.get(e.actorId)?.role ?? null : null,
  }));

  // Today's page's short list (kept until Task 7 rebuilds the page): the same actions it always read.
  const history = audits
    .filter((e) => ["register", "update", "it.verify"].includes(e.action) || e.action.startsWith("finance.")
      || e.action.startsWith("depreciation."))
    .filter((e) => e.action !== "update" || (e.diff !== null && typeof e.diff === "object" && "cost" in (e.diff as object)))
    .slice(0, 50)
    .map((e) => ({
      at: e.createdAt,
      sentence: auditSentence({
        actorLabel: e.actorLabel, action: e.action, diff: e.diff,
        entityLabel: e.entityType === "asset-category" ? a.category.name : a.tag,
      }),
    }));

  return {
    id: a.id, tag: a.tag, model: a.model, brand: a.brand, serial: a.serial,
    cls: a.cls, status: a.status, category: a.category.name, holder: a.assignee?.name ?? null,
    reg, regFinanceLabel: a.financeNotCapitalised && reg === "registered" ? "Not capitalised" : REG_LABEL_FINANCE[reg],
    returnSummary: returnSummary(a), resubmitNote: a.financeResubmitNote,
    approvedBy: a.financeConfirmedBy?.name ?? null, approvedAt: a.financeConfirmedAt, notCapitalised: a.financeNotCapitalised,
    costC, result, note, policyText, custom: policy?.basis === "custom",
    lifeMonths: policy?.lifeMonths ?? null, salvageC: policy?.salvage ?? null,
    startLabel: startOk ? monthLabel(start) : null,
    endLabel: startOk ? monthLabel(start + policy.lifeMonths - 1) : null,
    monthsUsed, asOfLabel: monthLabel(asOf),
    pr: a.purchaseRequest
      ? { id: a.purchaseRequest.id, refNo: a.purchaseRequest.refNo, requester: a.purchaseRequest.requestedBy.name, totalC: prTotalC }
      : null,
    vendor: a.vendor?.name ?? null, invoiceRef: a.invoiceRef, receiptRef: a.receiptRef, purchasedAt: a.purchasedAt,
    feesC: toCentavos(a.purchaseRecord?.fees),
    warrantyUntil: a.warrantyUntil, coveredBy: a.warrantyCoveredBy, contact: a.warrantyContact,
    docs,
    years: result && costC !== null ? lifeYears(costC, depStart, policy, asOf) : [],
    history,
    cost: {
      priceC: costC,
      feesC: toCentavos(a.purchaseRecord?.fees),
      feesUnits: a.purchaseRecord?.quantity ?? null,
      salvageC: policy?.salvage ?? null,
      baseC: costC !== null && policy ? costC - policy.salvage : null,
    },
    purchase: {
      pr: a.purchaseRequest ? { id: a.purchaseRequest.id, refNo: a.purchaseRequest.refNo } : null,
      requestedBy: a.purchaseRequest?.requestedBy.name ?? null,
      supplier: a.vendor?.name ?? null,
      invoiceRef: a.invoiceRef, receiptRef: a.receiptRef, purchasedAt: a.purchasedAt,
      warrantyUntil: a.warrantyUntil, coveredBy: a.warrantyCoveredBy,
    },
    audit,
    depLines: depLines(result, depStart, asOf, a.financeConfirmedAt),
    purchaseUnits: a.purchaseRecord?.quantity ?? null,
    noteCount: notes.filter((n) => n.parentId === null).length,
    openNoteCount: notes.filter((n) => n.parentId === null && n.resolvedAt === null).length,
    attachmentCount,
  };
}
