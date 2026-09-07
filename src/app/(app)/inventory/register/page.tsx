import { requireRole } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { PageHeader } from "@/components/ui/page-header";
import { RegisterForm } from "@/components/inventory/register-form";
import { registerAssets, prefixCountsForCategory, highestTagNumber } from "@/server/modules/purchases/receiving";
import { REGISTRABLE_CLASSES } from "@/lib/asset-class";

export default async function RegisterAssetsPage() {
  // Phase 14: Purchasing registers assets of BOTH classes, IT registers IT
  // only — registering is not managing. The class check itself lives
  // server-side in `registerAssets`; this just scopes what the form offers
  // to pick from.
  const user = await requireRole("admin", "it_staff", "purchasing_staff");

  const [categories, types, vendors, requests] = await Promise.all([
    prisma.assetCategory.findMany({
      where: { cls: { in: [...REGISTRABLE_CLASSES[user.role]] } },
      select: { id: true, name: true, cls: true },
      orderBy: { name: "asc" },
    }),
    prisma.assetType.findMany({
      where: { category: { cls: { in: [...REGISTRABLE_CLASSES[user.role]] } } },
      select: { id: true, name: true, categoryId: true },
      orderBy: { name: "asc" },
    }),
    prisma.vendor.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.purchaseRequest.findMany({
      where: { state: "COMPLETED" },
      select: { id: true, refNo: true },
      orderBy: { refNo: "asc" },
    }),
  ]);

  // The client must not guess either of these — both come from the same
  // reads Task 4 already exposed for exactly this purpose. Counts are
  // per-category (a form field the user picks); the highest-number map is
  // keyed by prefix, not category, because a tag prefix is unique across the
  // whole fleet regardless of which category a caller happens to be viewing.
  const prefixCountEntries = await Promise.all(
    categories.map(async (c) => [c.id, await prefixCountsForCategory(c.id)] as const),
  );
  const prefixCountsByCategory: Record<string, Array<{ prefix: string; n: number }>> =
    Object.fromEntries(prefixCountEntries);

  const distinctPrefixes = [
    ...new Set(prefixCountEntries.flatMap(([, counts]) => counts.map((c) => c.prefix))),
  ];
  const highestEntries = await Promise.all(
    distinctPrefixes.map(async (p) => [p, await highestTagNumber(p)] as const),
  );
  const highestByPrefix: Record<string, number | null> = Object.fromEntries(highestEntries);

  return (
    <>
      <PageHeader
        title="Register assets"
        breadcrumb={[{ label: "Inventory", href: "/inventory" }, { label: "Register" }]}
      />
      <RegisterForm
        categories={categories}
        types={types}
        vendors={vendors}
        requests={requests}
        prefixCountsByCategory={prefixCountsByCategory}
        highestByPrefix={highestByPrefix}
        action={registerAssets}
      />
    </>
  );
}
