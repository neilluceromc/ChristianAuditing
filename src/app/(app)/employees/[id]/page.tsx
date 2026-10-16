import { notFound } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { computeLoadout, effectiveSlots, profilePrimary, profileTiles, resolvePolicy, slotLabel } from "@/lib/loadout";
import { ASSIGNABLE_FROM, canSeeClass, isDirectLifecycle } from "@/lib/asset-class";
import { fmtDate, fmtRelativeDays, localDateISO } from "@/lib/format";
import { uncoveredItems, type AckItem } from "@/lib/acknowledgement";
import { isRecentTransfer } from "@/lib/transfer-schema";
import { defaultOffboardingDue, minOffboardingDue } from "@/lib/deadlines";
import { toSearchParams } from "@/lib/url-state";
import { PageHeader } from "@/components/ui/page-header";
import { LoadoutView, type HoldingItem, type SpareOption } from "@/components/employees/loadout-view";
import type { EquipmentTileData } from "@/components/employees/equipment-tile";
import { EmployeeCreatedNotice } from "@/components/employees/employee-created-notice";
import { IdentityBand } from "@/components/employees/identity-band";
import { NotesCard } from "@/components/employees/notes-card";
import { ProfileActions } from "@/components/employees/profile-actions";
import { SideCard } from "@/components/employees/side-card/side-card";
import { SetupTab } from "@/components/employees/side-card/setup-tab";
import { FormTab } from "@/components/employees/side-card/form-tab";
import { TransfersTab } from "@/components/employees/side-card/transfers-tab";
import { notYetCount } from "@/lib/it-setup";
import { getTransfers } from "@/server/modules/employees/queries";
import { loadoutViewFor } from "@/server/loadout-view";

export default async function EmployeePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const sp = toSearchParams(await searchParams);
  const employee = await prisma.employee.findUnique({ where: { id }, include: { department: true } });
  if (!employee) notFound();
  const today = localDateISO(new Date());

  const [held, reservations, openApprovals, policies, spareAssets, exceptions, itCategories, acks, transfers, transferCount, departments, notes, noteCount, initialView] = await Promise.all([
    prisma.asset.findMany({
      where: { assigneeId: id },
      include: { category: { select: { name: true } }, type: { select: { name: true } } },
      orderBy: { tag: "asc" },
    }),
    prisma.reservation.findMany({ where: { employeeId: id, state: "ACTIVE" }, include: { asset: true } }),
    prisma.approval.findMany({
      where: { employeeId: id, state: { in: ["PENDING", "CLAIMED", "APPROVED"] } },
      include: { asset: true },
    }),
    // Phase 37 (spec §3.2): slots in policy order (the editor's own `id` order), so "Monitor" / "Monitor 2" never swap.
    prisma.equipmentPolicy.findMany({ include: { slots: { include: { assetType: true }, orderBy: { id: "asc" } } }, orderBy: [{ name: "asc" }] }),
    prisma.asset.findMany({
      // Assignment through /employees is IT's surface in Phase 13 —
      // Purchasing assets are assigned at create time (spec §5 has no assign
      // row; recorded as a follow-up). Pinned to the IT class explicitly so
      // this picker never offers a STORED car by accident.
      where: { cls: "IT", status: ASSIGNABLE_FROM.IT, returnedAt: null },
      include: {
        reservations: { where: { state: "ACTIVE" }, include: { employee: true } },
        // Phase 29 (final review I-1, ruling R7): the pickers' own
        // `openApprovals` is scoped to THIS employee, so a spare another
        // person's request is already waiting on read as free here — exactly
        // the case the pinned "held or queued for someone else" line claims is
        // excluded. Asked per asset instead, so the scope matches the copy.
        approvals: {
          where: { state: { in: ["PENDING", "CLAIMED", "APPROVED"] } },
          select: { refNo: true },
          orderBy: { createdAt: "asc" },
          take: 1,
        },
      },
      orderBy: { tag: "asc" },
    }),
    prisma.employeeSlotException.findMany({
      where: { employeeId: id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: { assetType: { select: { name: true } }, slot: { select: { name: true } } },
    }),
    // Phase 37 (spec §4.7): "Add a slot" asks the category first, then the type.
    prisma.assetCategory.findMany({
      where: { cls: "IT", types: { some: {} } },
      select: { id: true, name: true, types: { select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }] } },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    }),
    prisma.acknowledgement.findMany({
      where: { employeeId: id },
      orderBy: [{ signedAt: "desc" }, { id: "desc" }],
      take: 20,
    }),
    // Phase 39 (spec §2.5): the side card shows the latest 3; the count is the tab's badge.
    getTransfers(id, 3),
    prisma.employeeTransfer.count({ where: { employeeId: id } }),
    prisma.department.findMany({ orderBy: { name: "asc" } }),
    // Phase 39 (spec §2.2): only the 3 newest notes plus the total, never every note.
    prisma.employeeNote.findMany({
      where: { employeeId: id },
      include: { author: { select: { id: true, name: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 3,
    }),
    prisma.employeeNote.count({ where: { employeeId: id } }),
    loadoutViewFor(user.id),
  ]);

  const policy = resolvePolicy(employee, policies);
  const loadout = computeLoadout(effectiveSlots(policy?.slots ?? [], exceptions), held);
  const primary = profilePrimary({
    employment: employee.employment, totalSlots: loadout.totalSlots, filled: loadout.filled, missingRequired: loadout.missingRequired,
  });
  const pendingByAsset = new Map(openApprovals.filter((a) => a.assetId).map((a) => [a.assetId!, a.refNo]));
  const typeName = new Map(policies.flatMap((p) => p.slots).map((s) => [s.id, s.assetType?.name ?? "any"]));

  const toTileAsset = (a: (typeof held)[number]) => ({
    id: a.id, tag: a.tag, model: a.model, status: a.status,
    age: a.purchasedAt ? fmtRelativeDays(a.purchasedAt).replace(" ago", " old") : "age unknown",
    pendingRef: pendingByAsset.get(a.id) ?? null,
    visible: canSeeClass(user.role, a.cls),
    loanDueAt: a.loanDueAt ? a.loanDueAt.toISOString() : null,
  });
  // Phase 37 (spec §4.3): extras and loans are labelled by what they are — the category, or the type inside Other (§3.2).
  const categoryOf = (a: (typeof held)[number]) =>
    a.category ? (a.type ? slotLabel(a.category.name, a.type.name) : a.category.name) : "Item";

  const tiles: EquipmentTileData[] = profileTiles(loadout, (s) => s.name, categoryOf).map((t) => {
    const slot = t.slot;
    // An ADD-exception slot's id isn't a real PolicySlot id, so `typeName`
    // (keyed on policy slot ids) never has it — fall back to the exception
    // row's own assetType.name, which the query above included for exactly
    // this reason.
    const exception = slot?.exceptionId ? exceptions.find((e) => e.id === slot.exceptionId) : undefined;
    return {
      key: t.key,
      kind: t.kind,
      label: t.label,
      slotId: slot?.id ?? null,
      typeId: slot ? slot.assetTypeId : t.asset?.typeId ?? null,
      typeName: slot ? typeName.get(slot.id) ?? exception?.assetType?.name ?? "any" : t.asset?.type?.name ?? "any",
      required: t.required,
      loaner: slot?.loaner ?? false,
      exceptionId: slot?.exceptionId ?? null,
      exceptionReason: exception?.reason ?? null,
      // Phase 20 (spec §6.3, gap 3): a standard slot a remaining TEMPORARY
      // device stands in for — the tile shows that loan, not a gap.
      coveredByLoan: t.coveredByLoan,
      asset: t.asset ? toTileAsset(t.asset) : null,
    };
  });

  const waived = exceptions
    .filter((e) => e.kind === "WAIVE")
    .map((e) => ({ id: e.id, slotName: e.slot?.name ?? "removed slot", reason: e.reason }));

  const spares: SpareOption[] = spareAssets.map((a) => ({
    id: a.id, tag: a.tag, model: a.model, typeId: a.typeId,
    reservedFor: a.reservations[0]?.employee.name ?? null,
    reservedForThis: a.reservations[0]?.employeeId === id,
    // Phase 29 (spec §4.5): a spare an open approval already promises is not
    // pickable here — the pickers say which request holds it. The asset's own
    // open approval comes first (any requester, I-1); this person's map is
    // kept as the fallback so the ref stays the one the rest of the page shows.
    pendingRef: a.approvals[0]?.refNo ?? pendingByAsset.get(a.id) ?? null,
  }));

  const holding: HoldingItem[] = [
    ...reservations.map((r) => ({
      id: r.assetId, tag: r.asset.tag, model: r.asset.model,
      note: `reserved${r.expiresAt ? ` · expires ${fmtDate(r.expiresAt)}` : ""}`,
      kind: "reserved" as const,
      visible: canSeeClass(user.role, r.asset.cls),
      reservationId: r.id, expiresAt: r.expiresAt,
    })),
    ...openApprovals
      .filter((a) => a.asset && a.asset.assigneeId !== id)
      .map((a) => ({
        id: a.assetId!, tag: a.asset!.tag, model: a.asset!.model,
        note: `assignment queued · ${a.refNo}`,
        kind: "queued" as const,
        visible: canSeeClass(user.role, a.asset!.cls),
        reservationId: null, expiresAt: null,
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
  // Phase 20 (spec §3): `getTransfers` is already newest-first, so the
  // header line only ever looks at the first row (still there with take 3).
  const newestTransfer = transfers[0] ?? null;
  const recentTransfer = newestTransfer && isRecentTransfer(newestTransfer.effectiveAt) ? newestTransfer : null;
  const otherDepartments = departments.filter((d) => d.id !== employee.departmentId).map((d) => ({ id: d.id, name: d.name, kind: d.kind, archivedAt: d.archivedAt }));

  return (
    <>
      {sp.get("created") === "1" && (
        <EmployeeCreatedNotice
          name={employee.name} employeeNo={employee.employeeNo} id={id}
          assigned={sp.get("assigned")} failed={sp.get("failed")}
        />
      )}
      <PageHeader breadcrumb={[{ label: "Employees", href: "/employees" }, { label: employee.employeeNo }]} />
      <IdentityBand
        employeeId={id}
        name={employee.name}
        title={employee.title}
        groupName={employee.department.name}
        groupIsClient={employee.department.kind === "CLIENT"}
        employeeNo={employee.employeeNo}
        joinedAt={employee.joinedAt}
        m365Status={employee.m365Status}
        employment={employee.employment}
        offboardingDueAt={employee.offboardingDueAt}
        today={today}
        isViewer={user.role === "viewer"}
        transfer={recentTransfer ? { from: recentTransfer.from, effectiveAt: recentTransfer.effectiveAt } : null}
        actions={
          <ProfileActions
            employeeId={id}
            employeeName={employee.name}
            currentTitle={employee.title}
            employment={employee.employment}
            canMutate={canMutate}
            primary={primary}
            departments={otherDepartments}
            defaultDue={defaultOffboardingDue(today)}
            minDue={minOffboardingDue(today)}
          />
        }
        held={held.length}
        bookValue={bookValue}
        oldest={oldest}
        openApprovals={openApprovals.map((a) => ({ id: a.id, refNo: a.refNo, createdAt: a.createdAt }))}
        progress={policy ? { filled: loadout.filled, total: loadout.totalSlots, policyName: policy.name } : null}
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div id="loadout" tabIndex={-1} className="min-w-0 outline-none">
          {/* Phase 37 (spec §4.3): the Equipment card is the view's own, so its header can carry the switch. */}
          <LoadoutView
            employeeId={id}
            employeeName={employee.name}
            initialView={initialView}
            canLinkPolicies={user.role === "admin" || user.role === "it_staff"}
            tiles={tiles}
            unslotted={loadout.unslotted.map(toTileAsset)}
            onLoan={loadout.onLoan.map(toTileAsset)}
            waived={waived}
            itCategories={itCategories}
            currentSlotLabels={loadout.slots.map((s) => s.slot.name)}
            spares={spares}
            holding={holding}
            frozen={employee.employment !== "ACTIVE"}
            dueAt={employee.employment === "OFFBOARDING" ? employee.offboardingDueAt : null}
            today={today}
            canMutate={canMutate}
            direct={direct}
          />
        </div>

        <div className="min-w-0">
          {/* Phase 39 (spec §2): one card, four tabs — it replaces the stacked Notes, IT setup, form and transfer cards. */}
          <SideCard
            counts={{ notes: noteCount, notYet: notYetCount(employee), signed: latest !== null, transfers: transferCount }}
            panels={{
              notes: (
                <NotesCard
                  employeeId={id}
                  employeeName={employee.name}
                  notes={notes.map((n) => ({
                    id: n.id, authorId: n.author.id, authorName: n.author.name, text: n.text, createdAt: n.createdAt, editedAt: n.editedAt,
                  }))}
                  viewer={{ id: user.id, role: user.role }}
                  canAdd={canMutate}
                />
              ),
              setup: (
                <SetupTab
                  employeeId={id}
                  canEdit={canMutate}
                  values={{
                    entraStatus: employee.entraStatus, autopilotStatus: employee.autopilotStatus,
                    argusStatus: employee.argusStatus, vpn: employee.vpn,
                  }}
                />
              ),
              form: (
                <FormTab
                  employeeId={id}
                  latest={latest}
                  history={acks.slice(1)}
                  uncovered={uncovered}
                  canRecord={canMutate}
                />
              ),
              transfers: (
                <TransfersTab
                  employeeId={id}
                  employeeName={employee.name}
                  currentTitle={employee.title}
                  departments={otherDepartments}
                  transfers={transfers}
                  total={transferCount}
                  canTransfer={canMutate && employee.employment === "ACTIVE"}
                />
              ),
            }}
          />
        </div>
      </div>
      {/* keep an escape hatch for link-followers */}
      <p className="sr-only"><Link href="/employees">Back to employees</Link></p>
    </>
  );
}
