"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AssetClass, Role } from "@prisma/client";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { ReasonField } from "@/components/patterns/reason-field";
import { Spinner } from "@/components/ui/spinner";
import { SendBackPoDialog } from "@/components/purchases/send-back-po-dialog";
import { DOCUMENT_KINDS, DOCUMENT_KIND_LABEL, type DocumentKind } from "@/lib/documents";
import { uploadBatchDocument } from "@/server/modules/inventory/document-actions";
import { fmtMoneyExact } from "@/lib/format";
import { isMoneyKey } from "@/lib/intake-rules";
import { fieldLabels, REGISTRATION_FIELDS, REG_FIELD_GROUPS, type RegFieldKey, type RegState } from "@/lib/registration";
import {
  groupApproveToast, groupNotCapIssue, reopenReasonError, runGroupUndo,
} from "@/lib/finance-review-ui";
import { REOPEN_REASON_MAX, REOPEN_REASON_MIN } from "@/lib/finance-undo";
import { approveGroup } from "@/server/modules/finance/group-actions";
import { reopenGroup, undoGroupAction } from "@/server/modules/finance/undo-actions";
import { FixMoneyButton, type AssetMoney } from "./fix-money-dialog";
import { suggestedTeam } from "./send-back-dialog";
import { useFinanceRunner } from "./use-finance-runner";
import { TimedUndoBanner } from "./undo-banner";

type Team = "IT" | "PURCHASING";
const TEAM_LABEL: Record<Team, string> = { IT: "IT", PURCHASING: "Purchasing" };

export interface GroupReviewAsset {
  id: string;
  tag: string;
  serial: string | null;
  brand: string | null;
  model: string;
  cls: AssetClass;
  cost: number | null;
  reg: RegState;
  regLabel: string;
  /** "Sent back to IT: Serial number — “…”", for an asset that is with a team now. */
  returnLine: string | null;
  resubmitNote: string | null;
  /** An asset with no PO: its own money, fixed per row. */
  money: AssetMoney | null;
}

interface HoldBack {
  team: Team;
  fields: RegFieldKey[];
  note: string;
}

/**
 * Task 6 (spec §5): the group's assets and the one action that reviews them. Each asset with Finance can be held back —
 * to the team Finance picks, the one that owns what it ticks by default — or have its own "Not capitalised" over the
 * group's; the footer approves the rest in one go. Holding back is only marked here: nothing is sent until Approve.
 * Undo (the toast's, or the banner's for 15 minutes) takes back the whole action; an admin reopens a group's approvals.
 */
export function GroupReview({
  recordId, refNo, registeredByRole, blocked, assets, undo, canReopen, vendors,
}: {
  recordId: string;
  refNo: string | null;
  registeredByRole: Role | null;
  /** Why nothing can be approved now (the PO is with Purchasing, no SI number), or null. */
  blocked: string | null;
  assets: GroupReviewAsset[];
  undo: { label: string; msLeft: number; endsAt: number } | null;
  canReopen: boolean;
  vendors: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const toast = useToast();
  const { pending, error, retryAfter, setRetryAfter, run } = useFinanceRunner();
  const waiting = useMemo(() => assets.filter((a) => a.reg === "with-finance"), [assets]);
  const [groupNotCap, setGroupNotCap] = useState(() => waiting.length > 0 && waiting.every((a) => a.cost === null));
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [held, setHeld] = useState<Record<string, HoldBack>>({});
  const [holding, setHolding] = useState<GroupReviewAsset | null>(null);

  const notCapOf = (a: GroupReviewAsset) => overrides[a.id] ?? groupNotCap;
  const toApprove = waiting.filter((a) => !held[a.id]);
  const heldCount = waiting.length - toApprove.length;
  const issues = toApprove.map((a) => [a, groupNotCapIssue({ cost: a.cost, notCapitalised: notCapOf(a) })] as const).filter(([, i]) => i);

  const undoGroup = useCallback(
    (id: string) => void runGroupUndo(id, { call: undoGroupAction, toast: (m, tone) => toast(m, tone), refresh: () => router.refresh() }),
    [router, toast],
  );

  function approve() {
    run(
      () => approveGroup({
        recordId,
        notCapitalised: groupNotCap,
        assetIds: waiting.map((a) => a.id),
        overrides: Object.entries(overrides).filter(([id]) => !held[id]).map(([assetId, notCapitalised]) => ({ assetId, notCapitalised })),
        holdBack: Object.entries(held).map(([assetId, h]) => ({ assetId, team: h.team, fields: h.fields, note: h.note })),
      }),
      (d) => groupApproveToast({ recordId, refNo: d.refNo, approved: d.approved, heldBack: d.heldBack }, undoGroup),
      { onOk: () => { setHeld({}); setOverrides({}); } },
    );
  }

  const label = toApprove.length > 0 ? `Approve ${toApprove.length}` : `Send ${heldCount} back`;

  return (
    <div className="flex flex-col gap-4">
      {undo && <TimedUndoBanner state={undo} onUndo={() => runGroupUndo(recordId, { call: undoGroupAction, toast: (m, tone) => toast(m, tone), refresh: () => router.refresh() })} />}

      <Card>
        <CardHeader
          title={`Assets (${assets.length})`}
          actions={canReopen ? <ReopenGroupButton recordId={recordId} refNo={refNo} /> : undefined}
        />
        <Table>
          <THead>
            <Tr>
              <Th>Tag</Th>
              <Th>Serial</Th>
              <Th>Model</Th>
              <Th align="right">Cost</Th>
              <Th>State</Th>
              <Th>Not capitalised</Th>
              <Th aria-label="Hold back" />
            </Tr>
          </THead>
          <TBody>
            {assets.map((a) => {
              const open = a.reg === "with-finance";
              const h = held[a.id];
              const issue = open && !h ? groupNotCapIssue({ cost: a.cost, notCapitalised: notCapOf(a) }) : null;
              return (
                <Tr key={a.id}>
                  <Td mono><Link href={`/finance/assets/${a.id}`} className="text-accent hover:underline">{a.tag}</Link></Td>
                  <Td mono>{a.serial ?? "—"}</Td>
                  <Td><span className="block max-w-[14rem] truncate" title={[a.brand, a.model].filter(Boolean).join(" ")}>{[a.brand, a.model].filter(Boolean).join(" ")}</span></Td>
                  <Td align="right" mono>{a.cost === null ? "No cost" : fmtMoneyExact(a.cost)}</Td>
                  <Td wrap>
                    <span className="text-[12px]">{h ? `Held back → ${TEAM_LABEL[h.team]}: ${fieldLabels(h.fields).join(", ")}` : a.regLabel}</span>
                    {!h && a.returnLine && <span className="block text-[11px] text-fg-muted">{a.returnLine}</span>}
                    {open && !h && a.resubmitNote && <span className="block text-[11px] text-fg-muted">Replied: “{a.resubmitNote}”</span>}
                    {issue && <span className="block text-[11px] text-[var(--st-fault-text)]">{issue}</span>}
                  </Td>
                  <Td>
                    {open && !h && (
                      <Checkbox
                        aria-label={`${a.tag} not capitalised`}
                        checked={notCapOf(a)}
                        disabled={blocked !== null}
                        onChange={(e) => setOverrides((o) => ({ ...o, [a.id]: e.target.checked }))}
                      />
                    )}
                  </Td>
                  <Td align="right">
                    <span className="inline-flex items-center gap-2">
                      {a.money && (a.reg === "with-finance" || a.reg === "registered") && (
                        <FixMoneyButton target={{ kind: "asset", asset: a.money }} vendors={vendors} label="Fix money" />
                      )}
                      {open && (h
                        ? <Button size="sm" variant="ghost" onClick={() => setHeld((m) => Object.fromEntries(Object.entries(m).filter(([id]) => id !== a.id)))}>Keep</Button>
                        : <Button size="sm" disabled={blocked !== null} onClick={() => setHolding(a)}>Hold back…</Button>)}
                    </span>
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      </Card>

      {waiting.length > 0 && (
        <div
          data-cris-avoid=""
          className="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 rounded-(--radius-card) border border-border bg-surface px-4 py-3 shadow-card"
        >
          <label className="flex items-center gap-2 text-[13px] text-fg-secondary">
            <Switch
              checked={groupNotCap} aria-label="Not capitalised" disabled={blocked !== null}
              onCheckedChange={(v) => { setGroupNotCap(v); setOverrides({}); }}
            />
            Not capitalised
          </label>
          <span className="text-xs text-fg-muted">
            {toApprove.length} to approve{heldCount > 0 ? ` · ${heldCount} held back` : ""}
          </span>
          <div className="ml-auto flex items-center gap-2">
            {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
            <Button variant="primary" loading={pending} disabled={blocked !== null || issues.length > 0} onClick={approve}>{label}</Button>
          </div>
          {/* why it can't be approved is part of the page on every load (a status); an action's error interrupts */}
          {(blocked || error) && (
            <Banner className="w-full" tone="fault" live={blocked ? "status" : "alert"} title={blocked ?? error} />
          )}
        </div>
      )}

      <HoldBackDialog
        asset={holding}
        refNo={refNo}
        registeredByRole={registeredByRole}
        initial={holding ? held[holding.id] ?? null : null}
        onClose={() => setHolding(null)}
        onSave={(h) => {
          if (holding) setHeld((m) => ({ ...m, [holding.id]: h }));
          setHolding(null);
        }}
      />
    </div>
  );
}

/** The checklist, the team and the note for one held-back asset: checked here, sent with Approve. */
function HoldBackDialog({
  asset, refNo, registeredByRole, initial, onClose, onSave,
}: {
  asset: GroupReviewAsset | null;
  refNo: string | null;
  registeredByRole: Role | null;
  initial: HoldBack | null;
  onClose: () => void;
  onSave: (h: HoldBack) => void;
}) {
  const [ticked, setTicked] = useState<Set<RegFieldKey>>(new Set());
  const [team, setTeam] = useState<Team>("IT");
  const [picked, setPicked] = useState(false);
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const ctx = asset ? { cls: asset.cls, refNo, registeredByRole } : null;

  useEffect(() => {
    if (!asset || !ctx) return;
    setTicked(new Set(initial?.fields ?? []));
    setTeam(initial?.team ?? suggestedTeam(initial?.fields ?? [], ctx));
    setPicked(initial !== null);
    setNote(initial?.note ?? "");
    setProblem(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset?.id]);

  if (!asset || !ctx) return null;
  const locked = (k: RegFieldKey) => refNo !== null && k !== "other" && isMoneyKey(k);

  function toggle(key: RegFieldKey, on: boolean) {
    const next = new Set(ticked);
    if (on) next.add(key);
    else next.delete(key);
    setTicked(next);
    if (!picked && ctx) setTeam(suggestedTeam(REGISTRATION_FIELDS.filter((f) => next.has(f.key)).map((f) => f.key), ctx));
  }

  function save() {
    const fields = REGISTRATION_FIELDS.filter((f) => ticked.has(f.key)).map((f) => f.key);
    const text = note.trim();
    if (fields.length === 0) return setProblem("Tick at least one thing that's wrong");
    if (fields.includes("other") && !text) return setProblem("Explain “Other” in the note");
    if (text && text.length < 3) return setProblem("Say a little more — at least 3 characters");
    onSave({ team, fields, note: text });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Hold back ${asset.tag}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save}>Hold back for {TEAM_LABEL[team]}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-fg-secondary">
          {asset.tag} is left out of Approve and goes back to {TEAM_LABEL[team]} when you approve the rest.
          {refNo ? ` Money problems are ${refNo}'s: send ${refNo} back to Purchasing instead.` : ""}
        </p>
        {problem && <Banner tone="fault" title={problem} />}
        {REG_FIELD_GROUPS.map((group) => (
          <fieldset key={group} className="flex flex-col gap-1.5">
            <legend className="mb-1 text-xs font-medium text-fg">{group}</legend>
            {REGISTRATION_FIELDS.filter((f) => f.group === group).map((f) => (
              <label key={f.key} className="flex items-center gap-2 text-[13px] text-fg-secondary">
                <Checkbox checked={ticked.has(f.key)} disabled={locked(f.key)} onChange={(e) => toggle(f.key, e.target.checked)} />
                {f.label}
                {locked(f.key) && <span className="text-[11px] text-fg-muted">· on {refNo}</span>}
              </label>
            ))}
          </fieldset>
        ))}
        <FormField label="Send to" hint="The team that owns what you ticked">
          {(p) => (
            <Select
              id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid} value={team}
              onChange={(e) => { setTeam(e.target.value as Team); setPicked(true); }}
            >
              <option value="IT">IT</option>
              <option value="PURCHASING">Purchasing</option>
            </Select>
          )}
        </FormField>
        <FormField label={`Note for ${TEAM_LABEL[team]}`} hint="Optional — required for Other">
          {(p) => (
            <Textarea id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid} value={note}
              onChange={(e) => setNote(e.target.value)} maxLength={500} />
          )}
        </FormField>
      </div>
    </Dialog>
  );
}

/** An admin reopens every approved asset of the group, with a reason (spec §5: Reopen review, also for a group). */
function ReopenGroupButton({ recordId, refNo }: { recordId: string; refNo: string | null }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const { pending, error, fieldErrors, setFieldErrors, retryAfter, setRetryAfter, reset, run } = useFinanceRunner(["reason"]);
  const name = refNo ?? "this registration";

  function confirm() {
    const bad = reopenReasonError(reason);
    if (bad) return setFieldErrors({ reason: bad });
    run(
      () => reopenGroup({ recordId, reason }),
      (d) => ({ message: `Reopened ${d.reopened} from ${name}`, detail: "They are back in To review" }),
      { onOk: () => setOpen(false) },
    );
  }

  return (
    <>
      <Button size="sm" onClick={() => { reset(); setReason(""); setOpen(true); }}>Reopen review</Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Reopen the review of ${name}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
            <Button variant="danger" loading={pending} onClick={confirm}>Reopen review</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
          {error && <Banner tone="fault" title={error} />}
          <p className="text-[13px] text-fg-secondary">
            Every approved asset of {name} goes back to To review. Their history keeps the approvals and records this with
            your reason.
          </p>
          <ReasonField
            required hint={`${REOPEN_REASON_MIN} to ${REOPEN_REASON_MAX} characters`} error={fieldErrors.reason}
            value={reason} onChange={setReason} chips={[]} disabled={pending}
          />
        </div>
      </Dialog>
    </>
  );
}

/** A PO group's money problems go back to Purchasing on the PO (spec §5): the PO's own send-back. */
export function SendBackPoButton({ id, refNo }: { id: string; refNo: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="danger" onClick={() => setOpen(true)}>Send back to Purchasing</Button>
      <SendBackPoDialog open={open} onClose={() => setOpen(false)} id={id} refNo={refNo} />
    </>
  );
}

/**
 * A direct registration's documents sit on its assets: one upload is stored once and attached to every asset of the
 * group (uploadBatchDocument). Finance may upload or re-upload (spec §2); nothing is replaced or deleted.
 */
export function GroupDocsUpload({ assetIds }: { assetIds: string[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<DocumentKind>("invoice");
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);

  function upload(file: File) {
    setError(null);
    const fd = new FormData();
    for (const id of assetIds) fd.append("assetIds", id);
    fd.set("kind", kind);
    fd.set("file", file);
    startTransition(async () => {
      const res = await uploadBatchDocument(fd);
      if (res.ok) {
        toast("Document uploaded", "settled");
        router.refresh();
      } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      else setError(res.fieldErrors?.file ?? res.fieldErrors?.kind ?? res.message);
    });
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border-faint pt-3">
      {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
      {error && <Banner tone="fault" title="Upload rejected">{error}</Banner>}
      <div className="flex items-center gap-2">
        <Select aria-label="Document kind" value={kind} onChange={(e) => setKind(e.target.value as DocumentKind)} className="w-auto py-1.5 text-xs">
          {DOCUMENT_KINDS.map((k) => <option key={k} value={k}>{DOCUMENT_KIND_LABEL[k]}</option>)}
        </Select>
        {pending ? (
          <span className="inline-flex items-center gap-2 text-xs text-fg-secondary"><Spinner size={12} /> uploading…</span>
        ) : (
          <Button size="sm" onClick={() => input.current?.click()}>Upload</Button>
        )}
        <input
          ref={input} type="file" accept=".pdf,.png,.jpg,.jpeg" className="sr-only" aria-label="Document file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload(file);
            e.target.value = "";
          }}
        />
      </div>
      <p className="font-mono text-[10px] text-fg-faint">PDF · PNG · JPG — added to every asset of this group</p>
    </div>
  );
}
