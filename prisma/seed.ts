import { PrismaClient, Prisma, type AssetStatus, type AssetClass } from "@prisma/client";
import bcrypt from "bcryptjs";
import { encryptSecret } from "../src/server/crypto";
import { secretAad } from "../src/server/webhooks/sign";
import { SEED_PASSWORD } from "./fixtures";

const prisma = new PrismaClient();

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000);

async function main() {
  // The seed creates five accounts sharing one password, and README publishes
  // what that password is. That is fine for a loopback dev database and is not
  // fine for anything a phone can reach. The production image sets
  // NODE_ENV=production (Dockerfile), so this catches the one dangerous case —
  // running the seed inside a deployed stack — without inconveniencing dev or
  // e2e, where the fixture default is what every login helper expects.
  if (process.env.NODE_ENV === "production" && !process.env.SEED_PASSWORD) {
    throw new Error(
      "Refusing to seed: NODE_ENV=production and SEED_PASSWORD is unset, so all five accounts " +
        "would share the password published in README. Set SEED_PASSWORD to something only you know.",
    );
  }

  // Dev-only reset. Row-level append-only triggers don't intercept TRUNCATE.
  await prisma.$executeRawUnsafe(`
    TRUNCATE "AuditEntry", "NoteEntry", "Job", "WebhookDelivery", "WebhookEndpoint",
      "RateEvent", "UserPreference", "Approval", "Reservation", "AssetSecret",
      "AssetDocument", "PurchaseUnit", "PurchaseRequest", "Asset", "PolicySlot",
      "EquipmentPolicy", "Employee", "AssetType", "AssetCategory", "Vendor",
      "Department", "FeatureFlag", "User",
      "StocktakeLine", "Stocktake", "StockMovement", "StockLot", "StockItem", "StockCategory" CASCADE`);

  const hash = await bcrypt.hash(SEED_PASSWORD, 10);

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

  // Phase 13: every category carries a class. The six IT categories are what
  // they always were; the four Purchasing ones are the meeting's own examples.
  const catData: Record<string, { cls: AssetClass; types: string[] }> = {
    Laptop: { cls: "IT", types: ["Dell Latitude", "ThinkPad"] },
    Monitor: { cls: "IT", types: ["24-inch", "27-inch"] },
    Phone: { cls: "IT", types: ["iPhone", "Android"] },
    Dock: { cls: "IT", types: ["USB-C Dock"] },
    Headset: { cls: "IT", types: ["Wired", "Wireless"] },
    Peripheral: { cls: "IT", types: ["Keyboard", "Mouse"] },
    Vehicle: { cls: "PURCHASING", types: ["Sedan", "Van"] },
    Furniture: { cls: "PURCHASING", types: ["Desk", "Chair"] },
    "Pantry Equipment": { cls: "PURCHASING", types: ["Microwave", "Air purifier"] },
    Building: { cls: "PURCHASING", types: ["Floor", "Warehouse"] },
  };
  const cats: Record<string, { id: string; typeIds: string[]; cls: AssetClass }> = {};
  for (const [name, { cls, types }] of Object.entries(catData)) {
    const cat = await prisma.assetCategory.create({ data: { name, cls } });
    const typeIds: string[] = [];
    for (const t of types) {
      typeIds.push((await prisma.assetType.create({ data: { name: t, categoryId: cat.id } })).id);
    }
    cats[name] = { id: cat.id, typeIds, cls };
  }
  await prisma.assetCategory.create({ data: { name: "Uncategorised", locked: true } });

  const vendorRows: Array<Prisma.VendorCreateInput> = [
    { name: "TechServe PH", registeredName: "TechServe Philippines, Inc.", category: "IT hardware", contactPerson: "Rina Valdez",
      phone: "+63 2 8123 4567", email: "sales@techserve.ph", address: "Ortigas Center, Pasig", registrationNo: "CS201512345",
      contractStatus: "ACTIVE", contractStart: day(-300), contractEnd: day(425), contractTerms: "Net 30; on-site warranty service" },
    { name: "Octagon Repairs", category: "Repair services", contactPerson: "Bong Reyes", phone: "+63 917 555 0102",
      email: "service@octagon-repairs.ph", contractStatus: "NONE" },
    { name: "Metro Office Supply", category: "Office supplies", contactPerson: "Liza Mendoza", email: "orders@metrooffice.ph",
      contractStatus: "EXPIRED", contractStart: day(-800), contractEnd: day(-70) },
    { name: "Quezon Furniture Works", category: "Furniture", contactPerson: "Dante Cruz", phone: "+63 2 8555 0199",
      contractStatus: "ACTIVE", contractStart: day(-100), contractEnd: day(265) },
    { name: "Old Line Trading", category: "General", contactPerson: "—", contractStatus: "NONE", archivedAt: day(-30) },
  ];
  const vendors = await Promise.all(vendorRows.map((data) => prisma.vendor.create({ data })));

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
          // bounds "this offboarding": decisions made now fall inside the window,
          // and without it a reseed leaves the anchor null, so an executed
          // return would vanish from the farewell report
          offboardingAt: employment === "ACTIVE" ? null : day(-3),
        },
      }),
    ),
  );
  const emp = (no: string) => employees.find((e) => e.employeeNo === no)!;

  // Assets: every status represented; DEFECTIVE rows carry repair fields.
  // purchasedAt is deliberately spread across the five age buckets (including a
  // 4y+ tail) so Home's histogram is a distribution rather than one bar.
  const mk = (
    tag: string, model: string, cat: string, status: string, extra: Record<string, unknown> = {},
  ) => ({
    tag, model, categoryId: cats[cat].id, typeId: cats[cat].typeIds[0],
    cls: cats[cat].cls,
    // Phase 14: IT-registered rows are born checked; a car never carries a stamp.
    itVerifiedAt: cats[cat].cls === "IT" ? day(-720) : null,
    status: status as AssetStatus,
    purchasedAt: day(-720), cost: 55_000, warrantyUntil: day(180), importedAt: null, ...extra,
  });

  await prisma.asset.createMany({
    data: [
      // this pair is the warranty-runway fixture: same model, expiring 3 days
      // apart inside the 90-day window, so Home can show the thing the design
      // is about — two identical laptops coming off warranty the same week
      mk("BR-LT-0148", "Dell Latitude 5420", "Laptop", "DEPLOYED", { assigneeId: emp("EMP-0042").id, warrantyUntil: day(38) }),
      mk("BR-LT-0181", "ThinkPad T14 Gen 4", "Laptop", "SPARE", { warrantyUntil: day(600), purchasedAt: day(-120) }),
      mk("BR-LT-0122", "Dell Latitude 5420", "Laptop", "DEFECTIVE", { defectiveSince: day(-12), warrantyUntil: day(41), notes: "No POST after power surge" }),
      mk("BR-LT-0118", "ThinkPad T14 Gen 3", "Laptop", "DEFECTIVE", { defectiveSince: day(-21), vendorId: vendors[1].id, rmaRef: "RMA-8802", notes: "Battery swelling" }),
      // the BEYOND REPAIR fixture: ₱34,000 to fix a ₱55,000 machine is 62%,
      // over the 60% write-off line, so the repairs view can show the warning
      // the design is about
      mk("BR-LT-0090", "Dell Latitude 5410", "Laptop", "DEFECTIVE", { defectiveSince: day(-44), repairQuote: 34_000, notes: "Board failure, out of warranty — vendor quote is most of a new unit", warrantyUntil: day(-200), purchasedAt: day(-1250) }),
      mk("BR-LT-0201", "MacBook Air M3", "Laptop", "DEPLOYED", { assigneeId: emp("EMP-0099").id, warrantyUntil: day(700), purchasedAt: day(-60) }),
      mk("BR-LT-0075", "Dell Latitude 5400", "Laptop", "DONATED", { warrantyUntil: day(-400), purchasedAt: day(-1500) }),
      mk("BR-LT-0060", "ThinkPad E14", "Laptop", "BUYOUT", { warrantyUntil: day(-500), purchasedAt: day(-1700) }),
      mk("BR-LT-0031", "Acer Aspire 5", "Laptop", "DISPOSE", { warrantyUntil: day(-900), purchasedAt: day(-2100) }),
      mk("BR-LT-0027", "HP ProBook 440", "Laptop", "MISSING", { notes: "Not returned at offboarding — investigation open", warrantyUntil: day(-300), purchasedAt: day(-1600) }),
      mk("BR-LT-0210", "ThinkPad T14 Gen 4", "Laptop", "TEMPORARY", { assigneeId: emp("EMP-0095").id }),
      // Dennis (EMP-0090) is the OFFBOARDING fixture — the wizard needs him to
      // actually hold things, one per interesting outcome: a clean return, a
      // machine that comes back broken, and the phone nobody can find. New
      // assets rather than reassigned spares, so the spare pool (and the two
      // specs that lean on it) stay exactly as they were.
      mk("BR-LT-0166", "ThinkPad T14 Gen 2", "Laptop", "DEPLOYED", { assigneeId: emp("EMP-0090").id, cost: 48_000, purchasedAt: day(-1150), warrantyUntil: day(-60) }),
      mk("BR-PH-0312", "Samsung A54", "Phone", "DEPLOYED", { assigneeId: emp("EMP-0090").id, cost: 18_000 }),
      mk("BR-HS-0510", "Jabra Evolve2 40", "Headset", "DEPLOYED", { assigneeId: emp("EMP-0090").id, cost: 5_500 }),
      mk("BR-MN-0902", "Dell P2422H", "Monitor", "DEPLOYED", { assigneeId: emp("EMP-0042").id, cost: 9_500 }),
      mk("BR-MN-0731", "Dell P2419H", "Monitor", "DEFECTIVE", { defectiveSince: day(-9), vendorId: vendors[1].id, rmaRef: "RMA-8841", cost: 8_000, notes: "Backlight flicker" }),
      mk("BR-MN-0910", "LG 27UL500", "Monitor", "SPARE", { cost: 12_000, purchasedAt: day(-950) }),
      // the RETURNED OK fixture: back from the vendor and usable again, but it
      // KEEPS its defectiveSince — "was defective, isn't now" is what that
      // stage means, and clearing the date would erase the repair history
      mk("BR-MN-0911", "LG 27UL500", "Monitor", "SPARE", { cost: 12_000, purchasedAt: day(-200), defectiveSince: day(-70), notes: "Reflowed by Octagon Repairs — back in the spare pool" }),
      mk("BR-PH-0287", "iPhone 12", "Phone", "TEMPORARY", { assigneeId: emp("EMP-0042").id, cost: 30_000, warrantyUntil: day(-100), purchasedAt: day(-1100) }),
      mk("BR-PH-0301", "Samsung A54", "Phone", "SPARE", { cost: 18_000 }),
      mk("BR-DK-0071", "WD19S Dock", "Dock", "DEPLOYED", { assigneeId: emp("EMP-0042").id, cost: 11_000 }),
      mk("BR-DK-0033", "WD19S Dock", "Dock", "DEFECTIVE", { defectiveSince: day(-31), vendorId: vendors[1].id, rmaRef: "RMA-8790", cost: 11_000, notes: "Intermittent DisplayPort" }),
      mk("BR-HS-0501", "Jabra Evolve2 65", "Headset", "DEPLOYED", { assigneeId: emp("EMP-0051").id, cost: 7_500 }),
      mk("BR-HS-0502", "Jabra Evolve2 40", "Headset", "SPARE", { cost: 5_500 }),
      mk("BR-KB-0402", "Logitech MX Keys", "Peripheral", "DEFECTIVE", { defectiveSince: day(-2), cost: 6_000, notes: "Two keys unresponsive" }),
      // Purchasing-class fixtures (Phase 13): one per branch a test needs —
      // a car that is assigned (custody works for a car), idle stock, a repair,
      // a building with no holder. Ramon (EMP-0051, ACTIVE) drives the car so
      // Dennis's three-item offboarding fixture is untouched; the leaver-with-
      // a-car case builds its own row inside e2e/asset-classes.spec.ts.
      mk("BR-VH-0001", "Toyota Vios", "Vehicle", "OPERATIONAL", { assigneeId: emp("EMP-0051").id, cost: 950_000, purchasedAt: day(-800), warrantyUntil: day(300) }),
      // typeId override: mk defaults to typeIds[0] ("Sedan"); a HiAce is the Van type.
      mk("BR-VH-0002", "Toyota HiAce", "Vehicle", "STORED", { typeId: cats["Vehicle"].typeIds[1], cost: 1_600_000, purchasedAt: day(-1400), warrantyUntil: null }),
      mk("BR-FN-0001", "Executive desk", "Furniture", "OPERATIONAL", { cost: 25_000, warrantyUntil: null }),
      // typeId override: mk defaults to typeIds[0] ("Desk"); an ergonomic chair is the Chair type.
      mk("BR-FN-0002", "Ergonomic chair", "Furniture", "OPERATIONAL", { typeId: cats["Furniture"].typeIds[1], cost: 12_000, warrantyUntil: null }),
      // e2e/asset-classes.spec.ts case 16's Finance send-back target — must stay
      // un-confirmed at seed time. `mk` never sets financeConfirmedAt itself
      // (no default in the schema/no trigger touches it), so leaving it out of
      // `extra` here already leaves the row unconfirmed; nothing else to do.
      mk("BR-FN-0003", "Meeting table", "Furniture", "STORED", { cost: 40_000, warrantyUntil: null }),
      // defectiveSince is an IT repair-stage field; Purchasing has no repair
      // stages — repairStage() is class-blind and would resolve this
      // otherwise-non-DEFECTIVE row's leftover defectiveSince to "returned-ok".
      mk("BR-PE-0001", "Panasonic microwave", "Pantry Equipment", "REPAIRING", { cost: 8_000, notes: "Turntable motor", warrantyUntil: null }),
      mk("BR-BL-0001", "Makati office, 12F", "Building", "OPERATIONAL", { cost: 45_000_000, purchasedAt: day(-3000), warrantyUntil: null }),
    ],
  });

  // Phase 18 spec §2.6: anything bought more than two years ago reads as a historical import.
  await prisma.asset.updateMany({
    where: { purchasedAt: { lt: day(-730) }, purchaseRequestId: null },
    data: { importedAt: new Date() },
  });

  const asset = (tag: string) => prisma.asset.findUniqueOrThrow({ where: { tag } });

  // Purchase requests — one per state; the SUBMITTED one is a bounce-back with a note thread.
  await prisma.purchaseRequest.create({
    data: {
      refNo: "PR-0201", state: "DRAFT", requestedById: purchasing.id, departmentId: depts["IT"].id,
      units: { create: [{ description: "Laptop for new analyst", specs: "16GB RAM min", qty: 1, unitPrice: 62_000 }] },
    },
  });
  await prisma.purchaseRequest.create({
    data: {
      refNo: "PR-0198", state: "SUBMITTED", requestedById: purchasing.id, departmentId: depts["HR"].id,
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
      refNo: "PR-0195", state: "IT_REVIEWED", requestedById: purchasing.id, departmentId: depts["Sales"].id,
      submittedAt: day(-6), reviewedAt: day(-3), reviewedById: itStaff.id,
      units: { create: [{ description: "Wireless headsets", qty: 6, unitPrice: 7_500, state: "APPROVED" }] },
      notes: { create: [{ authorId: purchasing.id, kind: "SUBMIT", text: "Replacement cycle for Sales.", createdAt: day(-6) }] },
    },
  });
  const pr0188 = await prisma.purchaseRequest.create({
    data: {
      refNo: "PR-0188", state: "COMPLETED", requestedById: purchasing.id, departmentId: depts["IT"].id, vendorId: vendors[0].id,
      submittedAt: day(-40), reviewedAt: day(-35), reviewedById: itStaff.id, completedAt: day(-30),
      units: { create: [{ description: "Dell Latitude 5420", qty: 2, unitPrice: 55_000, state: "APPROVED" }] },
    },
    include: { units: true },
  });
  // Final-review fix wave (M-5): register one seeded asset against PR-0188's
  // own unit so the "From PR-0188" badge (spec §6) has seed data, not only
  // e2e-created rows. BR-LT-0148 is one of PR-0188's two Dell Latitude 5420s.
  await prisma.asset.update({
    where: { tag: "BR-LT-0148" },
    data: { purchaseRequestId: pr0188.id, purchaseUnitId: pr0188.units[0].id },
  });
  // Phase 18: deliberately untagged — the e2e "none" filter case needs one pre-phase row
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
      // payload mirrors what requestAssign actually writes (assigneeId = row id, not employeeNo)
      { refNo: "APR-2041", type: "lifecycle_assign", state: "PENDING", priority: "NORMAL", slaAt: day(2), requestedById: itStaff.id, assetId: a0181.id, employeeId: emp("EMP-0097").id, payload: { to: { assigneeId: emp("EMP-0097").id, status: "DEPLOYED" }, reason: "new hire setup" } },
      // deliberately incomplete (no assetId, bare payload): the detail page's system checks show honest failures; e2e rejects it, never executes it
      { refNo: "APR-2040", type: "lifecycle_return", state: "PENDING", priority: "URGENT", slaAt: day(-1), requestedById: itStaff.id, employeeId: emp("EMP-0090").id, payload: { reason: "offboarding" } },
      { refNo: "APR-2039", type: "lifecycle_change_status", state: "CLAIMED", priority: "NORMAL", slaAt: day(1), requestedById: itStaff.id, claimedById: admin.id, claimedAt: day(0), assetId: a0148.id, payload: { from: { status: "DEPLOYED" }, to: { status: "TEMPORARY" } } },
      // APR-2035 (Phase 13, APR-2035/D-8): this row carries no assetId and a
      // payload that names neither `to.assigneeId` nor `to.status`. Before D-8
      // the worker's first complaint about that was the payload shape; since
      // D-8, execute-approval.ts checks `!approval.assetId || !approval.asset`
      // BEFORE it ever inspects the payload, so the worker now fails this one
      // with "Execution guard: approval has no asset attached — nothing to
      // execute against" — the missing-asset guard, not a malformed-payload
      // complaint. Kept exactly as-is (no assetId attached) so this fixture
      // demonstrates that guard, honestly renamed rather than "fixed" to keep
      // exercising a payload check the worker no longer reaches first.
      { refNo: "APR-2035", type: "lifecycle_assign", state: "APPROVED", priority: "NORMAL", slaAt: day(1), requestedById: itStaff.id, claimedById: admin.id, claimedAt: day(-1), payload: { note: "queued for execution" } },
      { refNo: "APR-2031", type: "lifecycle_transfer", state: "EXECUTED", priority: "NORMAL", slaAt: day(-2), requestedById: itStaff.id, claimedById: admin.id, resolvedAt: day(-2), payload: { from: "EMP-0042", to: "EMP-0051" } },
      { refNo: "APR-2028", type: "lifecycle_replace", state: "REJECTED", priority: "HIGH", slaAt: day(-5), requestedById: itStaff.id, claimedById: admin.id, resolvedAt: day(-5), resolutionReason: "Replacement not justified; repair quote pending", payload: {} },
      { refNo: "APR-2025", type: "lifecycle_assign", state: "EXECUTION_FAILED", priority: "NORMAL", slaAt: day(-3), requestedById: itStaff.id, claimedById: admin.id, workerError: "Execution guard: target employee EMP-0093 is OFFBOARDED — assignment refused", payload: {} },
    ],
  });

  // Job queued for the APPROVED approval (worker executes it in Phase 4)
  const apr2035 = await prisma.approval.findUniqueOrThrow({ where: { refNo: "APR-2035" } });
  await prisma.job.create({ data: { type: "EXECUTE_APPROVAL", payload: { approvalId: apr2035.id } } });

  // Webhooks. Two endpoints so "disabled" is a real state on the list, and a
  // spread of deliveries so every chip deliveryStage() can produce is reachable
  // against a fresh database — including the DEAD · 5/5 row the design's
  // "Replay 4 dead-lettered" control exists for.
  //
  // Deliberately no Job rows for any of these deliveries. The deliveries below
  // are history, not a live queue — a queued DELIVER_WEBHOOK job would make
  // `npm run worker:once` try to POST to hooks.thebackroomop.com, which does
  // not resolve, on every seeded run. Contrast the APPROVED approval just
  // above, which DOES get a Job (line ~218): that one is meant to be picked up
  // and executed; these are meant to sit still as history.
  //
  // A fixture value, not a real secret — it signs nothing that leaves this machine.
  // The same value is reused for both endpoints, deliberately: secretAad(id)
  // binds each ciphertext to its own row, so two endpoints sharing a plaintext
  // secret is safe (a ciphertext lifted from one endpoint's row still refuses
  // to decrypt under the other's AAD), not an accidental copy-paste.
  const HOOK_SECRET = "seed-signing-secret-not-a-real-one";
  const [liveHook, offHook] = await Promise.all([
    prisma.webhookEndpoint.create({
      data: {
        url: "https://hooks.thebackroomop.com/inventory",
        events: ["approval.executed", "offboarding.completed"],
        active: true,
        secret: "",
      },
    }),
    prisma.webhookEndpoint.create({
      data: {
        url: "https://legacy.thebackroomop.com/erp-bridge",
        events: ["purchase_request.completed"],
        active: false,
        secret: "",
      },
    }),
  ]);
  // The AAD binds ciphertext to the row id, which only exists after the insert.
  // Not wrapped in $transaction: createEndpoint wraps this same pair because
  // it runs in a live app, where a concurrent request could read the row
  // between these two writes (see its comment: "the placeholder never leaves
  // this transaction").
  // A seed script has no concurrent reader — nothing else is connected to this
  // database while it runs — and if this throws partway (e.g. encryptSecret
  // finds no key), the mandatory TRUNCATE at the top of the next run discards
  // whatever this left behind. There is no window where a bad row is visible
  // and no partial state that survives to be fixed; a transaction here would
  // add rollback semantics for a script that's always rerun from scratch.
  await Promise.all([
    prisma.webhookEndpoint.update({
      where: { id: liveHook.id },
      data: { secret: encryptSecret(HOOK_SECRET, secretAad(liveHook.id)) },
    }),
    prisma.webhookEndpoint.update({
      where: { id: offHook.id },
      data: { secret: encryptSecret(HOOK_SECRET, secretAad(offHook.id)) },
    }),
  ]);

  await prisma.webhookDelivery.createMany({
    data: [
      // None of the three approval.executed rows below could have been
      // produced by the real execution path. APR-2035 and APR-2040 are not
      // EXECUTED (APPROVED and PENDING respectively), and approval.executed
      // only ever fires atomically with that transition. APR-2031 IS
      // EXECUTED, but it carries no assetId — execute-approval.ts:63-65
      // refuses to execute (and so never reaches the emitWebhook call at
      // ~line 179) for exactly that reason: `if (!approval.assetId ||
      // !approval.asset) return fail(...)`. So the assetId/assetTag on the
      // APR-2031 row below are as invented as the type/assetId on the other
      // two — there is no honest baseline among these three.
      //
      // Taken anyway, deliberately: approval.executed fires exactly once per
      // approval, and liveHook is this seed's only subscriber to it — so the
      // number of honest deliveries available here is exactly the number of
      // EXECUTED-approvals-that-have-an-assetId in this seed, which is ZERO.
      // (Not "a handful": there is no cap, one qualifying approval would buy
      // exactly one delivery.) The design needs four (to make
      // DELIVERED, RETRYING and DEAD · 5/5 all reachable and to produce the
      // "4 attempts" count on /admin/webhooks). Closing this gap for real
      // means adding EXECUTED approvals WITH an assetId to the seed, which is
      // NOT free: the handover pins this seed at "7 approvals (all 6
      // states)", IT Home's shift list and /approvals' counts derive from it,
      // and 89 existing e2e tests run over that data. Anyone tempted to
      // "correct" this by adding or editing approvals MUST run the full
      // `npx playwright test` suite first — do not touch this without doing
      // that. `type` is still the Prisma CLIENT value (underscored, matching
      // what execute-approval.ts actually passes as `approval.type`), not the
      // dotted @map'd column value — getting the representation right is
      // still worth doing even though the row itself is a licensed fiction.
      {
        endpointId: liveHook.id,
        event: "approval.executed",
        payload: { approvalId: "seed", refNo: "APR-2031", type: "lifecycle_transfer", assetId: a0148.id, assetTag: a0148.tag },
        status: "DELIVERED",
        attempts: 1,
        lastError: null,
        deliveredAt: day(-2),
      },
      {
        endpointId: liveHook.id,
        event: "offboarding.completed",
        payload: { employeeId: "seed", employeeNo: "EMP-0093", decisions: 2 },
        status: "DELIVERED",
        attempts: 2,
        lastError: null,
        deliveredAt: day(-1),
      },
      // Retrying, not yet dead. Same licence as APR-2031 above, same
      // structural reason (see that comment) — this row cites a real approval
      // and a real ApprovalType client value, but APR-2035 is seeded
      // APPROVED, not EXECUTED.
      {
        endpointId: liveHook.id,
        event: "approval.executed",
        payload: { approvalId: "seed", refNo: "APR-2035", type: "lifecycle_assign", assetId: a0181.id, assetTag: a0181.tag },
        status: "RETRYING",
        attempts: 2,
        lastError: "connect ETIMEDOUT 10.0.0.9:443",
        // deliver-webhook.ts clears this to null on a later success, and that
        // clear is only a real behaviour to see if this fixture starts with a
        // real value — mirrors the worker's own backoff shape (2**attempts *
        // 30s) without depending on it: no Job is queued for this delivery.
        nextAttemptAt: new Date(Date.now() + 2 ** 2 * 30_000),
      },
      // The row the design is about: five attempts spent, dead-lettered,
      // replayable. Same licence as APR-2031 above, same structural reason —
      // APR-2040 is seeded PENDING, not EXECUTED.
      {
        endpointId: liveHook.id,
        event: "approval.executed",
        payload: { approvalId: "seed", refNo: "APR-2040", type: "lifecycle_return", assetId: a0148.id, assetTag: a0148.tag },
        status: "DEAD",
        attempts: 5,
        lastError: "500 Internal Server Error",
      },
      // PR-0188 is this seed's one COMPLETED request — purchase_request.completed
      // only ever fires from COMPLETED (purchases/actions.ts's `complete`
      // branch), and unlike the two approval.executed rows above, there's no
      // structural reason to cite anything else here: offHook is subscribed
      // to only this one event, so a single delivery citing the seed's one
      // genuinely-completed request costs nothing and has no ceiling problem.
      {
        endpointId: offHook.id,
        event: "purchase_request.completed",
        payload: { purchaseRequestId: "seed", refNo: "PR-0188" },
        status: "DEAD",
        attempts: 5,
        lastError: "404 Not Found",
      },
    ],
  });

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

  // Advance the ref-number sequences past the seeded values so the first
  // allocated refNo continues the range instead of restarting at 0001.
  await prisma.$executeRawUnsafe(
    `SELECT setval('purchase_request_ref_seq', 201), setval('approval_ref_seq', 2041)`,
  );

  // ── Phase 19: stock control ───────────────────────────────────────────
  const stockCats = Object.fromEntries(
    (await Promise.all([
      prisma.stockCategory.create({ data: { name: "Office supplies", prefix: "OS", nextNumber: 6 } }),
      prisma.stockCategory.create({ data: { name: "Cleaning materials", prefix: "CM", nextNumber: 4 } }),
      prisma.stockCategory.create({ data: { name: "Pantry", prefix: "PN", nextNumber: 5 } }),
    ])).map((c) => [c.prefix, c]),
  );
  const stockRows: Array<[string, string, string, string, number | null, number, number]> = [
    // code, category, name, unit, packSize, reorderLevel, openingQty
    ["OS-0001", "OS", "Bond paper A4", "ream", 5, 10, 40],
    ["OS-0002", "OS", "Ballpen black", "piece", 12, 24, 120],
    ["OS-0003", "OS", "Sticky notes 3x3", "pad", 12, 12, 36],
    ["OS-0004", "OS", "Stapler wire no. 35", "box", null, 5, 18],
    ["OS-0005", "OS", "Folder long brown", "piece", 50, 50, 200],
    ["CM-0001", "CM", "Dishwashing liquid 1L", "bottle", 12, 6, 24],
    ["CM-0002", "CM", "Trash bag XL", "roll", null, 10, 30],
    ["CM-0003", "CM", "Hand soap refill 500ml", "bottle", 12, 6, 12],
    ["PN-0001", "PN", "3-in-1 coffee sachet", "sachet", 30, 60, 90],
    ["PN-0002", "PN", "Creamer sachet", "sachet", 50, 50, 150],
    ["PN-0003", "PN", "Sugar sachet", "sachet", 100, 100, 300],
    ["PN-0004", "PN", "Bottled water 500ml", "bottle", 24, 24, 96],
  ];
  const stockItems: Record<string, { id: string }> = {};
  for (const [code, cat, name, unit, packSize, reorderLevel, opening] of stockRows) {
    const item = await prisma.stockItem.create({
      data: { code, name, unit, packSize, reorderLevel, categoryId: stockCats[cat].id },
    });
    stockItems[code] = item;
    await prisma.stockMovement.create({
      data: { itemId: item.id, kind: "OPENING", quantity: opening, actorId: purchasing.id, occurredAt: day(-30), reason: "Opening stock" },
    });
  }
  const receipt = async (code: string, qty: number, daysAgo: number, unitCost: number, reference: string) => {
    const lot = await prisma.stockLot.create({
      data: { itemId: stockItems[code].id, supplierId: vendors[2].id, lotDate: day(-daysAgo), unitCost, quantity: qty, reference, receivedById: purchasing.id },
    });
    await prisma.stockMovement.create({ data: { itemId: stockItems[code].id, kind: "RECEIPT", quantity: qty, lotId: lot.id, actorId: purchasing.id, occurredAt: day(-daysAgo) } });
  };
  await receipt("OS-0001", 20, 21, 245, "DR-1101");
  await receipt("OS-0002", 60, 21, 8.5, "DR-1101");
  await receipt("CM-0001", 12, 18, 95, "DR-1102");
  await receipt("PN-0001", 60, 14, 9.25, "DR-1103");
  await receipt("PN-0002", 100, 14, 3.1, "DR-1103");
  await receipt("PN-0004", 48, 7, 12, "DR-1104");
  const issue = async (code: string, qty: number, daysAgo: number, dept: string, empNo: string | null, reason: string) => {
    await prisma.stockMovement.create({
      data: {
        itemId: stockItems[code].id, kind: "ISSUE", quantity: -qty, actorId: purchasing.id, occurredAt: day(-daysAgo),
        departmentId: depts[dept].id, employeeId: empNo ? emp(empNo).id : null, reason,
      },
    });
  };
  await issue("OS-0001", 12, 15, "Finance", null, "Monthly paper");
  await issue("OS-0002", 24, 12, "Sales", "EMP-0042", "New hires");
  await issue("PN-0001", 110, 6, "Operations", null, "Pantry restock");   // leaves PN-0001 at 40 < 60 → LOW
  await issue("PN-0004", 50, 3, "HR", null, "Town hall");
  await issue("CM-0002", 8, 9, "Operations", null, "Weekly cleaning");
  // One POSTED stocktake on Cleaning materials, ten days ago, with two adjustments.
  const st = await prisma.stocktake.create({
    data: {
      refNo: "ST-0001", categoryId: stockCats.CM.id, state: "POSTED", openedAt: day(-10), openedById: purchasing.id,
      postedAt: day(-10), postedById: purchasing.id, note: "Monthly pantry-side count",
      lines: { create: [
        { itemId: stockItems["CM-0001"].id, bookQty: 36, countedQty: 34, countedAt: day(-10), countedById: purchasing.id },
        { itemId: stockItems["CM-0002"].id, bookQty: 22, countedQty: 22, countedAt: day(-10), countedById: purchasing.id },
        { itemId: stockItems["CM-0003"].id, bookQty: 12, countedQty: 13, countedAt: day(-10), countedById: purchasing.id },
      ] },
    },
  });
  await prisma.stockMovement.createMany({
    data: [
      { itemId: stockItems["CM-0001"].id, kind: "ADJUSTMENT", quantity: -2, reason: "Stocktake ST-0001", stocktakeId: st.id, actorId: purchasing.id, occurredAt: day(-10) },
      { itemId: stockItems["CM-0003"].id, kind: "ADJUSTMENT", quantity: 1, reason: "Stocktake ST-0001", stocktakeId: st.id, actorId: purchasing.id, occurredAt: day(-10) },
    ],
  });
  await prisma.$executeRaw`SELECT setval('stocktake_ref_seq', 1)`;

  console.log("Seed complete.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
