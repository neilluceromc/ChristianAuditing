import { notFound } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/server/auth/guards";
import { getWizard } from "@/server/modules/offboarding/queries";
import { canContinue, OUTCOME_LABEL, OUTCOME_STATUS, parseStep } from "@/lib/offboarding";
import { fmtMoney } from "@/lib/format";
import { toSearchParams } from "@/lib/url-state";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Pill } from "@/components/ui/pill";
import { Stat } from "@/components/ui/stat";
import { StatusDot, StatusPill } from "@/components/ui/status";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { AccountsPanel } from "@/components/offboarding/accounts-panel";
import { CompleteButton } from "@/components/offboarding/complete-button";
import { ItemDecision } from "@/components/offboarding/item-decision";
import { WizardSteps } from "@/components/offboarding/wizard-steps";

export default async function OffboardingWizardPage({
  params,
  searchParams,
}: {
  params: Promise<{ employeeId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const { employeeId } = await params;
  const step = parseStep(toSearchParams(await searchParams).get("step"));
  const data = await getWizard(employeeId);
  if (!data) notFound();

  const { employee, items, totals, undecided } = data;
  const canMutate = user.role === "admin" || user.role === "it_staff";
  const active = employee.employment === "OFFBOARDING";
  const canDecide = canMutate && active;
  const unlocked = canContinue("collect", { undecided });
  const href = (s: string) => `/offboarding/${employeeId}?step=${s}`;
  const decided = items.filter((i) => i.decision);

  return (
    <>
      <PageHeader
        title={employee.name}
        breadcrumb={[{ label: "Offboarding", href: "/offboarding" }, { label: employee.employeeNo }]}
        badge={
          <span className="inline-flex items-center gap-1.5">
            <StatusDot value={employee.employment} ns="employment" />
            <span className="font-mono text-[10.5px] text-fg-muted">{employee.employment}</span>
            {user.role === "viewer" && <Pill>READ-ONLY · VIEWER</Pill>}
          </span>
        }
        actions={
          <>
            <ButtonLink href={`/employees/${employeeId}`}>Employee record</ButtonLink>
            <ButtonLink href={`/offboarding/${employeeId}/report`}>Farewell report</ButtonLink>
          </>
        }
      />

      <WizardSteps employeeId={employeeId} current={step} unlocked={unlocked} />

      {!active && (
        <div className="pb-4">
          <Banner
            tone={employee.employment === "OFFBOARDED" ? "closed" : "attention"}
            title={
              employee.employment === "OFFBOARDED"
                ? `${employee.name} is already offboarded — this is the record of what happened`
                : `${employee.name} reads ${employee.employment}, not OFFBOARDING`
            }
          >
            {employee.employment === "OFFBOARDED" ? (
              <>Every decision below stays readable, and so does the{" "}
                <Link href={`/offboarding/${employeeId}/report`} className="text-accent hover:underline">
                  farewell report
                </Link>.
              </>
            ) : (
              <>Set their employment to <span className="font-mono">OFFBOARDING</span> on the{" "}
                <Link href={`/employees/${employeeId}/edit`} className="text-accent hover:underline">
                  employee record
                </Link>{" "}
                before collecting equipment.
              </>
            )}
          </Banner>
        </div>
      )}

      {step === "review" && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Items out" value={String(items.filter((i) => i.held).length)} />
            <Stat label="Decided" value={`${decided.length} / ${items.length}`} />
            <Stat label="Book value out" value={fmtMoney(items.reduce((s, i) => s + (i.cost ?? 0), 0))} />
            <Stat label="M365" value={employee.m365Status ?? "no sync yet"} />
          </div>
          {data.slots.length > 0 ? (
            <Card>
              <CardHeader
                title="Against their policy"
                actions={<span className="font-mono text-[10.5px] text-fg-muted">{data.policyName}</span>}
              />
              <CardBody className="grid grid-cols-2 gap-[11px] lg:grid-cols-4">
                {data.slots.map((s) => (
                  <div
                    key={s.name}
                    className={
                      s.tag
                        ? "flex flex-col gap-1 rounded-(--radius-card) border border-border bg-surface p-3"
                        : "flex flex-col gap-1 rounded-(--radius-card) border border-dashed border-border-strong p-3"
                    }
                  >
                    <span className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-fg-muted">{s.name}</span>
                    {s.tag ? (
                      <>
                        <span className="text-[11.5px] font-medium text-fg">{s.model}</span>
                        <span className="font-mono text-[11px] text-accent">{s.tag}</span>
                        <span className="inline-flex items-center gap-1.5 font-mono text-[10px] text-fg-muted">
                          <StatusDot value={s.status ?? "SPARE"} />
                          {s.status}
                        </span>
                      </>
                    ) : (
                      // "not held" rather than "nothing to collect": an item that
                      // left their name without a return (a manual reassignment, a
                      // transfer) is the drift this screen exists to catch, and it
                      // must not read as reassurance
                      <span className="font-mono text-[10px] text-fg-muted">
                        not held · {s.typeName} · {s.required ? "required" : "optional"}
                      </span>
                    )}
                  </div>
                ))}
              </CardBody>
            </Card>
          ) : (
            <Banner tone="neutral" title="No equipment policy applies to this person">
              {employee.title} · {employee.department} has no policy, so there are no slots to check
              against — the holdings below are the whole picture.
            </Banner>
          )}

          <Card>
            <CardHeader title="Holdings" />
            {items.length === 0 ? (
              <CardBody>
                <p className="text-xs text-fg-muted">
                  They hold nothing and nothing was ever returned — go straight to Accounts &amp; M365.
                </p>
              </CardBody>
            ) : (
              <Table className="rounded-t-none border-0 shadow-none">
                <THead>
                  <Tr>
                    <Th width={19}><span className="sr-only">Status colour</span></Th>
                    <Th width={112}>Tag</Th>
                    <Th>Model</Th>
                    <Th width={96}>Category</Th>
                    <Th width={96}>Status</Th>
                    <Th width={112} align="right">Cost</Th>
                    <Th width={124}>Decision</Th>
                  </Tr>
                </THead>
                <TBody>
                  {items.map((i) => (
                    <Tr key={i.assetId}>
                      <Td className="pr-0"><StatusDot value={i.status} /></Td>
                      <Td mono>
                        <Link href={`/inventory/${i.assetId}`} className="text-accent hover:underline">{i.tag}</Link>
                      </Td>
                      <Td>{i.model}</Td>
                      <Td mono className="text-[10.5px]">{i.category}</Td>
                      <Td mono className="text-[10.5px]">{i.status}</Td>
                      <Td align="right" mono>{i.costLabel}</Td>
                      <Td mono className="text-[10.5px]">
                        {i.decision ? OUTCOME_LABEL[i.decision.outcome] : "—"}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>

          <div className="flex justify-end">
            <ButtonLink variant="primary" href={href("collect")}>Continue to Collect items</ButtonLink>
          </div>
        </div>
      )}

      {step === "collect" && (
        <div className="flex flex-col gap-4">
          <Banner tone="neutral" title="Each decision is recorded the moment you confirm it">
            Every item becomes its own <span className="font-mono">lifecycle.return</span> request, so a
            half-finished offboarding is still N correct records. Nothing moves until the approval
            executes — the asset keeps reading its current status meanwhile.
          </Banner>

          {items.filter((i) => i.held).length === 0 ? (
            <EmptyState
              title="Nothing left to collect"
              description="No equipment is still in their name."
              actions={<ButtonLink variant="primary" href={href("accounts")}>Continue to Accounts &amp; M365</ButtonLink>}
            />
          ) : (
            items
              .filter((i) => i.held)
              .map((i) => (
                <Card key={i.assetId}>
                  <CardHeader
                    title={
                      <span className="inline-flex items-baseline gap-2">
                        <span className="font-mono text-[13px] text-accent">{i.tag}</span>
                        <span>{i.model}</span>
                        <span className="font-mono text-[10.5px] text-fg-muted">{i.category} · {i.costLabel}</span>
                      </span>
                    }
                    actions={
                      i.decision ? (
                        <span className="inline-flex items-center gap-2">
                          <StatusPill
                            value={OUTCOME_STATUS[i.decision.outcome]}
                            label={OUTCOME_LABEL[i.decision.outcome]}
                          />
                          <StatusPill value={i.decision.state} />
                        </span>
                      ) : (
                        <Pill>UNDECIDED</Pill>
                      )
                    }
                  />
                  <CardBody>
                    {i.decision ? (
                      <div className="flex flex-col gap-1 text-xs text-fg-secondary">
                        <span className="font-mono text-[11px]">
                          <Link href="/approvals" className="text-accent hover:underline">{i.decision.refNo}</Link>
                          {" · "}
                          {i.status} → {OUTCOME_STATUS[i.decision.outcome]}
                        </span>
                        {i.decision.reason && <span>{i.decision.reason}</span>}
                        {i.decision.state === "EXECUTION_FAILED" && (
                          <span className="font-mono text-[10.5px]" style={{ color: "var(--st-fault-text)" }}>
                            execution failed — open the request to retry; the decision itself stands
                          </span>
                        )}
                      </div>
                    ) : i.blockedBy ? (
                      // one asset, one open request: a pending change-status would
                      // otherwise refuse the decision with no way to see why
                      <p className="text-xs" style={{ color: "var(--st-attention-text)" }}>
                        {i.tag} is held by{" "}
                        <Link href="/approvals" className="font-mono text-accent hover:underline">
                          {i.blockedBy.refNo}
                        </Link>{" "}
                        ({i.blockedBy.type}) — resolve that request first, then decide this item.
                      </p>
                    ) : canDecide ? (
                      <ItemDecision employeeId={employeeId} assetId={i.assetId} tag={i.tag} />
                    ) : (
                      <p className="text-xs text-fg-muted">
                        {active ? "Read-only — collecting equipment is an IT action." : "This offboarding is closed."}
                      </p>
                    )}
                  </CardBody>
                </Card>
              ))
          )}

          <div className="flex items-center justify-end gap-3">
            {unlocked ? (
              <ButtonLink variant="primary" href={href("accounts")}>Continue to Accounts &amp; M365</ButtonLink>
            ) : (
              <>
                <span className="font-mono text-[11px] font-medium" style={{ color: "var(--st-attention-text)" }}>
                  {undecided} item{undecided === 1 ? "" : "s"} undecided — undecided is not the same as returned
                </span>
                <Button variant="primary" disabled>Continue to Accounts &amp; M365</Button>
              </>
            )}
          </div>
        </div>
      )}

      {step === "accounts" && (
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Accounts & M365" />
            <CardBody className="flex flex-col gap-3">
              <p className="text-xs text-fg-secondary">
                Equipment is settled: {decided.length} decision{decided.length === 1 ? "" : "s"} recorded.
                What is left is the account itself.
              </p>
              {canDecide ? (
                <AccountsPanel employeeId={employeeId} m365Status={employee.m365Status} />
              ) : (
                <p className="font-mono text-[11px] text-fg-muted">
                  current status: {employee.m365Status ?? "no sync yet"}
                </p>
              )}
            </CardBody>
          </Card>
          <div className="flex justify-end">
            <ButtonLink variant="primary" href={href("report")}>Continue to Farewell report</ButtonLink>
          </div>
        </div>
      )}

      {step === "report" && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Recovered" value={fmtMoney(totals.recovered)} hint="returned + defective — back in the fleet" />
            <Stat label="Bought out" value={fmtMoney(totals.boughtOut)} hint="the employee paid for it" />
            <Stat label="Value lost" value={fmtMoney(totals.lost)} hint="missing — custody lost" />
            <Stat label="Items" value={`${decided.length} / ${items.length}`} hint="decided of held" />
          </div>

          <Card>
            <CardHeader
              title="What happened to the kit"
              actions={<ButtonLink size="sm" href={`/offboarding/${employeeId}/report`}>Printable report</ButtonLink>}
            />
            {decided.length === 0 ? (
              <CardBody>
                <p className="text-xs text-fg-muted">Nothing has been decided yet.</p>
              </CardBody>
            ) : (
              <Table className="rounded-t-none border-0 shadow-none">
                <THead>
                  <Tr>
                    <Th width={112}>Tag</Th>
                    <Th>Model</Th>
                    <Th width={112}>Outcome</Th>
                    <Th width={104}>Lands as</Th>
                    <Th>Reason</Th>
                    <Th width={112} align="right">Value</Th>
                    <Th width={132}>Request</Th>
                  </Tr>
                </THead>
                <TBody>
                  {decided.map((i) => (
                    <Tr key={i.assetId}>
                      <Td mono>
                        <Link href={`/inventory/${i.assetId}`} className="text-accent hover:underline">{i.tag}</Link>
                      </Td>
                      <Td>{i.model}</Td>
                      <Td>
                        <StatusPill
                          value={OUTCOME_STATUS[i.decision!.outcome]}
                          label={OUTCOME_LABEL[i.decision!.outcome]}
                        />
                      </Td>
                      <Td mono className="text-[10.5px]">{OUTCOME_STATUS[i.decision!.outcome]}</Td>
                      <Td>{i.decision!.reason ?? "—"}</Td>
                      <Td align="right" mono>{i.costLabel}</Td>
                      <Td mono className="text-[10.5px]">{i.decision!.refNo} · {i.decision!.state}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>

          {active && canMutate && (
            <div className="flex items-center justify-end gap-3">
              <span className="font-mono text-[10.5px] text-fg-muted">
                completing flips {employee.name} to OFFBOARDED — it does not touch equipment
              </span>
              <CompleteButton employeeId={employeeId} name={employee.name} itemCount={decided.length} />
            </div>
          )}
        </div>
      )}
    </>
  );
}
