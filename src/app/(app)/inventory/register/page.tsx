import { requireRole } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { PageHeader } from "@/components/ui/page-header";
import { RegisterForm } from "@/components/inventory/register-form";
import { NewEquipmentTabs } from "@/components/inventory/new-equipment-tabs";
import { registerCatalog } from "@/server/modules/inventory/register-queries";
import { queueCount } from "@/server/modules/inventory/label-queue";
import { activeEmployeeOptions } from "@/server/modules/employees/queries";
import { recentPicks } from "@/server/recent-picks";
import { toSearchParams } from "@/lib/url-state";
import { fmtDate } from "@/lib/format";
import {
  ASSET_CLASSES, MANAGEABLE_CLASSES, REGISTRABLE_CLASSES, canRegisterClass, defaultClassFor, isDirectLifecycle, parseCls,
  withViewClsQS,
} from "@/lib/asset-class";

/**
 * Phase 34 (spec §3, §4): the Register tab of New equipment. Phase 30's one
 * Register flow — quantity 1 creates one asset (with its initial state,
 * holder, loan date and documents), more creates a batch — now picks its
 * category from cards and its type from the model (`registerCatalog`). Purchasing registers both classes, IT its own (Phase 14); the class
 * checks themselves live in `createAsset` / `registerAssets`, this only scopes
 * what the form offers.
 */
export default async function RegisterAssetsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireRole("admin", "it_staff", "purchasing_staff");
  const cls = parseCls(toSearchParams(await searchParams).get("cls"));
  // `?cls=` narrows the categories only to a class this role may register —
  // admin arriving from the Purchasing view gets Purchasing's categories, not
  // whichever class's names sort first (D-14). Anything else is ignored.
  const scopedCls = cls !== null && canRegisterClass(user.role, cls) ? cls : null;
  const classes = scopedCls ? [scopedCls] : [...REGISTRABLE_CLASSES[user.role]];
  // The category (and so the class) can change client-side, so the form gets
  // every class this role applies lifecycle changes to directly, not one flag.
  const directClasses = ASSET_CLASSES.filter((c) => isDirectLifecycle(user.role, c));

  const [catalog, waiting, vendors, requests, employees, recentEmployees, recentVendors] = await Promise.all([
    registerCatalog(classes),
    // The Labels tab's badge counts what waits in the Labels tab's own scope
    // (ruling R20): the classes this role manages, plus what this user registered.
    queueCount(MANAGEABLE_CLASSES[user.role], user.id),
    prisma.vendor.findMany({
      where: { archivedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.purchaseRequest.findMany({
      where: { state: "COMPLETED" },
      select: { id: true, refNo: true, vendorId: true, completedAt: true, updatedAt: true, vendor: { select: { name: true } } },
      orderBy: [{ completedAt: "desc" }, { refNo: "desc" }],
    }),
    activeEmployeeOptions(),
    recentPicks(user.id, "employee"),
    recentPicks(user.id, "vendor"),
  ]);

  // The breadcrumb names the list it opens: the class `?cls=` scoped to, else the viewer's own default.
  const defaultCls = defaultClassFor(user.role);
  const listCls = scopedCls ?? defaultCls;
  const listHref = "/inventory" + withViewClsQS("", listCls, defaultCls);

  return (
    <>
      <PageHeader
        title="New equipment"
        breadcrumb={[
          {
            label: listCls === "PURCHASING" ? "Purchasing assets" : "Inventory",
            href: listHref,
          },
          { label: "Register" },
        ]}
      />
      <NewEquipmentTabs active="register" cls={listCls} waiting={waiting} />
      <RegisterForm
        catalog={catalog}
        vendors={vendors}
        recentVendors={recentVendors}
        employees={employees}
        recentEmployees={recentEmployees}
        requests={requests.map((r) => ({
          id: r.id,
          vendorId: r.vendorId,
          label: [r.refNo, r.vendor?.name, fmtDate(r.completedAt ?? r.updatedAt)].filter(Boolean).join(" · "),
        }))}
        directClasses={directClasses}
        defaultCls={defaultCls}
        listHref={listHref}
        baseUrl={process.env.APP_BASE_URL}
      />
    </>
  );
}
