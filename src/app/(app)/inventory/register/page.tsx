import { requireRole } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { PageHeader } from "@/components/ui/page-header";
import { RegisterForm } from "@/components/inventory/register-form";
import { registerAssets } from "@/server/modules/purchases/receiving";
import { tagSuggestions } from "@/server/modules/inventory/tag-suggest";
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
    prisma.vendor.findMany({
      where: { archivedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.purchaseRequest.findMany({
      where: { state: "COMPLETED" },
      select: { id: true, refNo: true, vendorId: true },
      orderBy: { refNo: "asc" },
    }),
  ]);

  // The client must not guess either of these — both come from the same
  // grouped reads (`tagSuggestions`, Task 11). Counts are per-category (a
  // form field the user picks); the highest-number map is keyed by prefix,
  // not category, because a tag prefix is unique across the whole fleet
  // regardless of which category a caller happens to be viewing — every
  // entry `tagSuggestions` returns carries that same fleet-wide map.
  const suggestions = await tagSuggestions(categories.map((c) => c.id));
  const prefixCountsByCategory: Record<string, Array<{ prefix: string; n: number }>> =
    Object.fromEntries(Object.entries(suggestions).map(([id, s]) => [id, s.prefixes]));
  const highestByPrefix: Record<string, number> = Object.values(suggestions)[0]?.highest ?? {};

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
