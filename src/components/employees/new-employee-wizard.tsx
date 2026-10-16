"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FormError, FormField } from "@/components/ui/form-field";
import { GroupSelectOptions } from "@/components/ui/group-select-options";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { cn } from "@/lib/cn";
import { M365_CANONICAL } from "@/lib/labels";
import { SETUP_STATE_LABELS, VPN_CHOICES, setupSummary } from "@/lib/it-setup";
import { detailsMissing, type DetailsKey } from "@/lib/new-employee";
import type { PickerGroup } from "@/lib/groups";
import { createEmployee, nextEmployeeNo, spareOptions, type SpareLine } from "@/server/modules/employees/actions";
import { SameNameCheck } from "./same-name-check";
import { EmployeeNoCheck } from "./employee-no-check";
import { PolicyPanel } from "./policy-panel";

type Kind = "INTERNAL" | "CLIENT";
type SetupState = keyof typeof SETUP_STATE_LABELS;
type Step = 1 | 2 | 3;

const CUSTOM = "__custom";
const OTHER_VPN = "__other";
const STEPS: Array<{ n: Step; label: string }> = [
  { n: 1, label: "Details" }, { n: 2, label: "Equipment" }, { n: 3, label: "Check & create" },
];
const SETUP_ROWS = [
  { key: "entraStatus", label: "Entra / Intune connected" },
  { key: "autopilotStatus", label: "Autopilot" },
  { key: "argusStatus", label: "Argus" },
] as const;
const SETUP_OPTIONS = (Object.keys(SETUP_STATE_LABELS) as SetupState[]).filter((s) => s !== "REMOVED").map((s) => ({ value: s, label: SETUP_STATE_LABELS[s] }));
/** Server field errors that live inside the "More" fold, which opens to show them. */
const MORE_KEYS = ["m365Status"];

interface FormState {
  kind: Kind;
  departmentId: string;
  name: string;
  title: string;
  employeeNo: string;
  joinedAt: string;
  entraStatus: SetupState;
  autopilotStatus: SetupState;
  argusStatus: SetupState;
  vpnSelect: string;
  vpnOther: string;
  note: string;
  m365Select: string;
  m365Custom: string;
}

const blankForm = (kind: Kind, departmentId: string, employeeNo: string, today: string): FormState => ({
  kind, departmentId, name: "", title: "", employeeNo, joinedAt: today,
  entraStatus: "NOT_YET", autopilotStatus: "NOT_YET", argusStatus: "NOT_YET",
  vpnSelect: "None", vpnOther: "", note: "",
  m365Select: "", m365Custom: "",
});

/**
 * Phase 37 (spec §5): Add an employee in three steps — Details (who they work for, accounts & access, a first
 * note), Equipment (a spare per policy line, or a gap) and Check & create. Back and Next stay in the browser;
 * the server re-checks everything on create. Every step stays mounted (hidden when not current) so the live
 * checks and the same-name tick survive moving between steps.
 */
export function NewEmployeeWizard({
  groups, nextNo, today,
}: {
  groups: { internal: PickerGroup[]; client: PickerGroup[] };
  nextNo: string | null;
  today: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<FormState>(() => blankForm("INTERNAL", "", nextNo ?? "", today));
  const [step, setStep] = useState<Step>(1);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [lines, setLines] = useState<SpareLine[] | null>(null);
  const [linesFor, setLinesFor] = useState<string | null>(null);
  const [linesError, setLinesError] = useState<string | null>(null);
  const [loadingLines, setLoadingLines] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [confirmSameName, setConfirmSameName] = useState(false);
  const [sameNameRefusal, setSameNameRefusal] = useState<string | null>(null);
  // Which create button fired, read from the DOM submitter (employee-form.tsx's ruling R10).
  const [submittedIntent, setSubmittedIntent] = useState<"create" | "create-add" | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const nameRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLFormElement>(null);
  const headingRef = useRef<HTMLSpanElement>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));
  const kindGroups = form.kind === "CLIENT" ? groups.client : groups.internal;
  const groupWord = form.kind === "CLIENT" ? "Client" : "Department";
  const group = [...groups.internal, ...groups.client].find((g) => g.id === form.departmentId) ?? null;
  const linesKey = `${form.departmentId}|${form.title.trim().toLowerCase()}`;
  const vpn = form.vpnSelect === OTHER_VPN ? form.vpnOther.trim() : form.vpnSelect;

  // Focus the first invalid field after a refused Next or create (an effect: it must run after the commit
  // that paints aria-invalid — see employee-form.tsx).
  useEffect(() => {
    if (focusTick === 0) return;
    const first = rootRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    first?.focus();
    first?.scrollIntoView({ block: "center" });
  }, [focusTick]);

  // Step 2: load the lines and spares on entry, and again whenever the group or title changed since.
  useEffect(() => {
    if (step !== 2 || linesFor === linesKey || loadingLines || linesError) return;
    const key = linesKey;
    setLoadingLines(true);
    setLinesError(null);
    spareOptions({ departmentId: form.departmentId, title: form.title })
      .then((res) => {
        if (res.ok) {
          setLines(res.data.lines);
          setLinesFor(key);
          setPicks({});
        } else if (res.kind === "rate_limited") {
          setRetryAfter(res.retryAfterSec ?? 60);
          setLinesError(res.message);
        } else setLinesError(res.message);
      })
      // A dropped connection or a server throw must not leave step 2 loading forever: the error line
      // and its "Try again" recover it.
      .catch(() => setLinesError("Couldn't load their equipment — check the connection and try again."))
      .finally(() => setLoadingLines(false));
  }, [step, linesKey, linesFor, loadingLines, linesError, form.departmentId, form.title]);

  function goTo(next: Step) {
    setStep(next);
    setError(null);
    // Move focus to the step's own heading so keyboard and screen-reader users land in the new step.
    requestAnimationFrame(() => headingRef.current?.focus());
  }

  const missingLabel = (k: DetailsKey): string =>
    k === "name" ? "name" : k === "title" ? "title" : k === "departmentId" ? groupWord.toLowerCase()
      : k === "employeeNo" ? "employee no." : "start date";

  function nextFromDetails() {
    const missing = detailsMissing(form);
    const next: Record<string, string> = {};
    for (const k of missing) next[k] = `Fill in the ${missingLabel(k)}`;
    if (form.vpnSelect === OTHER_VPN && !form.vpnOther.trim()) next.vpn = "Name the VPN";
    setErrors(next);
    if (Object.keys(next).length) {
      setFocusTick((t) => t + 1);
      return;
    }
    setLinesError(null);
    goTo(2);
  }

  function nextFromEquipment() {
    if (loadingLines || linesFor !== linesKey) return;
    goTo(3);
  }

  const chosen = (lines ?? []).flatMap((l) => {
    const id = picks[l.key];
    const spare = id ? l.spares.find((s) => s.id === id) : undefined;
    return spare ? [{ line: l, spare }] : [];
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (step === 1) return nextFromDetails();
    if (step === 2) return nextFromEquipment();
    const intent = (e.nativeEvent as SubmitEvent).submitter?.getAttribute("value") ?? "create";
    const addAnother = intent === "create-add";
    setSubmittedIntent(addAnother ? "create-add" : "create");
    setError(null);
    setSameNameRefusal(null);
    startTransition(async () => {
      const m365Status =
        form.m365Select === "" ? null : form.m365Select === CUSTOM ? form.m365Custom.trim() || null : form.m365Select;
      const res = await createEmployee({
        name: form.name, title: form.title, m365Status,
        departmentId: form.departmentId, employeeNo: form.employeeNo, joinedAt: form.joinedAt, confirmSameName,
        entraStatus: form.entraStatus, autopilotStatus: form.autopilotStatus, argusStatus: form.argusStatus,
        vpn, note: form.note,
        assign: linesFor === linesKey ? chosen.map((c) => ({ assetId: c.spare.id })) : [],
      });
      if (res.ok) {
        const { id, assigned, failed } = res.data;
        if (!addAnother) {
          router.push(`/employees/${id}?created=1&assigned=${assigned}${failed.length ? "&failed=" + encodeURIComponent(JSON.stringify(failed)) : ""}`);
          return;
        }
        toast(`Added ${form.name}${assigned ? ` · ${assigned === 1 ? "1 item" : `${assigned} items`} assigned` : ""}`, "settled");
        for (const f of failed) toast(`${f.tag} could not be assigned: ${f.reason}`, "fault");
        // A fresh person in the same group: Works for and the group stay, everything else resets.
        setForm(blankForm(form.kind, form.departmentId, "", today));
        setPicks({});
        setLines(null);
        setLinesFor(null);
        setErrors({});
        setMoreOpen(false);
        setConfirmSameName(false);
        setStep(1);
        requestAnimationFrame(() => nameRef.current?.focus());
        // The number just used is gone — prefill the next free one, unless something was typed meanwhile.
        void nextEmployeeNo().then((n) => {
          if (n.ok && n.data.next) setForm((f) => (f.employeeNo ? f : { ...f, employeeNo: n.data.next! }));
        });
        return;
      }
      if (res.kind === "rate_limited") return setRetryAfter(res.retryAfterSec ?? 60);
      if (res.kind !== "validation") return setError(res.message);
      const { _sameName, ...rest } = res.fieldErrors ?? {};
      const assignKey = Object.keys(rest).find((k) => k.startsWith("assign"));
      if (assignKey) {
        setError(rest[assignKey]);
        setStep(2);
        return;
      }
      const unclaimed = rest._form ?? rest.id;
      if (unclaimed) setError(unclaimed);
      setErrors(rest);
      setSameNameRefusal(_sameName ?? null);
      if (MORE_KEYS.some((k) => k in rest)) setMoreOpen(true);
      setStep(1);
      setFocusTick((t) => t + 1);
    });
  }

  const sortedLines = [...(lines ?? [])].sort((a, b) => Number(b.required) - Number(a.required));
  const pickedElsewhere = (assetId: string, key: string) =>
    Object.entries(picks).some(([k, v]) => k !== key && v === assetId);

  const detailsRows: Array<[string, string]> = [
    ["Name", form.name.trim()],
    ["Works for", group ? `${form.kind === "CLIENT" ? "Client" : "Internal"} · ${group.name}` : "—"],
    ["Title", form.title.trim()],
    ["Employee no.", form.employeeNo.trim()],
    ["Start date", form.joinedAt],
    ...(form.m365Select ? [["Account status", form.m365Select === CUSTOM ? form.m365Custom.trim() : form.m365Select] as [string, string]] : []),
  ];

  return (
    <form ref={rootRef} onSubmit={submit} noValidate className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-4">
        <ol aria-label="Steps" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]">
          {STEPS.map((s, i) => (
            <li key={s.n} aria-current={step === s.n ? "step" : undefined}
              className={cn("flex items-center gap-2", step === s.n ? "font-semibold text-fg" : "text-fg-muted")}>
              {i > 0 && <span aria-hidden className="text-fg-muted">·</span>}
              <span className={cn(
                "inline-flex size-5 items-center justify-center rounded-full border text-[11px]",
                step === s.n ? "border-accent bg-accent text-accent-fg" : "border-border-strong",
              )}>{s.n}</span>
              {s.label}
            </li>
          ))}
        </ol>

        {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
        {error && <Banner tone="fault" title={error} />}

        {/* Step 1 — Details */}
        <div hidden={step !== 1}>
          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader title={<span ref={step === 1 ? headingRef : undefined} tabIndex={-1} className="outline-none">Details</span>} />
              <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField label="Name" required error={errors.name} className="sm:col-span-2">
                  {(p) => (
                    <Input
                      id={p.id} ref={nameRef} autoFocus aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                      value={form.name} onChange={(e) => set("name", e.target.value)}
                      onBlur={() => setForm((f) => ({ ...f, name: f.name.trim() }))}
                    />
                  )}
                </FormField>
                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <span className="text-xs font-medium text-fg">Works for</span>
                  <SegmentedControl
                    aria-label="Works for" className="self-start"
                    options={[{ value: "INTERNAL", label: "Internal" }, { value: "CLIENT", label: "Client staff" }]}
                    value={form.kind}
                    onChange={(v) => setForm((f) => ({ ...f, kind: v as Kind, departmentId: "" }))}
                  />
                </div>
                <FormField label={groupWord} required error={errors.departmentId}>
                  {(p) => (
                    <Select id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                      value={form.departmentId} onChange={(e) => set("departmentId", e.target.value)}>
                      <option value="">{form.kind === "CLIENT" ? "Choose a client" : "Choose a department"}</option>
                      <GroupSelectOptions groups={kindGroups} />
                    </Select>
                  )}
                </FormField>
                <FormField label="Title" required error={errors.title} hint="Title drives role-based equipment policies.">
                  {(p) => (
                    <Input
                      id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                      value={form.title} onChange={(e) => set("title", e.target.value)}
                      onBlur={() => setForm((f) => ({ ...f, title: f.title.trim() }))}
                    />
                  )}
                </FormField>
                <div className="sm:col-span-2">
                  <SameNameCheck
                    name={form.name} departmentId={form.departmentId} onConfirmChange={setConfirmSameName}
                    refusal={sameNameRefusal}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <FormField label="Employee no." required error={errors.employeeNo} hint="Any text up to 60 characters; must be unique.">
                    {(p) => (
                      <Input
                        id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                        value={form.employeeNo} onChange={(e) => set("employeeNo", e.target.value)}
                        onBlur={() => setForm((f) => ({ ...f, employeeNo: f.employeeNo.trim() }))}
                      />
                    )}
                  </FormField>
                  <EmployeeNoCheck value={form.employeeNo} onUse={(no) => set("employeeNo", no)} />
                </div>
                <FormField label="Start date" required error={errors.joinedAt} hint="defaults to today">
                  {(p) => <Input id={p.id} type="date" aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                    value={form.joinedAt} onChange={(e) => set("joinedAt", e.target.value)} />}
                </FormField>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Accounts & access" />
              <CardBody className="flex flex-col gap-3">
                {SETUP_ROWS.map((row) => (
                  <div key={row.key} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[12.5px] text-fg-secondary">{row.label}</span>
                    <SegmentedControl
                      aria-label={row.label} options={SETUP_OPTIONS} value={form[row.key]}
                      onChange={(v) => set(row.key, v as SetupState)}
                    />
                  </div>
                ))}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <FormField label="VPN" error={form.vpnSelect === OTHER_VPN ? undefined : errors.vpn}>
                    {(p) => (
                      <Select id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                        value={form.vpnSelect} onChange={(e) => set("vpnSelect", e.target.value)}>
                        {VPN_CHOICES.map((c) => <option key={c} value={c}>{c}</option>)}
                        <option value={OTHER_VPN}>Other…</option>
                      </Select>
                    )}
                  </FormField>
                  {form.vpnSelect === OTHER_VPN && (
                    <FormField label="Which service" required error={errors.vpn} hint="Up to 40 characters.">
                      {(p) => (
                        <Input id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid} maxLength={40}
                          value={form.vpnOther} onChange={(e) => set("vpnOther", e.target.value)} />
                      )}
                    </FormField>
                  )}
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardBody>
                <FormField label="First note" error={errors.note} hint="Optional — it starts their Notes log. Up to 2000 characters.">
                  {(p) => (
                    <Textarea id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid} maxLength={2000}
                      value={form.note} onChange={(e) => set("note", e.target.value)} />
                  )}
                </FormField>
              </CardBody>
            </Card>

            <details open={moreOpen} onToggle={(e) => setMoreOpen(e.currentTarget.open)}
              className="rounded-(--radius-card) border border-border bg-surface px-4 py-3">
              <summary className="cursor-pointer text-[12.5px] font-medium text-fg-secondary">More</summary>
              <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField label="Account status" error={errors.m365Status}
                  hint="Set when the M365 account exists; the directory sync fills it in later.">
                  {(p) => (
                    <Select id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                      value={form.m365Select} onChange={(e) => set("m365Select", e.target.value)}>
                      <option value="">no sync yet</option>
                      {M365_CANONICAL.map((s) => <option key={s} value={s}>{s}</option>)}
                      <option value={CUSTOM}>custom…</option>
                    </Select>
                  )}
                </FormField>
                {form.m365Select === CUSTOM && (
                  <FormField label="Custom value" hint="Stored exactly as typed.">
                    {(p) => (
                      <Input id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                        value={form.m365Custom} onChange={(e) => set("m365Custom", e.target.value)}
                        onBlur={() => setForm((f) => ({ ...f, m365Custom: f.m365Custom.trim() }))} />
                    )}
                  </FormField>
                )}
              </div>
            </details>
          </div>
        </div>

        {/* Step 2 — Equipment */}
        <div hidden={step !== 2}>
          <Card>
            <CardHeader title={<span ref={step === 2 ? headingRef : undefined} tabIndex={-1} className="outline-none">Equipment</span>} />
            <CardBody className="flex flex-col gap-3">
              {loadingLines || (lines === null && !linesError) ? (
                <p className="text-[12.5px] text-fg-muted" aria-busy="true">Loading their equipment…</p>
              ) : linesError ? (
                <div className="flex items-center gap-3">
                  <FormError>{linesError}</FormError>
                  <Button type="button" size="sm" variant="secondary" onClick={() => setLinesError(null)}>Try again</Button>
                </div>
              ) : sortedLines.length === 0 ? (
                <p className="text-[12.5px] text-fg-muted">Nothing to assign yet — add equipment from their profile after creating.</p>
              ) : (
                <>
                <ul className="flex flex-col gap-3">
                  {sortedLines.map((line) => {
                    const selectId = `spare-${line.key.replace(":", "-")}`;
                    return (
                      <li key={line.key} className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[minmax(0,180px)_minmax(0,1fr)]">
                        <div className="flex items-center gap-2">
                          {line.loaner
                            ? <span className="text-[12.5px] font-medium text-fg">{line.label}</span>
                            : <label htmlFor={selectId} className="text-[12.5px] font-medium text-fg">{line.label}</label>}
                          <Pill tone={line.required ? "accent" : "neutral"}>{line.required ? "Required" : "Optional"}</Pill>
                        </div>
                        {line.loaner ? (
                          <p className="text-[12.5px] text-fg-muted">Filled by a loan later</p>
                        ) : (
                          <Select id={selectId} value={picks[line.key] ?? ""}
                            onChange={(e) => setPicks((p) => ({ ...p, [line.key]: e.target.value }))}>
                            <option value="">Leave as a gap</option>
                            {line.spares.map((s) => (
                              <option key={s.id} value={s.id} disabled={pickedElsewhere(s.id, line.key)}>{s.tag} · {s.model}</option>
                            ))}
                          </Select>
                        )}
                      </li>
                    );
                  })}
                </ul>
                </>
              )}
            </CardBody>
          </Card>
        </div>

        {/* Step 3 — Check & create */}
        <div hidden={step !== 3}>
          <Card>
            <CardHeader title={<span ref={step === 3 ? headingRef : undefined} tabIndex={-1} className="outline-none">Check & create</span>} />
            <CardBody className="flex flex-col gap-4 text-[12.5px]">
              <SummarySection title="Details" editLabel="Edit details" onEdit={() => goTo(1)}>
                <dl className="grid grid-cols-[120px_minmax(0,1fr)] gap-x-3 gap-y-1">
                  {detailsRows.map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-fg-muted">{k}</dt>
                      <dd className="text-fg">{v || "—"}</dd>
                    </div>
                  ))}
                </dl>
              </SummarySection>
              <SummarySection title="Accounts & access" editLabel="Edit accounts and access" onEdit={() => goTo(1)}>
                <p className="text-fg">
                  {setupSummary({ entraStatus: form.entraStatus, autopilotStatus: form.autopilotStatus, argusStatus: form.argusStatus, vpn: vpn || null })}
                </p>
              </SummarySection>
              <SummarySection title="Equipment" editLabel="Edit equipment" onEdit={() => goTo(2)}>
                {sortedLines.length === 0 ? (
                  <p className="text-fg-muted">Nothing to assign yet</p>
                ) : (
                  <ul className="flex flex-col gap-0.5">
                    {sortedLines.map((line) => {
                      const spare = line.spares.find((s) => s.id === picks[line.key]);
                      return (
                        <li key={line.key} className="text-fg">
                          {line.label}: {spare ? `${spare.tag} · ${spare.model}` : line.loaner ? "filled by a loan later" : "gap"}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </SummarySection>
              <SummarySection title="First note" editLabel="Edit the opening note" onEdit={() => goTo(1)}>
                <p className="whitespace-pre-wrap text-fg">{form.note.trim() || "None"}</p>
              </SummarySection>
            </CardBody>
          </Card>
        </div>

        <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center gap-3 border-t border-border bg-surface px-1 py-3">
          {step === 1 ? (
            <Button type="button" variant="ghost" onClick={() => router.back()}>Cancel</Button>
          ) : (
            <Button type="button" variant="ghost" disabled={pending} onClick={() => goTo((step - 1) as Step)}>Back</Button>
          )}
          {step < 3 ? (
            <Button type="submit" name="intent" value="next" variant="primary"
              disabled={step === 2 && (loadingLines || linesFor !== linesKey)}>
              Next
            </Button>
          ) : (
            <>
              {/* Both disable while anything is pending; the one that fired keeps its spinner (final review M-4). */}
              <Button type="submit" name="intent" value="create" variant="primary"
                disabled={pending} loading={pending && submittedIntent === "create"}>
                Create employee
              </Button>
              <Button type="submit" name="intent" value="create-add" variant="secondary"
                disabled={pending} loading={pending && submittedIntent === "create-add"}>
                Create and add another
              </Button>
            </>
          )}
        </div>
      </div>

      <aside aria-label="Equipment policy" className="self-start lg:sticky lg:top-4">
        <PolicyPanel title={form.title} departmentId={form.departmentId} groupName={group?.name ?? null} />
      </aside>
    </form>
  );
}

/**
 * One section of step 3. Every step stays mounted, so `editLabel` must never contain a step-1/2 field label
 * (house rule: an aria-label near a field never repeats that field's label word, or `getByLabel` finds both).
 */
function SummarySection({ title, editLabel, onEdit, children }: {
  title: string; editLabel: string; onEdit: () => void; children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-1.5 border-b border-border-faint pb-3 last:border-b-0 last:pb-0">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-[0.06em] text-fg-muted">{title}</h3>
        <button type="button" className="text-[12px] text-accent underline" aria-label={editLabel} onClick={onEdit}>Edit</button>
      </div>
      {children}
    </section>
  );
}
