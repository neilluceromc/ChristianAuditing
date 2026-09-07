import { notFound } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { computeLoadout, effectiveSlots, resolvePolicy } from "@/lib/loadout";
import { ASSIGNABLE_FROM, canSeeClass, isDirectLifecycle } from "@/lib/asset-class";
import { fmtDate, fmtMoney, fmtRelativeDays } from "@/lib/format";
import { uncoveredItems, type AckItem } from "@/lib/acknowledgement";
import { PageHeader } from "@/components/ui/page-header";
import { Avatar } from "@/components/ui/avatar";
import { ButtonLink } from "@/components/ui/button-link";
import { Card, CardBody } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Stat } from "@/components/ui/stat";
import { StatusDot } from "@/components/ui/status";
import { LoadoutView, type HoldingItem, type SlotTile, type SpareOption } from "@/components/employees/loadout-view";
import { AcknowledgementCard } from "@/components/employees/acknowledgement-card";

export default async function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const employee = await prisma.employee.findUnique({ where: { id }, include: { department: true } });
  if (!employee) notFound();

  const [held, reservations, openApprovals, policies, spareAssets, exceptions, itTypes, acks] = await Promise.all([
    prisma.asset.findMany({ where: { assigneeId: id }, orderBy: { tag: "asc" } }),
    prisma.reservation.findMany({ where: { employeeId: id, state: "ACTIVE" }, include: { asset: true } }),
    prisma.approval.findMany({
      where: { employeeId: id, state: { in: ["PENDING", "CLAIMED", "APPROVED"] } },
      include: { asset: true },
    }),
    prisma.equipmentPolicy.findMany({ include: { slots: { include: { assetType: true } } }, orderBy: [{ name: "asc" }] }),
    prisma.asset.findMany({
      // Assignment through /employees is IT's surface in Phase 13 —
      // Purchasing assets are assigned at create time (spec §5 has no assign
      // row; recorded as a follow-up). Pinned to the IT class explicitly so
      // this picker never offers a STORED car by accident.
      where: { cls: "IT", status: ASSIGNABLE_FROM.IT, returnedAt: null },
      include: { reservations: { where: { state: "ACTIVE" }, include: { employee: true } } },
      orderBy: { tag: "asc" },
    }),
    prisma.employeeSlotException.findMany({
      where: { employeeId: id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: { assetType: { select: { name: true } }, slot: { select: { name: true } } },
    }),
    prisma.assetType.findMany({
      where: { category: { cls: "IT" } },
      select: { id: true, name: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    }),
    prisma.acknowledgement.findMany({
      where: { employeeId: id },
      orderBy: [{ signedAt: "desc" }, { id: "desc" }],
      take: 20,
    }),
  ]);

  const policy = resolvePolicy(employee, policies);
  const loadout = computeLoadout(effectiveSlots(policy?.slots ?? [], exceptions), held);
  const pendingByAsset = new Map(openApprovals.filter((a) => a.assetId).map((a) => [a.assetId!, a.refNo]));
  const typeName = new Map(policies.flatMap((p) => p.slots).map((s) => [s.id, s.assetType?.name ?? "any"]));

  const toTileAsset = (a: (typeof held)[number]) => ({
    id: a.id, tag: a.tag, model: a.model, status: a.status,
    age: a.purchasedAt ? fmtRelativeDays(a.purchasedAt).replace(" ago", " old") : "age unknown",
    pendingRef: pendingByAsset.get(a.id) ?? null,
    visible: canSeeClass(user.role, a.cls),
  });

  const slots: SlotTile[] = loadout.slots.map(({ slot, asset }) => {
    // An ADD-exception slot's id isn't a real PolicySlot id, so `typeName`
    // (keyed on policy slot ids) never has it — fall back to the exception
    // row's own assetType.name, which the query above included for exactly
    // this reason.
    const exception = exceptions.find((e) => e.id === slot.exceptionId);
    return {
      slotId: slot.id,
      name: slot.name,
      typeId: slot.assetTypeId,
      typeName: typeName.get(slot.id) ?? exception?.assetType?.name ?? "any",
      required: slot.required,
      asset: asset ? toTileAsset(asset) : null,
      loaner: slot.loaner,
      exceptionId: slot.exceptionId ?? null,
      exceptionReason: exception?.reason ?? null,
    };
  });

  const waived = exceptions
    .filter((e) => e.kind === "WAIVE")
    .map((e) => ({ id: e.id, slotName: e.slot?.name ?? "removed slot", reason: e.reason }));

  const spares: SpareOption[] = spareAssets.map((a) => ({
    id: a.id, tag: a.tag, model: a.model, typeId: a.typeId,
    reservedFor: a.reservations[0]?.employee.name ?? null,
    reservedForThis: a.reservations[0]?.employeeId === id,
  }));

  const holding: HoldingItem[] = [
    ...reservations.map((r) => ({
      id: r.assetId, tag: r.asset.tag, model: r.asset.model,
      note: `reserved${r.expiresAt ? ` · expires ${fmtDate(r.expiresAt)}` : ""}`,
      kind: "reserved" as const,
      visible: canSeeClass(user.role, r.asset.cls),
    })),
    ...openApprovals
      .filter((a) => a.asset && a.asset.assigneeId !== id)
      .map((a) => ({
        id: a.assetId!, tag: a.asset!.tag, model: a.asset!.model,
        note: `assignment queued · ${a.refNo}`,
        kind: "queued" as const,
        visible: canSeeClass(user.role, a.asset!.cls),
      })),
  ];

  const bookValue = held.reduce((sum, a) => sum + (a.cost === null ? 0 : Number(a.cost)), 0);
  const oldest = held.reduce<Date | null>((min, a) =>
    a.purchasedAt && (!min || a.purchasedAt < min) ? a.purchasedAt : min, null);
  const canMutate = user.role === "admin" || user.role === "it_staff";
  const direct = isDirectLifecycle(user.role, "IT");
  const latest = acks[0] ?? null;
  const uncovered = uncoveredItems(
    held.map((a) => ({ assetId: a.id, tag: a.tag })),
    latest ? (latest.items as unknown as AckItem[]) : null,
  );

  return (
    <>
      <PageHeader
        title={employee.name}
        breadcrumb={[{ label: "Employees", href: "/employees" }, { label: employee.employeeNo }]}
        badge={
          <span className="inline-flex items-center gap-1.5">
            <StatusDot value={employee.employment} ns="employment" />
            <span className="font-mono text-[10.5px] text-fg-muted">{employee.employment}</span>
            {user.role === "viewer" && <Pill>READ-ONLY · VIEWER</Pill>}
          </span>
        }
        actions={
          <>
            <ButtonLink href={`/employees/${id}/timeline`}>Timeline</ButtonLink>
            <ButtonLink href={`/employees/${id}/form`}>Accountability form</ButtonLink>
            {canMutate && <ButtonLink variant="primary" href={`/employees/${id}/edit`}>Edit</ButtonLink>}
          </>
        }
      />
      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="flex w-full shrink-0 flex-col gap-4 lg:w-[250px]">
          {/* Character panel */}
          <Card className="h-fit">
            <CardBody className="flex flex-col gap-3">
              <div className="flex flex-col items-start gap-2">
                <Avatar name={employee.name} size="xxl" />
                <div>
                  <p className="text-[15px] font-semibold text-fg">{employee.name}</p>
                  <p className="text-xs text-fg-secondary">{employee.title} · {employee.department.name}</p>
                  <p className="pt-0.5 font-mono text-[10.5px] text-fg-muted">
                    {employee.employeeNo} · joined {fmtDate(employee.joinedAt)}
                  </p>
                  <p className="font-mono text-[10.5px] text-fg-muted">
                    M365: {employee.m365Status ?? "no sync yet"}
                  </p>
                </div>
              </div>
              {policy && (
                <div className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between">
                    <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-fg-muted">Loadout vs policy</span>
                    <span className="font-mono text-xs text-fg">{loadout.filled} / {loadout.totalSlots}</span>
                  </div>
                  <ProgressBar value={loadout.filled} max={loadout.totalSlots} label="Loadout completeness" />
                  <span className="text-[10.5px] text-fg-muted">{policy.name}</span>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Items held" value={String(held.length)} />
                <Stat label="Book value" value={fmtMoney(bookValue)} />
                <Stat label="Oldest item" value={oldest ? fmtDate(oldest) : "—"} />
                <Stat label="Open requests" value={String(openApprovals.length)} />
              </div>
            </CardBody>
          </Card>

          <AcknowledgementCard
            employeeId={id}
            latest={latest}
            history={acks.slice(1)}
            uncovered={uncovered}
            canRecord={canMutate}
          />
        </div>

        <div className="min-w-0 flex-1">
          <LoadoutView
            employeeId={id}
            slots={slots}
            unslotted={loadout.unslotted.map(toTileAsset)}
            onLoan={loadout.onLoan.map(toTileAsset)}
            waived={waived}
            itTypes={itTypes}
            spares={spares}
            holding={holding}
            frozen={employee.employment !== "ACTIVE"}
            canMutate={canMutate}
            direct={direct}
          />
        </div>
      </div>
      {/* keep an escape hatch for link-followers */}
      <p className="sr-only"><Link href="/employees">Back to employees</Link></p>
    </>
  );
}
