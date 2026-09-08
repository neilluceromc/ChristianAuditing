import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/guards";
import { getSupplier } from "@/server/modules/suppliers/queries";
import { canManageSuppliers, canRevealBank } from "@/lib/supplier-access";
import { CONTRACT_STATUS_LABEL } from "@/lib/supplier-schema";
import { PROVENANCE_LABEL } from "@/lib/provenance";
import { fmtDate } from "@/lib/format";
import { toSearchParams } from "@/lib/url-state";
import { PageHeader } from "@/components/ui/page-header";
import { Pill } from "@/components/ui/pill";
import { ButtonLink } from "@/components/ui/button-link";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DescriptionList } from "@/components/ui/description-list";
import { Banner } from "@/components/ui/banner";
import { Table, THead, TBody, Th, Tr, Td } from "@/components/ui/table";
import { StatusPill } from "@/components/ui/status";
import { Pagination } from "@/components/ui/pagination";
import { ArchiveControls } from "@/components/suppliers/archive-controls";
import { BankAccountsCard } from "@/components/suppliers/bank-accounts-card";
import { SupplierDocumentsCard } from "@/components/suppliers/supplier-documents-card";

export default async function SupplierProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const sp = toSearchParams(await searchParams);
  const rpage = Math.max(1, Number.parseInt(sp.get("rpage") ?? "1", 10) || 1);
  const apage = Math.max(1, Number.parseInt(sp.get("apage") ?? "1", 10) || 1);
  const detail = await getSupplier(id, { requests: rpage, assets: apage });
  if (!detail) notFound();

  const manage = canManageSuppliers(user.role);
  const pastEnd = detail.contractStatus === "ACTIVE" && detail.contractEnd !== null && detail.contractEnd < new Date();

  return (
    <>
      <PageHeader
        title={detail.name}
        breadcrumb={[
          { label: "Purchase requests", href: "/purchases" },
          { label: "Suppliers", href: "/purchases/suppliers" },
          { label: detail.name },
        ]}
        badge={
          <span className="inline-flex gap-2">
            {detail.category && <Pill>{detail.category}</Pill>}
            <Pill tone={detail.contractStatus === "ACTIVE" ? "accent" : "neutral"}>
              {CONTRACT_STATUS_LABEL[detail.contractStatus]}
            </Pill>
            {detail.archived && <Pill>ARCHIVED</Pill>}
          </span>
        }
        actions={
          manage ? (
            <>
              <ButtonLink href={`/purchases/suppliers/${id}/edit`}>Edit supplier</ButtonLink>
              <ArchiveControls id={id} archived={detail.archived} />
            </>
          ) : undefined
        }
      />

      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader title="Profile" />
          <CardBody>
            <DescriptionList
              items={[
                { label: "Registered name", value: detail.registeredName ?? "—" },
                { label: "Contact person", value: detail.contactPerson ?? "—" },
                { label: "Phone", value: detail.phone ?? "—" },
                { label: "Email", value: detail.email ?? "—" },
                { label: "Address", value: detail.address ?? "—" },
                { label: "Registration no.", value: detail.registrationNo ?? "—" },
                { label: "Notes", value: detail.notes ?? "—" },
              ]}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Contract" />
          <CardBody className="flex flex-col gap-3">
            {pastEnd && (
              <Banner tone="attention" title="This contract is past its end date — update the status." />
            )}
            <DescriptionList
              items={[
                {
                  label: "Status",
                  value: (
                    <Pill tone={detail.contractStatus === "ACTIVE" ? "accent" : "neutral"}>
                      {CONTRACT_STATUS_LABEL[detail.contractStatus]}
                    </Pill>
                  ),
                },
                { label: "Start", value: fmtDate(detail.contractStart) },
                { label: "End", value: fmtDate(detail.contractEnd) },
                { label: "Terms", value: detail.contractTerms ?? "—" },
              ]}
            />
          </CardBody>
        </Card>

        <BankAccountsCard
          vendorId={id}
          accounts={detail.bankAccounts}
          canManage={manage}
          canReveal={canRevealBank(user.role)}
        />

        <SupplierDocumentsCard vendorId={id} docs={detail.documents} canUpload={manage} />

        <Card>
          <CardHeader title="Purchase requests" />
          <CardBody className="flex flex-col gap-3">
            {detail.requests.rows.length === 0 ? (
              <p className="py-2 text-center text-xs text-fg-muted">No purchase requests name this supplier yet.</p>
            ) : (
              <>
                <Table>
                  <THead>
                    <Tr>
                      <Th>Ref</Th>
                      <Th>State</Th>
                      <Th>Department</Th>
                      <Th>Requested by</Th>
                      <Th>Updated</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {detail.requests.rows.map((r) => (
                      <Tr key={r.id}>
                        <Td><Link href={`/purchases/${r.id}`} className="text-accent hover:underline">{r.refNo}</Link></Td>
                        <Td><StatusPill value={r.state} /></Td>
                        <Td>{r.department ?? "—"}</Td>
                        <Td>{r.requester}</Td>
                        <Td mono>{fmtDate(r.updatedAt)}</Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
                <Pagination
                  page={detail.requests.page}
                  pageCount={detail.requests.pageCount}
                  hrefFor={(p) => `?rpage=${p}&apage=${apage}`}
                />
              </>
            )}
            <Link href={`/purchases?supplier=${id}`} className="text-xs text-accent hover:underline">
              See all in requests
            </Link>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Registered assets" />
          <CardBody className="flex flex-col gap-3">
            {detail.assets.rows.length === 0 ? (
              <p className="py-2 text-center text-xs text-fg-muted">No assets are registered against this supplier.</p>
            ) : (
              <>
                <Table>
                  <THead>
                    <Tr>
                      <Th>Tag</Th>
                      <Th>Model</Th>
                      <Th>Status</Th>
                      <Th>Purchased</Th>
                      <Th>Provenance</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {detail.assets.rows.map((a) => (
                      <Tr key={a.id}>
                        <Td><Link href={`/inventory/${a.id}`} className="text-accent hover:underline">{a.tag}</Link></Td>
                        <Td>{a.model}</Td>
                        <Td><StatusPill value={a.status} /></Td>
                        <Td mono>{fmtDate(a.purchasedAt)}</Td>
                        <Td><Pill>{PROVENANCE_LABEL[a.provenance]}</Pill></Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
                <Pagination
                  page={detail.assets.page}
                  pageCount={detail.assets.pageCount}
                  hrefFor={(p) => `?rpage=${rpage}&apage=${p}`}
                />
              </>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
