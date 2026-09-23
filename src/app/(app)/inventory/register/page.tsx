import { requireRole } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { PageHeader } from "@/components/ui/page-header";
import { RegisterForm } from "@/components/inventory/register-form";
import { tagSuggestions } from "@/server/modules/inventory/tag-suggest";
import { activeEmployeeOptions } from "@/server/modules/employees/queries";
import { recentPicks } from "@/server/recent-picks";
import { toSearchParams } from "@/lib/url-state";
import { fmtDate } from "@/lib/format";
import {
  ASSET_CLASSES, REGISTRABLE_CLASSES, canRegisterClass, defaultClassFor, isDirectLifecycle, parseCls, withViewClsQS,
} from "@/lib/asset-class";

/**
 * Phase 30 (spec §5): the one Register flow — quantity 1 creates one asset
 * (with its initial state, holder, loan date and documents), more creates a
 * batch. Purchasing registers both classes, IT its own (Phase 14); the class
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

  const [categories, types, vendors, requests, employees, recentEmployees, recentVendors] = await Promise.all([
    prisma.assetCategory.findMany({
      where: { cls: { in: classes } },
      select: { id: true, name: true, cls: true },
      orderBy: { name: "asc" },
    }),
    prisma.assetType.findMany({
      where: { category: { cls: { in: classes } } },
      select: { id: true, name: true, categoryId: true },
      orderBy: { name: "asc" },
    }),
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

  // Both come from the same grouped reads (`tagSuggestions`): counts are per
  // category (the field the operator picks); the highest number is per
  // prefix, fleet-wide, because a tag is unique across the whole register.
  const suggestions = await tagSuggestions(categories.map((c) => c.id));
  const prefixCountsByCategory: Record<string, Array<{ prefix: string; n: number }>> =
    Object.fromEntries(Object.entries(suggestions).map(([id, s]) => [id, s.prefixes]));
  const highestByPrefix: Record<string, number> = Object.values(suggestions)[0]?.highest ?? {};

  // The breadcrumb names the list it opens: the class `?cls=` scoped to, else the viewer's own default.
  const defaultCls = defaultClassFor(user.role);
  const listCls = scopedCls ?? defaultCls;
  const listHref = "/inventory" + withViewClsQS("", listCls, defaultCls);

  return (
    <>
      <PageHeader
        title="Register assets"
        breadcrumb={[
          {
            label: listCls === "PURCHASING" ? "Purchasing assets" : "Inventory",
            href: listHref,
          },
          { label: "Register assets" },
        ]}
      />
      <RegisterForm
        categories={categories}
        types={types}
        vendors={vendors}
        recentVendors={recentVendors}
        employees={employees}
        recentEmployees={recentEmployees}
        requests={requests.map((r) => ({
          id: r.id,
          vendorId: r.vendorId,
          label: [r.refNo, r.vendor?.name, fmtDate(r.completedAt ?? r.updatedAt)].filter(Boolean).join(" · "),
        }))}
        prefixCountsByCategory={prefixCountsByCategory}
        highestByPrefix={highestByPrefix}
        directClasses={directClasses}
        defaultCls={defaultCls}
        listHref={listHref}
      />
    </>
  );
}
