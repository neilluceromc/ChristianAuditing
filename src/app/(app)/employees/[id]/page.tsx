import { notFound } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { computeLoadout, resolvePolicy } from "@/lib/loadout";
import { fmtDate, fmtMoney, fmtRelativeDays } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Avatar } from "@/components/ui/avatar";
import { ButtonLink } from "@/components/ui/button-link";
import { Card, CardBody } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Stat } from "@/components/ui/stat";
import { StatusDot } from "@/components/ui/status";
import { LoadoutView, type HoldingItem, type SlotTile, type SpareOption } from "@/components/employees/loadout-view";

export default async function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const employee = await prisma.employee.findUnique({ where: { id }, include: { department: true } });
  if (!employee) notFound();

  const [held, reservations, openApprovals, policies, spareAssets] = await Promise.all([
    prisma.asset.findMany({ where: { assigneeId: id }, orderBy: { tag: "asc" } }),
    prisma.reservation.findMany({ where: { employeeId: id, state: "ACTIVE" }, include: { asset: true } }),
    prisma.approval.findMany({
      where: { employeeId: id, state: { in: ["PENDING", "CLAIMED", "APPROVED"] } },
      include: { asset: true },
    }),
    prisma.equipmentPolicy.findMany({ include: { slots: { include: { assetType: true } } } }),
    prisma.asset.findMany({
      where: { status: "SPARE" },
      include: { reservations: { where: { state: "ACTIVE" }, include: { employee: true } } },
      orderBy: { tag: "asc" },
    }),
  ]);

  const policy = resolvePolicy(employee, policies);
  const loadout = computeLoadout(policy?.slots ?? [], held);
  const pendingByAsset = new Map(openApprovals.filter((a) => a.assetId).map((a) => [a.assetId!, a.refNo]));
  const typeName = new Map(policies.flatMap((p) => p.slots).map((s) => [s.id, s.assetType?.name ?? "any"]));

  const toTileAsset = (a: (typeof held)[number]) => ({
    id: a.id, tag: a.tag, model: a.model, status: a.status,
    age: a.purchasedAt ? fmtRelativeDays(a.purchasedAt).replace(" ago", " old") : "age unknown",
    pendingRef: pendingByAsset.get(a.id) ?? null,
  });

  const slots: SlotTile[] = loadout.slots.map(({ slot, asset }) => ({
    slotId: slot.id,
    name: slot.name,
    typeId: slot.assetTypeId,
    typeName: typeName.get(slot.id) ?? "any",
    required: slot.required,
    asset: asset ? toTileAsset(asset) : null,
  }));

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
    })),
    ...openApprovals
      .filter((a) => a.asset && a.asset.assigneeId !== id)
      .map((a) => ({
        id: a.assetId!, tag: a.asset!.tag, model: a.asset!.model,
        note: `assignment queued · ${a.refNo}`,
        kind: "queued" as const,
      })),
  ];

  const bookValue = held.reduce((sum, a) => sum + (a.cost === null ? 0 : Number(a.cost)), 0);
  const oldest = held.reduce<Date | null>((min, a) =>
    a.purchasedAt && (!min || a.purchasedAt < min) ? a.purchasedAt : min, null);
  const canMutate = user.role === "admin" || user.role === "it_staff";

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
        {/* Character panel */}
        <Card className="h-fit w-full shrink-0 lg:w-[250px]">
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

        <div className="min-w-0 flex-1">
          <LoadoutView
            employeeId={id}
            slots={slots}
            unslotted={loadout.unslotted.map(toTileAsset)}
            spares={spares}
            holding={holding}
            frozen={employee.employment !== "ACTIVE"}
            canMutate={canMutate}
          />
        </div>
      </div>
      {/* keep an escape hatch for link-followers */}
      <p className="sr-only"><Link href="/employees">Back to employees</Link></p>
    </>
  );
}
