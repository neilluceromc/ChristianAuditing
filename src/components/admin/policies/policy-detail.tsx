"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Menu } from "@/components/ui/menu";
import { useToast } from "@/components/ui/toast";
import { EntityCombobox } from "@/components/patterns/entity-combobox";
import type { GroupKindValue } from "@/lib/groups";
import { deletePolicy } from "@/server/modules/admin/policy-actions";
import { CopyPolicyDialog, type CopyTarget } from "./copy-policy-dialog";
import { LEAVE_UNSAVED } from "./dirty-context";
import { PolicyLinesEditor, firstLineOf, type CategoryOption, type PolicyLineInput } from "./policy-lines-editor";

const strip = (lines: PolicyLineInput[]): PolicyLineInput[] =>
  lines.map((l) => ({ assetTypeId: l.assetTypeId, required: l.required, loaner: l.loaner }));

/** Confirm, then `deletePolicy`. Shared by the base policy's ⋯ menu, title rules and the older global rules. */
export function RemovePolicyDialog({
  policyId, title, body, onClose,
}: { policyId: string | null; title: string; body: string; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function close() {
    setError(null);
    onClose();
  }

  function remove() {
    if (!policyId) return;
    setError(null);
    startTransition(async () => {
      const res = await deletePolicy({ id: policyId });
      if (res.ok) {
        toast("Policy removed", "settled");
        close();
        router.refresh();
      } else setError(res.message);
    });
  }

  return (
    <Dialog
      open={policyId !== null}
      onClose={close}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={close}>Cancel</Button>
          <Button variant="danger" loading={pending} onClick={remove}>Remove</Button>
        </>
      }
    >
      <p>{body}</p>
      {error && <p role="alert" className="mt-2 text-[11.5px] font-medium" style={{ color: "var(--error-text)" }}>{error}</p>}
    </Dialog>
  );
}

/** Beside the base policy's Save: Copy to other clients/departments…, and ⋯ → Remove policy. */
export function BasePolicyActions({
  policyId, groupName, kind, targets,
}: { policyId: string; groupName: string; kind: GroupKindValue; targets: CopyTarget[] }) {
  const [copying, setCopying] = useState(false);
  const [removing, setRemoving] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setCopying(true)}>
        Copy to other {kind === "CLIENT" ? "clients" : "departments"}…
      </Button>
      <Menu
        trigger={(props) => (
          <button
            type="button" {...props} aria-label={`More for ${groupName}'s policy`}
            className="rounded-(--radius-ctl) px-2 py-1 text-fg-muted hover:bg-surface-subtle"
          >
            ⋯
          </button>
        )}
        items={[{ label: "Remove policy", danger: true, onSelect: () => setRemoving(true) }]}
      />
      <CopyPolicyDialog open={copying} onClose={() => setCopying(false)} fromPolicyId={policyId} kind={kind} targets={targets} />
      <RemovePolicyDialog
        policyId={removing ? policyId : null}
        title={`Remove ${groupName}'s policy?`}
        body="Their staff will show no gaps."
        onClose={() => setRemoving(false)}
      />
    </>
  );
}

export interface PolicySource { policyId: string; groupName: string; lines: PolicyLineInput[] }

/** Spec §3.3: a group with no base policy — start from another group's list, or start empty; Save creates it. */
export function StartPolicy({
  departmentId, groupName, kind, staff, people, sources, categories, canMutate,
}: {
  departmentId: string;
  groupName: string;
  kind: GroupKindValue;
  /** the group's active people */
  staff: number;
  /** how many of them a new base list would decide for (no title rule of theirs applies) */
  people: number;
  sources: PolicySource[];
  categories: CategoryOption[];
  canMutate: boolean;
}) {
  const comboId = useId();
  const [lines, setLines] = useState<PolicyLineInput[] | null>(null);
  const one = kind === "CLIENT" ? "client" : "department";

  if (lines) {
    return (
      <PolicyLinesEditor
        departmentId={departmentId} groupName={groupName} kind={kind} title={null}
        initialLines={lines} categories={categories} people={people} canMutate={canMutate}
        onCancel={() => setLines(null)}
      />
    );
  }

  const empty = firstLineOf(categories, "Laptop");
  return (
    <div
      className="flex flex-col gap-3 rounded-(--radius-card) border border-dashed px-4 py-3"
      style={{ borderColor: "var(--st-attention-border)", background: "var(--st-attention-bg)" }}
    >
      <p className="text-[12.5px] text-fg">
        <span className="font-semibold">{groupName} has no equipment policy yet.</span>{" "}
        Their {staff} staff show no gaps until it has one.
      </p>
      {canMutate && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex min-w-[240px] flex-1 flex-col gap-1 sm:max-w-[320px]">
            <label htmlFor={comboId} className="text-[11px] font-medium text-fg-secondary">
              Start from another {one}&apos;s list…
            </label>
            <EntityCombobox
              id={comboId}
              options={sources.map((s) => ({ value: s.policyId, label: s.groupName, sub: `${s.lines.length} ${s.lines.length === 1 ? "item" : "items"}` }))}
              value={null}
              placeholder={sources.length ? `Type a ${one}'s name…` : `No ${one} has a list yet`}
              emptyText="No match."
              onChange={(id) => {
                const src = sources.find((s) => s.policyId === id);
                if (src) setLines(strip(src.lines));
              }}
            />
          </div>
          <span className="self-end pb-2 text-xs text-fg-muted">
            or{" "}
            <Button size="sm" variant="secondary" disabled={!empty} onClick={() => empty && setLines([empty])}>
              Start empty
            </Button>
          </span>
        </div>
      )}
    </div>
  );
}

const DRAFT_OPEN = "new-rule";

export interface TitleRule {
  policyId: string;
  title: string;
  lines: PolicyLineInput[];
  people: number;
  /** changes whenever the saved lines change, so the editor restarts from them */
  editorKey: string;
  untypedNames: string[];
}

/**
 * Spec §3.3, Phase 39 §5: "Different for a job title on {group}" — the group's title rules as rows
 * ("{title} · {k} lines · Edit"). One editor is open at a time; opening another (or adding a rule) while the
 * open one has unsaved changes asks "Leave without saving?".
 */
export function TitleRules({
  departmentId, groupName, kind, rules, baseLines, categories, canMutate, titleCounts,
}: {
  departmentId: string;
  groupName: string;
  kind: GroupKindValue;
  rules: TitleRule[];
  /** the base list a new rule starts from; null = the group has no base list, so no rule can be added */
  baseLines: PolicyLineInput[] | null;
  categories: CategoryOption[];
  canMutate: boolean;
  /** the group's active people per job title, for a new rule's impact line */
  titleCounts: Array<{ title: string; count: number }>;
}) {
  const inputId = useId();
  const panelBase = useId();
  const [adding, setAdding] = useState(false);
  const [typed, setTyped] = useState("");
  const [typedError, setTypedError] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  /** the rule whose editor is open (its policyId), or DRAFT_OPEN for the unsaved new rule */
  const [open, setOpen] = useState<string | null>(null);
  const openDirty = useRef(false);
  const [removing, setRemoving] = useState<TitleRule | null>(null);

  const key = (t: string) => t.trim().toLowerCase();
  const countFor = (t: string) => titleCounts.filter((c) => key(c.title) === key(t)).reduce((n, c) => n + c.count, 0);

  /** True when the open editor may go: nothing unsaved, or they chose to leave it. */
  function mayLeave(): boolean {
    if (openDirty.current && !window.confirm(LEAVE_UNSAVED)) return false;
    openDirty.current = false;
    return true;
  }

  function toggle(id: string) {
    if (!mayLeave()) return;
    setAdding(false);
    setTyped("");
    setTypedError(null);
    setDraft(null);
    setOpen(open === id ? null : id);
  }

  function startAdding() {
    if (!mayLeave()) return;
    setOpen(null);
    setDraft(null);
    setAdding(true);
  }

  function closeDraft() {
    setDraft(null);
    setOpen(null);
  }

  function add() {
    const title = typed.trim();
    if (title.length < 2 || title.length > 120) {
      setTypedError("A job title is 2 to 120 characters");
      return;
    }
    if (rules.some((r) => key(r.title) === key(title))) {
      setTypedError(`${groupName} already has a rule for ${title}`);
      return;
    }
    setDraft(title);
    setOpen(DRAFT_OPEN);
    setAdding(false);
    setTyped("");
    setTypedError(null);
  }

  return (
    <details className="rounded-(--radius-card) border border-border-faint" open={rules.length > 0 || draft !== null || undefined}>
      <summary className="cursor-pointer select-none px-4 py-2.5 text-xs font-medium text-fg-secondary">
        Different for a job title on {groupName}{" "}
        <span className="font-mono text-[11px] text-fg-muted">({rules.length})</span>
      </summary>
      <div className="flex flex-col gap-4 border-t border-border-faint px-4 py-3">
        {baseLines === null && (
          <p className="text-xs text-fg-muted">
            {groupName} has no list of its own yet, so no new title rule can be added; these still apply.
          </p>
        )}
        {rules.length === 0 && draft === null && (
          <p className="text-xs text-fg-muted">
            No title rules. Everyone on {groupName} gets the list above.
          </p>
        )}
        {rules.map((r) => {
          const isOpen = open === r.policyId;
          const panelId = `${panelBase}-${r.policyId}`;
          return (
            <div key={r.policyId} className="rounded-(--radius-card) border border-border-faint">
              <div className="flex items-center gap-2 px-3 py-2">
                <h4 className="text-[12.5px] font-semibold text-fg">{r.title}</h4>
                <span className="text-xs text-fg-muted">
                  · {r.lines.length} {r.lines.length === 1 ? "line" : "lines"} ·
                </span>
                {/* A disclosure: the visible word never changes ("Edit"/"View", inside the name, WCAG 2.5.3); the
                    chevron and aria-expanded say open or not, and the same button closes the editor. */}
                <Button
                  size="sm" variant="ghost" aria-expanded={isOpen} aria-controls={panelId}
                  aria-label={`${canMutate ? "Edit" : "View"} the ${r.title} rule`}
                  onClick={() => toggle(r.policyId)}
                >
                  <span className="inline-flex items-center gap-1">
                    {canMutate ? "Edit" : "View"}
                    <svg
                      aria-hidden viewBox="0 0 10 10" width="10" height="10"
                      className={isOpen ? "rotate-180 transition-transform" : "transition-transform"}
                    >
                      <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
                    </svg>
                  </span>
                </Button>
                {canMutate && (
                  <Button size="sm" variant="ghost" className="ml-auto" aria-label={`Remove the ${r.title} rule`} onClick={() => setRemoving(r)}>
                    Remove
                  </Button>
                )}
              </div>
              {/* Always present (hidden while closed) so aria-controls names an element; the editor mounts only when open. */}
              <div id={panelId} hidden={!isOpen} className="border-t border-border-faint px-3 py-3">
                {isOpen && (
                  <PolicyLinesEditor
                    key={r.editorKey}
                    departmentId={departmentId} groupName={groupName} kind={kind} policyId={r.policyId} title={r.title}
                    initialLines={r.lines} categories={categories} people={r.people} canMutate={canMutate}
                    untypedNames={r.untypedNames}
                    onDirtyChange={(d) => { openDirty.current = d; }}
                  />
                )}
              </div>
            </div>
          );
        })}
        {draft !== null && baseLines && (
          <div className="rounded-(--radius-card) border border-border-faint">
            <div className="flex items-center gap-2 px-3 py-2">
              <h4 className="text-[12.5px] font-semibold text-fg">{draft}</h4>
              <span className="text-xs text-fg-muted">· new, not saved yet</span>
            </div>
            <div className="border-t border-border-faint px-3 py-3">
              <PolicyLinesEditor
                key={`draft:${draft}`}
                departmentId={departmentId} groupName={groupName} kind={kind} title={draft}
                initialLines={strip(baseLines)} categories={categories} people={countFor(draft)} canMutate={canMutate}
                onSaved={closeDraft} onCancel={closeDraft}
                onDirtyChange={(d) => { openDirty.current = d; }}
              />
            </div>
          </div>
        )}
        {canMutate && baseLines && (adding ? (
          <div className="flex flex-col gap-1">
            <label htmlFor={inputId} className="text-[11px] font-medium text-fg-secondary">Exact job title</label>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id={inputId} value={typed} invalid={!!typedError} autoFocus maxLength={120}
                className="max-w-[280px] flex-1 py-1.5 text-xs"
                onChange={(e) => { setTyped(e.target.value); setTypedError(null); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); add(); }
                  if (e.key === "Escape") { setAdding(false); setTyped(""); setTypedError(null); }
                }}
              />
              <Button size="sm" variant="primary" onClick={add}>Add</Button>
              <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setTyped(""); setTypedError(null); }}>Cancel</Button>
            </div>
            {typedError && <p role="alert" className="text-[11px] font-medium" style={{ color: "var(--error-text)" }}>{typedError}</p>}
          </div>
        ) : (
          <div>
            <Button size="sm" variant="ghost" onClick={startAdding}>+ Add a title rule</Button>
          </div>
        ))}
      </div>
      <RemovePolicyDialog
        policyId={removing?.policyId ?? null}
        title={removing ? `Remove the ${removing.title} rule on ${groupName}?` : ""}
        body={`People with that title go back to ${groupName}'s list.`}
        onClose={() => setRemoving(null)}
      />
    </details>
  );
}
