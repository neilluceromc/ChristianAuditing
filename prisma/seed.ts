import { PrismaClient, type AssetStatus } from "@prisma/client";
import bcrypt from "bcryptjs";
import { encryptSecret } from "../src/server/crypto";
import { secretAad } from "../src/server/webhooks/sign";

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
    status: status as AssetStatus,
    purchasedAt: day(-720), cost: 55_000, warrantyUntil: day(180), ...extra,
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
      // payload mirrors what requestAssign actually writes (assigneeId = row id, not employeeNo)
      { refNo: "APR-2041", type: "lifecycle_assign", state: "PENDING", priority: "NORMAL", slaAt: day(2), requestedById: itStaff.id, assetId: a0181.id, employeeId: emp("EMP-0097").id, payload: { to: { assigneeId: emp("EMP-0097").id, status: "DEPLOYED" }, reason: "new hire setup" } },
      // deliberately incomplete (no assetId, bare payload): the detail page's system checks show honest failures; e2e rejects it, never executes it
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

  console.log("Seed complete.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
