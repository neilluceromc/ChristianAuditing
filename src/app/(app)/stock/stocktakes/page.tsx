import Link from "next/link";
import { requireUser } from "@/server/auth/guards";
import { listStocktakes } from "@/server/modules/stock/queries";
import { canManageStock } from "@/lib/stock-access";
import { fmtDate } from "@/lib/format";
import { toSearchParams } from "@/lib/url-state";
import { parsePage } from "@/lib/paging";
import { PageHeader } from "@/components/ui/page-header";
import { ButtonLink } from "@/components/ui/button-link";
import { Pill } from "@/components/ui/pill";
import { Table, THead, TBody, Th, Tr, Td } from "@/components/ui/table";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/empty-state";
import type { StocktakeState } from "@prisma/client";

const STATE_TONE: Record<StocktakeState, "neutral" | "accent"> = { OPEN: "accent", POSTED: "neutral", CANCELLED: "neutral" };

export default async function StocktakesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const sp = toSearchParams(await searchParams);
  const page = parsePage(sp);
  const data = await listStocktakes(page);
  const manage = canManageStock(user.role);

  const newAction = manage ? (
    <ButtonLink href="/stock/stocktakes/new" variant="primary">New stocktake</ButtonLink>
  ) : undefined;

  return (
    <>
      <PageHeader
        title="Stocktakes"
        breadcrumb={[{ label: "Stock items", href: "/stock" }, { label: "Stocktakes" }]}
        actions={newAction}
      />
      {data.rows.length > 0 ? (
        <div className="flex flex-col gap-3">
          <Table>
            <THead>
              <Tr>
                <Th>Ref</Th>
                <Th>Scope</Th>
                <Th>State</Th>
                <Th>Opened</Th>
                <Th>Posted</Th>
                <Th align="right">Counted</Th>
              </Tr>
            </THead>
            <TBody>
              {data.rows.map((s) => (
                <Tr key={s.id}>
                  <Td>
                    <Link href={`/stock/stocktakes/${s.id}`} className="text-accent hover:underline">{s.refNo}</Link>
                  </Td>
                  <Td>{s.scope}</Td>
                  <Td><Pill tone={STATE_TONE[s.state]}>{s.state}</Pill></Td>
                  <Td mono>{fmtDate(s.openedAt)}</Td>
                  <Td mono>{s.postedAt ? fmtDate(s.postedAt) : "—"}</Td>
                  <Td align="right" mono>{s.counted} / {s.total}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
          <Pagination page={data.page} pageCount={data.pageCount} hrefFor={(p) => (p > 1 ? `?page=${p}` : "?")} />
        </div>
      ) : (
        <EmptyState
          title="No stocktakes yet"
          description="Open one to start a blind count."
          actions={newAction}
        />
      )}
    </>
  );
}
