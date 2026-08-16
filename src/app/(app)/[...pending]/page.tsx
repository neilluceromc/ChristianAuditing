import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Pill } from "@/components/ui/pill";
import { requireUser } from "@/server/auth/guards";

const PHASE_BY_PREFIX: Array<[RegExp, number]> = [
  [/^(inventory|employees)\/activity$/, 4],
  [/^(approvals|audit)(\/|$)/, 4],
  [/^(inventory|employees|admin\/(asset-categories|asset-types|departments))(\/|$)/, 3],
  [/^purchases(\/|$)/, 5],
  [/^finance(\/|$)/, 6],
  [/^(offboarding|reservations|admin\/equipment-policies)(\/|$)/, 7],
  [/^admin(\/|$)/, 8],
];

export default async function PendingPage({
  params,
}: {
  params: Promise<{ pending: string[] }>;
}) {
  await requireUser();
  const { pending } = await params;
  const path = pending.join("/");
  const phase = PHASE_BY_PREFIX.find(([re]) => re.test(path))?.[1] ?? 3;
  const last = pending[pending.length - 1] ?? "";
  const title = (last.replace(/-/g, " ") || "Screen").replace(/^\w/, (c) => c.toUpperCase());
  return (
    <>
      <PageHeader title={title} badge={<Pill>PLANNED</Pill>} />
      <EmptyState
        title={`This screen arrives in Phase ${phase}`}
        description={`/${path} is on the roadmap — the navigation is real, the page isn't built yet.`}
      />
    </>
  );
}
