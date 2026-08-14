import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000);

async function main() {
  // Dev-only reset. Row-level append-only triggers don't intercept TRUNCATE.
  await prisma.$executeRawUnsafe(`
    TRUNCATE "AuditEntry", "NoteEntry", "Job", "WebhookDelivery", "WebhookEndpoint",
      "RateEvent", "UserPreference", "Approval", "Reservation", "AssetSecret",
      "AssetDocument", "PurchaseUnit", "PurchaseRequest", "Asset", "PolicySlot",
      "EquipmentPolicy", "Employee", "AssetType", "AssetCategory", "Vendor",
      "Department", "FeatureFlag", "User" CASCADE`);

  const hash = await bcrypt.hash("ChangeMe123!", 10);

  const [admin, itStaff, purchasing, finance] = await Promise.all([
    prisma.user.create({ data: { email: "admin@thebackroomop.com", name: "System Admin", role: "admin", isPermanentAdmin: true, passwordHash: hash } }),
    prisma.user.create({ data: { email: "it@thebackroomop.com", name: "J. Sarmiento", role: "it_staff", passwordHash: hash } }),
    prisma.user.create({ data: { email: "purchasing@thebackroomop.com", name: "A. Reyes", role: "purchasing_staff", passwordHash: hash } }),
    prisma.user.create({ data: { email: "finance@thebackroomop.com", name: "L. Domingo", role: "finance_staff", passwordHash: hash } }),
  ]);
  await prisma.user.create({ data: { email: "viewer@thebackroomop.com", name: "V. Cruz", role: "viewer", passwordHash: hash } });

  await prisma.featureFlag.createMany({
    data: [
      { key: "m365_sso", enabled: false, description: "Microsoft 365 single sign-on with domain allowlist" },
      { key: "allowed_domain", enabled: true, description: "Signup domain restriction", value: "thebackroomop.com" },
    ],
  });

  const deptList = await Promise.all(
    ["IT", "Finance", "Sales", "HR", "Operations"].map((name) =>
      prisma.department.create({ data: { name } }),
    ),
  );
  const depts = Object.fromEntries(deptList.map((d) => [d.name, d]));

  const catData: Record<string, string[]> = {
    Laptop: ["Dell Latitude", "ThinkPad"],
    Monitor: ["24-inch", "27-inch"],
    Phone: ["iPhone", "Android"],
    Dock: ["USB-C Dock"],
    Headset: ["Wired", "Wireless"],
    Peripheral: ["Keyboard", "Mouse"],
  };
  const cats: Record<string, { id: string; typeIds: string[] }> = {};
  for (const [name, types] of Object.entries(catData)) {
    const cat = await prisma.assetCategory.create({ data: { name } });
    const typeIds: string[] = [];
    for (const t of types) {
      typeIds.push((await prisma.assetType.create({ data: { name: t, categoryId: cat.id } })).id);
    }
    cats[name] = { id: cat.id, typeIds };
  }
  await prisma.assetCategory.create({ data: { name: "Uncategorised", locked: true } });

  const vendors = await Promise.all(
    ["TechServe PH", "Octagon Repairs"].map((name) => prisma.vendor.create({ data: { name } })),
  );

  const employeeRows: Array<[string, string, string, string, string | null, number, "ACTIVE" | "OFFBOARDING" | "OFFBOARDED"]> = [
    ["EMP-0042", "Marites Bautista", "Accountant", "Finance", "active", -900, "ACTIVE"],
    ["EMP-0051", "Ramon Cruz", "Account Executive", "Sales", "active", -700, "ACTIVE"],
    ["EMP-0063", "Grace Lim", "HR Generalist", "HR", "active", -500, "ACTIVE"],
    ["EMP-0071", "Paolo Santos", "IT Support", "IT", "active", -400, "ACTIVE"],
    ["EMP-0088", "Karen Uy", "Bookkeeper", "Finance", "pending", -20, "ACTIVE"],
    ["EMP-0090", "Dennis Ong", "Ops Coordinator", "Operations", "offboarding", -1100, "OFFBOARDING"],
    ["EMP-0093", "Faith Mercado", "Sales Associate", "Sales", "inactive", -1300, "OFFBOARDED"],
    ["EMP-0095", "Leo Tan", "Contractor", "Operations", "contractor", -60, "ACTIVE"],
    ["EMP-0097", "Nina Robles", "Analyst", "Finance", null, -10, "ACTIVE"],
    ["EMP-0099", "Carlo Dizon", "Team Lead", "Operations", "active", -800, "ACTIVE"],
  ];
  const employees = await Promise.all(
    employeeRows.map(([no, name, title, dept, m365, joined, employment]) =>
      prisma.employee.create({
        data: {
          employeeNo: no, name, title,
          departmentId: depts[dept].id,
          m365Status: m365, employment, joinedAt: day(joined),
        },
      }),
    ),
  );
  const emp = (no: string) => employees.find((e) => e.employeeNo === no)!;

  // Assets: every status represented; DEFECTIVE rows carry repair fields.
  const mk = (
    tag: string, model: string, cat: string, status: string, extra: Record<string, unknown> = {},
  ) => ({
    tag, model, categoryId: cats[cat].id, typeId: cats[cat].typeIds[0],
    status: status as never,
    purchasedAt: day(-720), cost: 55_000, warrantyUntil: day(180), ...extra,
  });

  await prisma.asset.createMany({
    data: [
      mk("BR-LT-0148", "Dell Latitude 5420", "Laptop", "DEPLOYED", { assigneeId: emp("EMP-0042").id }),
      mk("BR-LT-0181", "ThinkPad T14 Gen 4", "Laptop", "SPARE", { warrantyUntil: day(600) }),
      mk("BR-LT-0122", "Dell Latitude 5420", "Laptop", "DEFECTIVE", { defectiveSince: day(-12), notes: "No POST after power surge" }),
      mk("BR-LT-0118", "ThinkPad T14 Gen 3", "Laptop", "DEFECTIVE", { defectiveSince: day(-21), vendorId: vendors[1].id, rmaRef: "RMA-8802", notes: "Battery swelling" }),
      mk("BR-LT-0090", "Dell Latitude 5410", "Laptop", "DEFECTIVE", { defectiveSince: day(-44), repairQuote: 18_400, notes: "Board failure, out of warranty", warrantyUntil: day(-200) }),
      mk("BR-LT-0201", "MacBook Air M3", "Laptop", "DEPLOYED", { assigneeId: emp("EMP-0099").id, warrantyUntil: day(700) }),
      mk("BR-LT-0075", "Dell Latitude 5400", "Laptop", "DONATED", { warrantyUntil: day(-400) }),
      mk("BR-LT-0060", "ThinkPad E14", "Laptop", "BUYOUT", { warrantyUntil: day(-500) }),
      mk("BR-LT-0031", "Acer Aspire 5", "Laptop", "DISPOSE", { warrantyUntil: day(-900) }),
      mk("BR-LT-0027", "HP ProBook 440", "Laptop", "MISSING", { notes: "Not returned at offboarding — investigation open", warrantyUntil: day(-300) }),
      mk("BR-LT-0210", "ThinkPad T14 Gen 4", "Laptop", "TEMPORARY", { assigneeId: emp("EMP-0095").id }),
      mk("BR-MN-0902", "Dell P2422H", "Monitor", "DEPLOYED", { assigneeId: emp("EMP-0042").id, cost: 9_500 }),
      mk("BR-MN-0731", "Dell P2419H", "Monitor", "DEFECTIVE", { defectiveSince: day(-9), vendorId: vendors[1].id, rmaRef: "RMA-8841", cost: 8_000, notes: "Backlight flicker" }),
      mk("BR-MN-0910", "LG 27UL500", "Monitor", "SPARE", { cost: 12_000 }),
      mk("BR-MN-0911", "LG 27UL500", "Monitor", "SPARE", { cost: 12_000 }),
      mk("BR-PH-0287", "iPhone 12", "Phone", "TEMPORARY", { assigneeId: emp("EMP-0042").id, cost: 30_000, warrantyUntil: day(-100) }),
      mk("BR-PH-0301", "Samsung A54", "Phone", "SPARE", { cost: 18_000 }),
      mk("BR-DK-0071", "WD19S Dock", "Dock", "DEPLOYED", { assigneeId: emp("EMP-0042").id, cost: 11_000 }),
      mk("BR-DK-0033", "WD19S Dock", "Dock", "DEFECTIVE", { defectiveSince: day(-31), vendorId: vendors[1].id, rmaRef: "RMA-8790", cost: 11_000, notes: "Intermittent DisplayPort" }),
      mk("BR-HS-0501", "Jabra Evolve2 65", "Headset", "DEPLOYED", { assigneeId: emp("EMP-0051").id, cost: 7_500 }),
      mk("BR-HS-0502", "Jabra Evolve2 40", "Headset", "SPARE", { cost: 5_500 }),
      mk("BR-KB-0402", "Logitech MX Keys", "Peripheral", "DEFECTIVE", { defectiveSince: day(-2), cost: 6_000, notes: "Two keys unresponsive" }),
    ],
  });
  const asset = (tag: string) => prisma.asset.findUniqueOrThrow({ where: { tag } });

  // Purchase requests — one per state; the SUBMITTED one is a bounce-back with a note thread.
  await prisma.purchaseRequest.create({
    data: {
      refNo: "PR-0201", state: "DRAFT", requestedById: purchasing.id,
      units: { create: [{ description: "Laptop for new analyst", specs: "16GB RAM min", qty: 1, unitPrice: 62_000 }] },
    },
  });
  await prisma.purchaseRequest.create({
    data: {
      refNo: "PR-0198", state: "SUBMITTED", requestedById: purchasing.id,
      submittedAt: day(-4), reviewedAt: day(-2), reviewedById: itStaff.id,
      units: {
        create: [
          { description: "27-inch monitors", qty: 4, unitPrice: 12_000, state: "PENDING" },
          { description: "USB-C docks", qty: 4, unitPrice: 11_000, state: "PENDING", itSlotNotes: "Confirm wattage for T14" },
        ],
      },
      notes: {
        create: [
          { authorId: purchasing.id, kind: "SUBMIT", text: "Batch for the July hires.", createdAt: day(-4) },
          { authorId: itStaff.id, kind: "IT_REVIEW", text: "Specs confirmed, docks need wattage check.", createdAt: day(-2) },
          { authorId: finance.id, kind: "REQUEST_INFO", text: "Unit 02: quote exceeds standing rate — attach vendor quote.", createdAt: day(-1) },
        ],
      },
    },
  });
  await prisma.purchaseRequest.create({
    data: {
      refNo: "PR-0195", state: "IT_REVIEWED", requestedById: purchasing.id,
      submittedAt: day(-6), reviewedAt: day(-3), reviewedById: itStaff.id,
      units: { create: [{ description: "Wireless headsets", qty: 6, unitPrice: 7_500, state: "APPROVED" }] },
      notes: { create: [{ authorId: purchasing.id, kind: "SUBMIT", text: "Replacement cycle for Sales.", createdAt: day(-6) }] },
    },
  });
  await prisma.purchaseRequest.create({
    data: {
      refNo: "PR-0188", state: "COMPLETED", requestedById: purchasing.id,
      submittedAt: day(-40), reviewedAt: day(-35), reviewedById: itStaff.id, completedAt: day(-30),
      units: { create: [{ description: "Dell Latitude 5420", qty: 2, unitPrice: 55_000, state: "APPROVED" }] },
    },
  });
  await prisma.purchaseRequest.create({
    data: {
      refNo: "PR-0183", state: "CANCELLED", requestedById: purchasing.id,
      submittedAt: day(-50), cancelledAt: day(-48), cancelReason: "Duplicate of PR-0184",
      units: { create: [{ description: "Spare chargers", qty: 10, unitPrice: 1_800, state: "CANCELLED" }] },
    },
  });

  // Approvals — all six states; one PENDING past SLA; EXECUTION_FAILED with verbatim error.
  const a0148 = await asset("BR-LT-0148");
  const a0181 = await asset("BR-LT-0181");
  await prisma.approval.createMany({
    data: [
      { refNo: "APR-2041", type: "lifecycle_assign", state: "PENDING", priority: "NORMAL", slaAt: day(2), requestedById: itStaff.id, assetId: a0181.id, employeeId: emp("EMP-0097").id, payload: { to: { assignee: "EMP-0097", status: "DEPLOYED" } } },
      { refNo: "APR-2040", type: "lifecycle_return", state: "PENDING", priority: "URGENT", slaAt: day(-1), requestedById: itStaff.id, employeeId: emp("EMP-0090").id, payload: { reason: "offboarding" } },
      { refNo: "APR-2039", type: "lifecycle_change_status", state: "CLAIMED", priority: "NORMAL", slaAt: day(1), requestedById: itStaff.id, claimedById: admin.id, claimedAt: day(0), assetId: a0148.id, payload: { from: { status: "DEPLOYED" }, to: { status: "TEMPORARY" } } },
      { refNo: "APR-2035", type: "lifecycle_assign", state: "APPROVED", priority: "NORMAL", slaAt: day(1), requestedById: itStaff.id, claimedById: admin.id, claimedAt: day(-1), payload: { note: "queued for execution" } },
      { refNo: "APR-2031", type: "lifecycle_transfer", state: "EXECUTED", priority: "NORMAL", slaAt: day(-2), requestedById: itStaff.id, claimedById: admin.id, resolvedAt: day(-2), payload: { from: "EMP-0042", to: "EMP-0051" } },
      { refNo: "APR-2028", type: "lifecycle_replace", state: "REJECTED", priority: "HIGH", slaAt: day(-5), requestedById: itStaff.id, claimedById: admin.id, resolvedAt: day(-5), resolutionReason: "Replacement not justified; repair quote pending", payload: {} },
      { refNo: "APR-2025", type: "lifecycle_assign", state: "EXECUTION_FAILED", priority: "NORMAL", slaAt: day(-3), requestedById: itStaff.id, claimedById: admin.id, workerError: "Execution guard: target employee EMP-0093 is OFFBOARDED — assignment refused", payload: {} },
    ],
  });

  // Job queued for the APPROVED approval (worker executes it in Phase 4)
  const apr2035 = await prisma.approval.findUniqueOrThrow({ where: { refNo: "APR-2035" } });
  await prisma.job.create({ data: { type: "EXECUTE_APPROVAL", payload: { approvalId: apr2035.id } } });

  // Reservations — all four states
  await prisma.reservation.createMany({
    data: [
      { assetId: (await asset("BR-MN-0910")).id, employeeId: emp("EMP-0097").id, state: "ACTIVE", reason: "New hire setup", expiresAt: day(7) },
      { assetId: (await asset("BR-MN-0911")).id, employeeId: emp("EMP-0088").id, state: "FULFILLED", resolvedAt: day(-3) },
      { assetId: (await asset("BR-HS-0502")).id, employeeId: emp("EMP-0051").id, state: "RELEASED", resolvedAt: day(-5) },
      { assetId: (await asset("BR-PH-0301")).id, employeeId: emp("EMP-0063").id, state: "EXPIRED", expiresAt: day(-2) },
    ],
  });

  // Equipment policy for Finance (drives the loadout view in Phase 3)
  await prisma.equipmentPolicy.create({
    data: {
      name: "Finance standard", appliesToDepartmentId: depts["Finance"].id,
      slots: { create: [
        { name: "laptop", assetTypeId: cats["Laptop"].typeIds[0], required: true },
        { name: "monitor", assetTypeId: cats["Monitor"].typeIds[0], required: true },
        { name: "dock", assetTypeId: cats["Dock"].typeIds[0], required: true },
        { name: "headset", assetTypeId: cats["Headset"].typeIds[0], required: true },
        { name: "phone", assetTypeId: cats["Phone"].typeIds[0], required: true },
        { name: "second monitor", assetTypeId: cats["Monitor"].typeIds[1], required: false },
      ] },
    },
  });

  // Audit entries so /audit and history views have data before Phase 3 writes real ones
  await prisma.auditEntry.createMany({
    data: [
      { actorLabel: "system", entityType: "asset", entityId: a0148.id, action: "create", diff: { status: { from: null, to: "SPARE" } } },
      { actorId: itStaff.id, actorLabel: "J. Sarmiento", entityType: "asset", entityId: a0148.id, action: "update", diff: { status: { from: "SPARE", to: "DEPLOYED" }, assignee: { from: null, to: "EMP-0042" } } },
      { actorId: admin.id, actorLabel: "System Admin", entityType: "asset", entityId: a0148.id, action: "SECRET_READ" },
    ],
  });

  console.log("Seed complete.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
