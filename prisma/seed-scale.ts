import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { SEED_PASSWORD } from "./fixtures";
import { generateScaleData, type ScaleContext } from "./scale/generators";

/**
 * Phase 43 (spec §3): `npm run db:seed:scale` — the realistic large data set (600 employees, 1,000 assets, six
 * months of history, 15 test accounts) layered ON TOP of `npm run db:seed`. It only inserts: the normal seed's
 * fixed records stay untouched and the scale rows use their own ranges (BR-xx-1000+, EMP-1000+, PR-1000+,
 * APR-5000+). Everything goes in one transaction, so a refused row leaves the database as it was.
 */

const prisma = new PrismaClient();
const BATCH = 1000;

async function main() {
  const started = Date.now();
  // the same guard as prisma/seed.ts: 15 more accounts share the seed password
  if (process.env.NODE_ENV === "production" && !process.env.SEED_PASSWORD) {
    throw new Error("Refusing to seed: NODE_ENV=production and SEED_PASSWORD is unset. Set SEED_PASSWORD to something only you know.");
  }
  const existing = await prisma.employee.count({ where: { employeeNo: { gte: "EMP-1000" } } });
  if (existing > 0) {
    console.error(`Refusing to run: ${existing} employee(s) numbered EMP-1000 or above already exist, so the scale data is already here. Run npm run db:seed first to start over.`);
    process.exitCode = 1;
    return;
  }

  const [policies, categories, vendors, departments, admin, it, purchasing, finance] = await Promise.all([
    prisma.equipmentPolicy.findMany({ include: { slots: { select: { assetTypeId: true, required: true, loaner: true } } }, orderBy: { name: "asc" } }),
    prisma.assetCategory.findMany({ include: { types: true } }),
    prisma.vendor.findMany({ select: { id: true, name: true } }),
    prisma.department.findMany({ select: { id: true, name: true, kind: true } }),
    ...["admin", "it", "purchasing", "finance"].map((who) =>
      prisma.user.findUnique({ where: { email: `${who}@thebackroomop.com` }, select: { id: true, name: true } })),
  ]);
  if (!admin || !it || !purchasing || !finance || categories.length === 0) {
    console.error("Refusing to run: the normal seed's accounts or categories are missing. Run npm run db:seed first.");
    process.exitCode = 1;
    return;
  }
  const ctx: ScaleContext = {
    categories: Object.fromEntries(categories.map((c) => [c.name, { id: c.id, cls: c.cls, types: Object.fromEntries(c.types.map((t) => [t.name, t.id])) }])),
    vendors: Object.fromEntries(vendors.map((v) => [v.name, v.id])),
    departments: Object.fromEntries(departments.map((d) => [d.name, { id: d.id, kind: d.kind }])),
    fixedUsers: { admin, it, purchasing, finance },
    policies: policies.map((p) => ({ id: p.id, name: p.name, appliesToDepartmentId: p.appliesToDepartmentId, appliesToTitle: p.appliesToTitle, slots: p.slots })),
  };

  const data = generateScaleData(ctx, new Date());
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);

  const insert = async <T>(rows: T[], write: (batch: T[]) => Promise<{ count: number }>) => {
    let n = 0;
    for (let i = 0; i < rows.length; i += BATCH) n += (await write(rows.slice(i, i + BATCH))).count;
    if (n !== rows.length) throw new Error(`scale seed: inserted ${n} of ${rows.length} rows`);
    return n;
  };

  // foreign-key order: departments and users, people, policies, purchases, assets, then what points at assets
  await prisma.$transaction(async (tx) => {
    await insert(data.departments, (b) => tx.department.createMany({ data: b }));
    await insert(data.users.map((u) => ({ ...u, passwordHash })), (b) => tx.user.createMany({ data: b }));
    await insert(data.employees, (b) => tx.employee.createMany({ data: b }));
    await insert(data.policies, (b) => tx.equipmentPolicy.createMany({ data: b }));
    await insert(data.policySlots, (b) => tx.policySlot.createMany({ data: b }));
    await insert(data.purchaseOrders, (b) => tx.purchaseOrder.createMany({ data: b }));
    await insert(data.purchaseOrderLines, (b) => tx.purchaseOrderLine.createMany({ data: b }));
    await insert(data.noteEntries, (b) => tx.noteEntry.createMany({ data: b }));
    await insert(data.assets, (b) => tx.asset.createMany({ data: b }));
    await insert(data.employeeNotes, (b) => tx.employeeNote.createMany({ data: b }));
    await insert(data.approvals, (b) => tx.approval.createMany({ data: b }));
    await insert(data.reservations, (b) => tx.reservation.createMany({ data: b }));
    await insert(data.auditEntries, (b) => tx.auditEntry.createMany({ data: b }));
    // the app numbers new requests and approvals from these sequences: continue after the scale ranges
    await tx.$executeRaw`SELECT setval('purchase_request_ref_seq', GREATEST(${data.sequences.purchaseRequest}::bigint, (SELECT last_value FROM purchase_request_ref_seq)))`;
    await tx.$executeRaw`SELECT setval('approval_ref_seq', GREATEST(${data.sequences.approval}::bigint, (SELECT last_value FROM approval_ref_seq)))`;
  }, { timeout: 600_000, maxWait: 30_000 });

  const [employees, assets] = await Promise.all([prisma.employee.count(), prisma.asset.count()]);
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `Scale seed complete in ${secs}s: +${data.departments.length} departments, +${data.users.length} users, ` +
    `+${data.employees.length} employees (${employees} total), +${data.assets.length} assets (${assets} total), ` +
    `+${data.purchaseOrders.length} purchase orders (${data.purchaseOrderLines.length} lines), +${data.approvals.length} approvals, ` +
    `+${data.reservations.length} reservations, +${data.employeeNotes.length} employee notes, +${data.policies.length} policies, ` +
    `+${data.auditEntries.length} audit rows.`,
  );
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
