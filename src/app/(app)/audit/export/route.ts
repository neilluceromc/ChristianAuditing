import { requireUser } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { buildAuditWhere, AUDIT_LIST_CONFIG } from "@/lib/audit-list";
import { entityLabels } from "@/server/modules/audit/queries";
import { parseListState } from "@/lib/url-state";
import { toXlsxBuffer } from "@/server/xlsx/write";
import { AUDIT_EXPORT_COLUMNS, EXPORT_CAP } from "@/lib/export-columns";
import { capRefusal, exportFilename, xlsxResponse } from "@/server/export/respond";

export async function GET(req: Request) {
  await requireUser();
  const url = new URL(req.url);
  // Same parse + filter as /audit's page, so the sheet and the screen can
  // never disagree about which rows a filtered export includes.
  const state = parseListState(url.searchParams, AUDIT_LIST_CONFIG);
  const where = buildAuditWhere(state);

  const count = await prisma.auditEntry.count({ where });
  if (count > EXPORT_CAP) return capRefusal(count);

  const entries = await prisma.auditEntry.findMany({ where, orderBy: { createdAt: "desc" } });
  // Batch-resolved once for the whole page, exactly as listAudit does — one
  // call per row here would be one query per row on a 10,000-row export.
  const labels = await entityLabels(entries);

  const buffer = await toXlsxBuffer(
    AUDIT_EXPORT_COLUMNS,
    entries.map((e) => ({
      when: e.createdAt,
      actor: e.actorLabel,
      entityType: e.entityType,
      entityLabel: labels.get(`${e.entityType}:${e.entityId}`)!.label,
      action: e.action,
      // Same shape listAudit renders as "Fields": the changed keys, or an
      // em dash for actions (e.g. SECRET_READ) that carry no diff.
      fields: e.diff ? Object.keys(e.diff as object).join(", ") : "—",
    })),
  );
  return xlsxResponse(exportFilename("audit", new Date()), buffer);
}
