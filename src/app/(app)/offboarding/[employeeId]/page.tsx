import { notFound } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/server/auth/guards";
import { getWizard } from "@/server/modules/offboarding/queries";
import { canContinue, OUTCOME_LABEL, OUTCOME_STATUS, parseStep } from "@/lib/offboarding";
import { fmtMoney } from "@/lib/format";
import { toSearchParams } from "@/lib/url-state";
import { APPROVAL_TYPE_LABEL } from "@/lib/labels";
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
import { ScanProvider } from "@/components/offboarding/scan-provider";
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
  // flatMap rather than filter so `decision` is structurally non-null on the
  // rows the report renders — the same reason decisionOf carries the outcome on
  // the surviving row instead of asserting it later
  const decided = items.flatMap((i) => (i.decision ? [{ ...i, decision: i.decision }] : []));
  const heldItems = items.filter((i) => i.held);

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
            <Stat label="Items out" value={String(heldItems.length)} />
            <Stat label="Decided" value={`${decided.length} / ${items.length}`} />
            {/* the same set as "Items out" beside it: `items` is held UNION
                already-returned, so reducing over all of it bills equipment the
                worker has already put back to the money still in their hands */}
            <Stat label="Book value out" value={fmtMoney(heldItems.reduce((s, i) => s + (i.cost ?? 0), 0))} />
            <Stat label="M365" value={employee.m365Status ?? "no sync yet"} />
          </div>
          {/* keyed on the POLICY, not the slot count: resolvePolicy matches on
              title/department regardless of how many slots the policy defines,
              so a policy with none would otherwise report itself as absent */}
          {data.policyName !== null && data.slots.length > 0 ? (
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
            <Banner
              tone="neutral"
              title={
                data.policyName === null
                  ? "No equipment policy applies to this person"
                  : `${data.policyName} defines no slots`
              }
            >
              {employee.title} · {employee.department}{" "}
              {data.policyName === null
                ? "has no policy, so there are no slots to check against"
                : "matches a policy that lists no equipment, so there is nothing to check against"}{" "}
              — the holdings below are the whole picture.
            </Banner>
          )}

          <Card>
            <CardHeader title="Holdings" />
            {items.length === 0 ? (
              <CardBody>
                <p className="text-xs text-fg-muted">
                  {/* "in this offboarding", not "ever": the item set is windowed by
                      offboardingAt, so a return from a previous holding is
                      correctly absent here and was not nothing */}
                  They hold nothing, and no return has been recorded in this offboarding — go
                  straight to Accounts &amp; M365.
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
        <ScanProvider
          canDecide={canDecide}
          items={items
            .filter((i) => i.held)
            .map((i) => ({
              assetId: i.assetId,
              tag: i.tag,
              decided: !!i.decision,
              blockedBy: i.blockedBy?.refNo ?? null,
            }))}
        >
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
                        {/* the same label decideItem's refusal uses — one block
                            explained two different ways is two bugs waiting */}
                        ({APPROVAL_TYPE_LABEL[i.blockedBy.type]}) — resolve that request
                        first, then decide this item.
                      </p>
                    ) : canDecide ? (
                      <ItemDecision employeeId={employeeId} assetId={i.assetId} tag={i.tag} />
                    ) : (
                      <p className="text-xs text-fg-muted">
                        {/* `active` is OFFBOARDING only, so its else covers
                            ACTIVE too — and telling someone the offboarding is
                            "closed" for a person who never started one points
                            the opposite way from the banner at the top of this
                            same page, which tells them to set the employment */}
                        {active
                          ? "Read-only — collecting equipment is an IT action."
                          : employee.employment === "OFFBOARDED"
                            ? "This offboarding is closed."
                            : "Not offboarding yet — set their employment first, then decisions can be recorded."}
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
        </ScanProvider>
      )}

      {step === "accounts" && (
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Accounts & M365" />
            <CardBody className="flex flex-col gap-3">
              <p className="text-xs text-fg-secondary">
                {/* not unconditional: rejecting one return in Approvals while the
                    operator stands here re-opens that item and WizardSteps
                    re-locks this step — this sentence must not go on saying the
                    kit is settled while the bar beside it says otherwise */}
                {unlocked ? (
                  <>
                    Equipment is settled: {decided.length} decision{decided.length === 1 ? "" : "s"} recorded.
                    What is left is the account itself.
                  </>
                ) : (
                  <>
                    {/* "still undecided", not "went back to": this step is reachable
                        both by a rejection re-opening a decided item AND by the
                        ?step= URL before anything was decided at all */}
                    {undecided} item{undecided === 1 ? "" : "s"} still undecided — go back to{" "}
                    <Link href={href("collect")} className="text-accent hover:underline">Collect items</Link>{" "}
                    before finishing. You can still close the account here.
                  </>
                )}
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
            {/* these total DECISIONS, not movements: decisionOf counts PENDING
                and EXECUTION_FAILED alongside EXECUTED, and the collect step's
                own banner promises "nothing moves until the approval executes".
                The hints say decided so the tiles stop claiming a recovery the
                completion gate would refuse to believe. */}
            <Stat label="Recovered" value={fmtMoney(totals.recovered)} hint="decided returned + defective — back in the fleet as each executes" />
            <Stat label="Bought out" value={fmtMoney(totals.boughtOut)} hint="decided buyout — the employee pays for it" />
            <Stat label="Value lost" value={fmtMoney(totals.lost)} hint="decided missing — custody lost" />
            <Stat label="Items" value={`${decided.length} / ${items.length}`} hint="decided of this offboarding" />
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
                          value={OUTCOME_STATUS[i.decision.outcome]}
                          label={OUTCOME_LABEL[i.decision.outcome]}
                        />
                      </Td>
                      <Td mono className="text-[10.5px]">{OUTCOME_STATUS[i.decision.outcome]}</Td>
                      <Td>{i.decision.reason ?? "—"}</Td>
                      <Td align="right" mono>{i.costLabel}</Td>
                      {/* linked like the collect step's copy of the same refNo —
                          the report is where you most want the jump */}
                      <Td mono className="text-[10.5px]">
                        <Link href="/approvals" className="text-accent hover:underline">{i.decision.refNo}</Link>
                        {" · "}
                        {i.decision.state}
                      </Td>
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
