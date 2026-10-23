"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import type { Role } from "@prisma/client";
import { cn } from "@/lib/cn";
import { normalizeEmail } from "@/lib/auth-shared";
import { Avatar } from "@/components/ui/avatar";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { ComboOption } from "@/components/patterns/entity-combobox";
import {
  accessHistoryHref, canTurnOff, createdLabel, lastSignInLabel, passwordLabel, roleChangeNote, selfRoleChangeWarning,
  turnOffConfirm,
} from "@/lib/admin-users";
import {
  focusAfterAction, focusOnClose, focusOnOpen, panelMayTakeFocus, type PanelAction, type PanelStep,
} from "@/lib/users-panel-focus";
import type { UserEmployee, UserRow } from "@/server/modules/admin/queries";
import { EmployeePicker } from "./employee-picker";
import { RoleCards } from "./role-cards";
import { OffboardedNote } from "./users-table";
import { UserStatusLabel } from "./user-status";

/** A refusal to show in the panel: a conflict's sentence, or validation errors by field. */
export interface PanelNotice {
  message?: string;
  fieldErrors?: Record<string, string>;
}

/** What Save sends: only the fields that differ from the row. */
export interface UserChanges {
  role?: Role;
  name?: string;
  email?: string;
  employeeId?: string | null;
}

export interface PanelDraft {
  role: Role;
  name: string;
  email: string;
  employee: ComboOption | null;
}

export interface UserPanelProps {
  row: UserRow;
  actorId: string;
  /** ISO, the server's "now" (relative sign-in times) */
  now: string;
  /** an action for this person is in flight */
  busy: boolean;
  notice: PanelNotice | null;
  /** given when the panel is a drawer or sheet: shows Close */
  onClose?: () => void;
  /** every changed field, and the version the drafts were made on (`expectedUpdatedAt`) */
  onSave: (changes: UserChanges, expectedUpdatedAt: string) => void;
  onSetActive: (active: boolean) => void;
  onReset: () => void;
  onApprove: (role: Role, employeeId: string | null) => void;
  onDecline: () => void;
  /** Discard cleared the drafts: the field errors held by the page go too */
  onClearNotice?: () => void;
  /** told whenever the drafts start or stop differing (the page asks before moving away) */
  onDirtyChange?: (dirty: boolean) => void;
  /** the page wants to show someone else (or close) while drafts differ: ask first */
  leaving?: boolean;
  /** the answer: true discards the drafts and lets the page move on; false keeps editing */
  onLeave?: (discard: boolean) => void;
  /** tests only (no DOM to click in): the state to render */
  initial?: {
    draft?: Partial<PanelDraft>;
    /** the row the drafts were made on, when the page has since refreshed to `row` */
    base?: UserRow;
    confirmingOff?: boolean;
    editingName?: boolean;
    picking?: boolean;
    confirmingDecline?: boolean;
  };
}

const employeeOption = (e: UserEmployee | null): ComboOption | null =>
  e ? { value: e.id, label: e.name, sub: `${e.employeeNo} · ${e.groupLabel}` } : null;

const draftOf = (row: UserRow): PanelDraft => ({
  role: row.role, name: row.name, email: row.email, employee: employeeOption(row.employee),
});

/** The fields of `draft` that differ from `row` — what one Save writes. */
export function draftChanges(row: Pick<UserRow, "role" | "name" | "email" | "employee">, draft: PanelDraft): UserChanges {
  const changes: UserChanges = {};
  if (draft.role !== row.role) changes.role = draft.role;
  if (draft.name.trim() !== row.name) changes.name = draft.name.trim();
  if (normalizeEmail(draft.email) !== row.email) changes.email = draft.email.trim();
  if ((draft.employee?.value ?? null) !== (row.employee?.id ?? null)) changes.employeeId = draft.employee?.value ?? null;
  return changes;
}

/** Every control here is at least 44 px (fix round 1, I-2): the panel is the full-screen sheet on a phone. */
const TARGET = "h-11";
const LINK = "inline-flex min-h-11 items-center text-accent-soft-text underline-offset-2 hover:underline";

function Section({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cn("flex flex-col gap-2.5", className)}>
      <h3 id={id} className="sec">{title}</h3>
      {children}
    </section>
  );
}

/**
 * Users & access (spec §4.4; boards Users2, Tablet2, Phone2): one person's details. Beside the list from 1180 px, in a
 * drawer below it, full screen below 700 px (the caller decides; `onClose` adds the Close button).
 *
 * An approved account: Access (role cards and the role-change note), Employee record, Name & email (inline edit),
 * Sign-in (with Reset password…), Account (the "Account active" switch, which asks inline before turning off), the
 * access history link, and the Unsaved changes bar while any field differs. A waiting or declined sign-up: Approve
 * sign-up instead (role, employee record pre-searched with their name, Approve, Decline asking once), plus Name &
 * email. The permanent admin's panel states the lock and offers nothing that would be refused.
 *
 * Drafts (fix round 1): they are made on `base`, the row as it was when editing began. A refreshed row with nothing
 * drafted, or one that now matches the drafts (our own Save), is taken over silently; otherwise the panel asks
 * "Discard unsaved changes?" rather than dropping them, and Save keeps sending `base`'s version, so a stale save is
 * refused by the server instead of overwriting the other admin's change.
 *
 * Focus (fix round 1, I-1): every inline step moves focus to its first control and gives it back on close; an action's
 * answer puts focus where `focusAfterAction` says (users-panel-focus.ts).
 */
export function UserPanel({
  row, actorId, now, busy, notice, onClose, onSave, onSetActive, onReset, onApprove, onDecline, onClearNotice,
  onDirtyChange, leaving = false, onLeave, initial,
}: UserPanelProps) {
  const titleId = useId();
  const switchId = useId();
  const switchReasonId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [base, setBase] = useState<UserRow>(initial?.base ?? row);
  const [draft, setDraft] = useState<PanelDraft>(() => ({ ...draftOf(initial?.base ?? row), ...initial?.draft }));
  const [editingName, setEditingName] = useState(initial?.editingName ?? false);
  const [picking, setPicking] = useState(initial?.picking ?? false);
  const [confirmingOff, setConfirmingOff] = useState(initial?.confirmingOff ?? false);
  const [confirmingDecline, setConfirmingDecline] = useState(initial?.confirmingDecline ?? false);
  const [approveRole, setApproveRole] = useState<Role>("viewer");
  const [approveEmployee, setApproveEmployee] = useState<ComboOption | null>(null);
  /** the newer version the person chose to keep editing over */
  const [keptOver, setKeptOver] = useState<string | null>(null);
  /** a focus move to make after the next render; `invited` lets the discard question take focus from outside (N-2) */
  const [focusReq, setFocusReq] = useState<{ selectors: string[]; invited?: boolean } | null>(null);
  const lastAction = useRef<PanelAction | null>(null);

  const changes = draftChanges(base, draft);
  const dirty = Object.keys(changes).length > 0;

  // A refreshed row: take it over when nothing would be lost; otherwise keep the drafts and ask (below).
  if (row.updatedAt !== base.updatedAt && (!dirty || Object.keys(draftChanges(row, draft)).length === 0)) {
    setBase(row);
    setDraft(draftOf(row));
    setEditingName(false);
    setPicking(false);
    setConfirmingOff(false);
    setConfirmingDecline(false);
    setKeptOver(null);
  }
  const stale = row.updatedAt !== base.updatedAt && keptOver !== row.updatedAt;
  const asking = dirty && (leaving || stale);

  const locked = row.locked;
  const self = row.id === actorId;
  const signUp = row.approvalState !== "APPROVED";
  const errors = notice?.fieldErrors ?? {};
  const note = roleChangeNote(row.name, row.role, draft.role);
  const selfWarning = selfRoleChangeWarning(row.target, draft.role, actorId);
  const turnOff = canTurnOff({ id: actorId }, row.target);
  const switchReason = locked ?? (!row.disabled && !turnOff.allowed ? turnOff.reason : null);
  const at = new Date(now);
  const set = (patch: Partial<PanelDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const focus = (selectors: string[]) => setFocusReq({ selectors });

  // Focus requests run after the render that shows their target.
  useEffect(() => {
    if (!focusReq) return;
    const root = rootRef.current;
    const active = document.activeElement;
    if (root && panelMayTakeFocus(!active || active === document.body, !!active && root.contains(active), focusReq.invited)) {
      for (const selector of focusReq.selectors) {
        const el = root.querySelector<HTMLElement>(selector);
        if (el && !el.matches(":disabled")) {
          el.focus();
          break;
        }
      }
    }
    setFocusReq(null);
  }, [focusReq]);

  // An action's answer: the row refreshed (done) or a refusal showed.
  useEffect(() => {
    if (!lastAction.current) return;
    setFocusReq({ selectors: focusAfterAction(lastAction.current, "done") });
    lastAction.current = null;
  }, [row.updatedAt]);
  useEffect(() => {
    if (!notice || !lastAction.current) return;
    setFocusReq({ selectors: focusAfterAction(lastAction.current, "refused") });
    lastAction.current = null;
  }, [notice]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  // The discard question takes focus when it appears — even from the row just picked outside the panel (N-2).
  const [wasAsking, setWasAsking] = useState(asking);
  if (asking !== wasAsking) {
    setWasAsking(asking);
    if (asking) setFocusReq({ selectors: focusOnOpen("discard"), invited: true });
  }

  function act(action: PanelAction, run: () => void) {
    lastAction.current = action;
    run();
  }
  function open(step: PanelStep, show: () => void) {
    show();
    focus(focusOnOpen(step));
  }
  function close(step: PanelStep, hide: () => void) {
    hide();
    focus(focusOnClose(step));
  }

  /** Back to the row as it is now: drafts, open steps and the field errors all go. */
  function discard() {
    setBase(row);
    setDraft(draftOf(row));
    setEditingName(false);
    setPicking(false);
    setKeptOver(null);
    onClearNotice?.();
  }

  return (
    <div ref={rootRef} data-users-panel={row.id} className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-border-faint px-5 py-4">
        <Avatar name={row.name} size="xl" className="shrink-0" />
        <div className="min-w-0 flex-1">
          <h2 id={titleId} tabIndex={-1} data-focus="title" className="truncate text-[17px] font-semibold leading-tight text-fg focus:outline-none">
            {row.name}
          </h2>
          <span className="block truncate text-[12.5px] text-fg-muted">{row.email}</span>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close details"
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-(--radius-btn) bg-surface-subtle text-fg-secondary hover:bg-border-faint"
          >
            ✕
          </button>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-4">
        {locked && <Banner tone="neutral" live="off" title={locked} />}
        {notice?.message && <Banner tone="fault" title={notice.message} />}

        {signUp ? (
          <Section title="Approve sign-up">
            {row.approvalState === "DECLINED" && (
              <p className="text-[12.5px] text-fg-secondary">This sign-up was declined. You can still approve it.</p>
            )}
            <dl className="grid grid-cols-[96px_1fr] gap-x-2.5 gap-y-1.5 text-[12.5px]">
              <dt className="text-fg-muted">Name</dt><dd className="m-0 text-fg">{row.name}</dd>
              <dt className="text-fg-muted">Email</dt><dd className="m-0 break-all text-fg">{row.email}</dd>
              <dt className="text-fg-muted">Status</dt><dd className="m-0"><UserStatusLabel status={row.status} /></dd>
            </dl>
            <p className="text-[12.5px] text-fg-secondary">{`Signed up ${createdLabel(row.createdAt, null)}`}</p>
            <RoleCards name={`approve-role-${row.id}`} legend="Role" value={approveRole} onChange={setApproveRole} disabled={busy} />
            <EmployeePicker
              label="Employee record"
              hint="The closest match to their name shows first."
              initialQuery={row.name}
              value={approveEmployee}
              onPick={setApproveEmployee}
              error={errors.employeeId}
              disabled={busy}
            />
            {confirmingDecline ? (
              <div role="group" aria-labelledby={`${titleId}-decline`} className="flex flex-col gap-2.5 rounded-(--radius-card) border p-3"
                style={{ background: "var(--st-attention-bg)", borderColor: "var(--st-attention-border)" }}
              >
                <p id={`${titleId}-decline`} className="text-[12.5px] text-fg">
                  {`Decline ${row.name}'s sign-up? They can't sign in. You can still approve them later from Declined.`}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="ghost" className={TARGET} data-focus="decline-cancel" onClick={() => close("decline", () => setConfirmingDecline(false))}>
                    Cancel
                  </Button>
                  <Button
                    variant="danger"
                    className={TARGET}
                    loading={busy}
                    onClick={() => act("decline", () => { setConfirmingDecline(false); focus(focusOnClose("decline")); onDecline(); })}
                  >
                    Decline sign-up
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  className={TARGET}
                  data-focus="approve"
                  loading={busy}
                  onClick={() => act("approve", () => onApprove(approveRole, approveEmployee?.value ?? null))}
                >
                  Approve
                </Button>
                {row.approvalState === "PENDING" && (
                  <Button variant="secondary" className={TARGET} data-focus="decline" disabled={busy} onClick={() => open("decline", () => setConfirmingDecline(true))}>
                    Decline
                  </Button>
                )}
              </div>
            )}
          </Section>
        ) : (
          <>
            <RoleCards
              name={`role-${row.id}`}
              legend="Access"
              legendClassName="sec"
              value={draft.role}
              onChange={(role) => set({ role })}
              disabled={!!locked || busy}
            >
              <div aria-live="polite" className="flex flex-col gap-2">
                {note && (
                  <p className="rounded-(--radius-card) bg-accent-soft px-3 py-2.5 text-[12.5px] text-accent-soft-text">{note}</p>
                )}
                {selfWarning && (
                  <p className="rounded-(--radius-card) px-3 py-2.5 text-[12.5px]"
                    style={{ background: "var(--st-attention-bg)", color: "var(--st-attention-text)" }}
                  >
                    {selfWarning}
                  </p>
                )}
              </div>
            </RoleCards>

            <Section title="Employee record">
              {draft.employee ? (
                <div className="flex flex-wrap items-center gap-2.5 rounded-(--radius-card) border border-border px-3 py-1.5">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <Link href={`/employees/${draft.employee.value}`} className={cn(LINK, "truncate text-[13px] font-medium")}>
                      {draft.employee.label}
                    </Link>
                    <span className="truncate text-[11.5px] text-fg-muted">{draft.employee.sub}</span>
                    {row.employee?.offboarded && row.employee.id === draft.employee.value && <OffboardedNote />}
                  </span>
                  {!locked && (
                    <span className="flex shrink-0 gap-1.5">
                      <Button
                        className={TARGET}
                        data-focus="pick"
                        disabled={busy}
                        aria-expanded={picking}
                        onClick={() => (picking ? close("pick", () => setPicking(false)) : open("pick", () => setPicking(true)))}
                      >
                        Change
                      </Button>
                      <Button variant="ghost" className={TARGET} disabled={busy} onClick={() => close("pick", () => { set({ employee: null }); setPicking(false); })}>
                        Unlink
                      </Button>
                    </span>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2.5 rounded-(--radius-card) border border-dashed border-border px-3 py-1.5">
                  <span className="flex-1 text-[12.5px] text-fg-muted">Not linked to an employee record.</span>
                  {!locked && (
                    <Button
                      className={TARGET}
                      data-focus="pick"
                      disabled={busy}
                      aria-expanded={picking}
                      onClick={() => (picking ? close("pick", () => setPicking(false)) : open("pick", () => setPicking(true)))}
                    >
                      Link…
                    </Button>
                  )}
                </div>
              )}
              {picking && !locked && (
                <EmployeePicker
                  label="Find the employee"
                  focusKey="pick-search"
                  value={null}
                  onPick={(o) => { if (o) close("pick", () => { set({ employee: o }); setPicking(false); }); }}
                  disabled={busy}
                />
              )}
              <FieldError message={errors.employeeId} />
            </Section>
          </>
        )}

        <Section title="Name & email">
          {editingName && !locked ? (
            <div className="flex flex-col gap-3">
              <FormField label="Full name" error={errors.name}>
                {(p) => <Input {...p} data-focus="name" value={draft.name} autoComplete="off" maxLength={120} className="h-11" onChange={(e) => set({ name: e.currentTarget.value })} />}
              </FormField>
              <FormField label="Work email" error={errors.email}>
                {(p) => <Input {...p} type="email" value={draft.email} autoComplete="off" maxLength={320} className="h-11" onChange={(e) => set({ email: e.currentTarget.value })} />}
              </FormField>
              <Button
                variant="ghost"
                className={cn(TARGET, "self-start")}
                onClick={() => close("edit", () => { set({ name: base.name, email: base.email }); setEditingName(false); })}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <div className="flex items-start gap-2.5">
              <dl className="grid min-w-0 flex-1 grid-cols-[96px_1fr] gap-x-2.5 gap-y-1.5 text-[12.5px]">
                <dt className="text-fg-muted">Name</dt><dd className="m-0 truncate text-fg">{draft.name}</dd>
                <dt className="text-fg-muted">Email</dt><dd className="m-0 break-all text-fg">{draft.email}</dd>
              </dl>
              {!locked && (
                <Button
                  variant="secondary"
                  className={TARGET}
                  data-focus="edit"
                  disabled={busy}
                  onClick={() => open("edit", () => setEditingName(true))}
                  aria-label="Edit name and email"
                >
                  Edit
                </Button>
              )}
            </div>
          )}
          {!editingName && <FieldError message={errors.name ?? errors.email} />}
        </Section>

        {!signUp && (
          <>
            <Section title="Sign-in">
              <dl className="grid grid-cols-[96px_1fr] gap-x-2.5 gap-y-1.5 text-[12.5px]">
                <dt className="text-fg-muted">Status</dt><dd className="m-0"><UserStatusLabel status={row.status} /></dd>
                <dt className="text-fg-muted">Last sign-in</dt><dd className="m-0 text-fg">{lastSignInLabel(row.lastSignInAt, at)}</dd>
                <dt className="text-fg-muted">Password</dt><dd className="m-0 text-fg">{passwordLabel(row)}</dd>
                <dt className="text-fg-muted">Created</dt><dd className="m-0 text-fg">{createdLabel(row.createdAt, row.createdByName)}</dd>
              </dl>
              <Button
                variant="secondary"
                className={cn(TARGET, "self-start")}
                disabled={!!locked || self || busy || row.signIn === "SSO only"}
                onClick={onReset}
              >
                Reset password…
              </Button>
              {self && !locked && (
                <p className="text-[12px] text-fg-muted">
                  Change your own password in Account settings.{" "}
                  <Link href="/settings/account" className={LINK}>Open Account settings</Link>
                </p>
              )}
            </Section>

            <Section title="Account" className="border-t border-border-faint pt-4">
              <div className="flex items-center gap-3">
                <label htmlFor={switchId} className="flex-1 text-[13px] font-medium text-fg">
                  Account active
                  <span className="block text-[12px] font-normal text-fg-muted">
                    {row.disabled ? "Turned off: they can't sign in. Their history stays." : "They can sign in."}
                  </span>
                </label>
                <span data-focus="switch" className="inline-flex min-h-11 min-w-11 items-center justify-center">
                  <Switch
                    id={switchId}
                    checked={!row.disabled}
                    aria-label="Account active"
                    aria-describedby={switchReason ? switchReasonId : undefined}
                    // Not disabled while the confirm is open or a call runs: a focused control must never vanish from
                    // under the keyboard (I-1). The handler ignores presses then instead.
                    disabled={!!switchReason}
                    // A 44 × 44 px hit area around the 32 × 18 px track (I-2).
                    className="before:absolute before:-inset-x-1.5 before:-inset-y-[13px] before:content-['']"
                    onCheckedChange={(on) => {
                      if (busy || confirmingOff) return;
                      if (on) act("turn-on", () => onSetActive(true));
                      else open("turn-off", () => setConfirmingOff(true));
                    }}
                  />
                </span>
              </div>
              {switchReason && !locked && <p id={switchReasonId} className="text-[12px] text-fg-muted">{switchReason}</p>}
              {switchReason && locked && <span id={switchReasonId} className="sr-only">{switchReason}</span>}
              {confirmingOff && !switchReason && (
                <div role="group" aria-labelledby={`${titleId}-off`} className="flex flex-col gap-2.5 rounded-(--radius-card) border p-3"
                  style={{ background: "var(--st-fault-bg)", borderColor: "var(--st-fault-border)" }}
                >
                  <p id={`${titleId}-off`} className="text-[12.5px]" style={{ color: "var(--st-fault-text)" }}>
                    {turnOffConfirm(row.name)}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="ghost" className={TARGET} data-focus="turn-off-cancel" onClick={() => close("turn-off", () => setConfirmingOff(false))}>
                      Cancel
                    </Button>
                    <Button
                      variant="danger"
                      className={TARGET}
                      loading={busy}
                      onClick={() => act("turn-off", () => { close("turn-off", () => setConfirmingOff(false)); onSetActive(false); })}
                    >
                      Turn off account
                    </Button>
                  </div>
                </div>
              )}
            </Section>
          </>
        )}

        <Link href={accessHistoryHref(row.id)} className={cn(LINK, "self-start text-[12.5px] font-medium")}>
          See this person&apos;s access history →
        </Link>
      </div>

      {asking && (
        <div role="alertdialog" aria-labelledby={`${titleId}-ask`} data-discard-prompt="" className="flex shrink-0 flex-col gap-2.5 border-t px-5 py-3"
          style={{ background: "var(--st-attention-bg)", borderColor: "var(--st-attention-border)" }}
        >
          <p id={`${titleId}-ask`} className="text-[12.5px] text-fg">
            {stale && !leaving ? `${row.name}'s account changed since you started editing. ` : ""}Discard unsaved changes?
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              className={TARGET}
              data-focus="keep-editing"
              onClick={() => close("discard", () => { if (leaving) onLeave?.(false); else setKeptOver(row.updatedAt); })}
            >
              Keep editing
            </Button>
            <Button
              variant="danger"
              className={TARGET}
              onClick={() => { discard(); if (leaving) onLeave?.(true); else focus(focusOnClose("edit")); }}
            >
              Discard
            </Button>
          </div>
        </div>
      )}

      {dirty && !asking && (
        <div role="region" aria-label="Unsaved changes" className="flex shrink-0 items-center gap-2.5 border-t border-border bg-surface-subtle px-5 py-3">
          <span className="flex-1 text-[12.5px] text-fg-secondary">Unsaved changes</span>
          <Button variant="ghost" className={TARGET} disabled={busy} onClick={() => { discard(); focus(focusOnClose("edit")); }}>
            Discard
          </Button>
          <Button variant="primary" className={TARGET} data-focus="save" loading={busy} onClick={() => act("save", () => onSave(changes, base.updatedAt))}>
            Save
          </Button>
        </div>
      )}
    </div>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-[11.5px] font-medium" style={{ color: "var(--error-text)" }}>{message}</p>
  );
}
