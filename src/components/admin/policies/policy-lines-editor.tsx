"use client";

import { useId, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select } from "@/components/ui/select";
import { Td, TBody, Th, THead, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { numberSlotLabels, slotLabel } from "@/lib/loadout";
import type { GroupKindValue } from "@/lib/groups";
import { savePolicy } from "@/server/modules/admin/policy-actions";
import { useDirtyFlag } from "./dirty-context";

export interface PolicyLineInput { slotId?: string; assetTypeId: string; required: boolean; loaner: boolean }
export interface CategoryOption { id: string; name: string; types: Array<{ id: string; name: string }> }

/** The server's limit (policy-actions saveSchema); + Add slot stops here. */
const MAX_LINES = 20;

const sameLines = (a: PolicyLineInput[], b: PolicyLineInput[]) =>
  a.length === b.length &&
  a.every((l, i) => l.slotId === b[i].slotId && l.assetTypeId === b[i].assetTypeId && l.required === b[i].required && l.loaner === b[i].loaner);

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** A new line: the named category's first type (Headset for + Add slot, Laptop for Start empty), else the first category's. */
export function firstLineOf(categories: CategoryOption[], categoryName: string): PolicyLineInput | null {
  const cat = categories.find((c) => c.name.trim().toLowerCase() === categoryName.toLowerCase()) ?? categories[0];
  const type = cat?.types[0];
  return type ? { assetTypeId: type.id, required: true, loaner: false } : null;
}

/**
 * Phase 37 (spec §3.3): one policy's lines — Category, Type, Required, Loan, × — kept locally until Save, which
 * sends the whole list to `savePolicy` (create when `policyId` is undefined). A viewer gets the same table as text.
 */
export function PolicyLinesEditor({
  departmentId, groupName, kind, policyId, title, initialLines, categories, people, canMutate,
  actions, onSaved, onCancel, untypedNames = [],
}: {
  departmentId: string;
  groupName: string;
  kind: GroupKindValue;
  policyId?: string;
  title: string | null;
  initialLines: PolicyLineInput[];
  categories: CategoryOption[];
  /** how many people this list decides for */
  people: number;
  canMutate: boolean;
  /** more controls beside Save (the base policy's Copy… and ⋯ menu) */
  actions?: React.ReactNode;
  onSaved?: () => void;
  /** an unsaved list (no `policyId`) can be discarded */
  onCancel?: () => void;
  /** older slots with no type: the editor cannot show them, and Save drops them */
  untypedNames?: string[];
}) {
  const router = useRouter();
  const toast = useToast();
  const editorKey = useId();
  const [pending, startTransition] = useTransition();
  const nextKey = useRef(initialLines.length);
  const [rows, setRows] = useState(() => initialLines.map((l, i) => ({ ...l, key: i })));
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  // A new list, once created, stays locked until the refresh replaces this editor: a second Save would
  // try to create it again.
  const [created, setCreated] = useState(false);

  const typeById = useMemo(() => {
    const m = new Map<string, { category: CategoryOption; name: string }>();
    for (const c of categories) for (const t of c.types) m.set(t.id, { category: c, name: t.name });
    return m;
  }, [categories]);

  const lines: PolicyLineInput[] = rows.map((r) => ({ slotId: r.slotId, assetTypeId: r.assetTypeId, required: r.required, loaner: r.loaner }));
  // An unsaved list is unsaved even before it is changed: leaving would lose it.
  const dirty = canMutate && !created && (!policyId || !sameLines(lines, initialLines));
  useDirtyFlag(editorKey, dirty);

  const labels = numberSlotLabels(rows.map((r) => {
    const t = typeById.get(r.assetTypeId);
    return t ? slotLabel(t.category.name, t.name) : "Unknown item";
  }));
  const required = rows.filter((r) => r.required).length;
  const what = kind === "CLIENT" ? "client" : "department";
  const regionLabel = title ? `${title} on ${groupName}` : "What their staff should have";

  function update(key: number, patch: Partial<PolicyLineInput>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function addLine() {
    const line = firstLineOf(categories, "Headset");
    if (!line) return;
    setRows((rs) => [...rs, { ...line, key: nextKey.current++ }]);
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await savePolicy({ departmentId, title, policyId, lines });
      if (res.ok) {
        if (!policyId) setCreated(true);
        toast("Saved", "settled");
        onSaved?.();
        router.refresh();
      } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      else if (res.kind === "validation") {
        const errs = res.fieldErrors ?? {};
        setError(errs._form ?? errs.lines ?? Object.values(errs)[0] ?? res.message);
      } else setError(res.message);
    });
  }

  if (!canMutate) {
    return (
      <section aria-label={regionLabel} className="flex flex-col gap-2">
        {!title && <h3 className="text-[13px] font-semibold text-fg">What their staff should have</h3>}
        <div className="overflow-x-auto rounded-(--radius-card) border border-border">
          <table className="w-full border-collapse text-[12.5px]">
            <THead>
              <Tr className="hover:bg-transparent">
                <Th>Shows as</Th><Th>Category</Th><Th>Type</Th><Th width={90}>Required</Th><Th width={70}>Loan</Th>
              </Tr>
            </THead>
            <TBody>
              {rows.map((r, i) => {
                const t = typeById.get(r.assetTypeId);
                return (
                  <Tr key={r.key}>
                    <Td mono>{labels[i]}</Td>
                    <Td>{t?.category.name ?? "—"}</Td>
                    <Td>{t?.name ?? "—"}</Td>
                    <Td>{r.required ? "Yes" : "Optional"}</Td>
                    <Td>{r.loaner ? "Yes" : "—"}</Td>
                  </Tr>
                );
              })}
            </TBody>
          </table>
        </div>
      </section>
    );
  }

  return (
    <section aria-label={regionLabel} className="flex flex-col gap-2">
      {!title && <h3 className="text-[13px] font-semibold text-fg">What their staff should have</h3>}
      {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
      <div className="overflow-x-auto rounded-(--radius-card) border border-border">
        <table className="w-full border-collapse text-[12.5px]">
          <THead>
            <Tr className="hover:bg-transparent">
              <Th>Category</Th><Th>Type</Th><Th width={110}>Required</Th><Th width={70}>Loan</Th>
              <Th width={44} aria-label="Remove" />
            </Tr>
          </THead>
          <TBody>
            {rows.map((r, i) => {
              const n = i + 1;
              const t = typeById.get(r.assetTypeId);
              const cat = t?.category;
              return (
                <Tr key={r.key}>
                  <Td>
                    <Select
                      aria-label={`Line ${n} kind`} value={cat?.id ?? ""} className="py-1.5 text-xs"
                      onChange={(e) => {
                        const next = categories.find((c) => c.id === e.target.value);
                        if (next?.types[0]) update(r.key, { assetTypeId: next.types[0].id });
                      }}
                    >
                      {!cat && <option value="">Pick one</option>}
                      {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </Select>
                  </Td>
                  <Td>
                    <Select
                      aria-label={`Line ${n} variant`} value={t ? r.assetTypeId : ""} className="py-1.5 text-xs"
                      onChange={(e) => update(r.key, { assetTypeId: e.target.value })}
                    >
                      {!cat && <option value="">—</option>}
                      {cat?.types.map((ty) => <option key={ty.id} value={ty.id}>{ty.name}</option>)}
                    </Select>
                    <span className="mt-0.5 block font-mono text-[10px] text-fg-muted">shows as {labels[i]}</span>
                  </Td>
                  <Td>
                    <label className="inline-flex items-center gap-1.5 text-xs text-fg-secondary">
                      <Checkbox
                        aria-label={`Line ${n} needed`} checked={r.required}
                        onChange={(e) => update(r.key, { required: e.target.checked })}
                      />
                      <span aria-hidden>{r.required ? "Yes" : "Optional"}</span>
                    </label>
                  </Td>
                  <Td>
                    <Checkbox
                      aria-label={`Line ${n} filled by a lent device`} checked={r.loaner}
                      onChange={(e) => update(r.key, { loaner: e.target.checked })}
                    />
                  </Td>
                  <Td>
                    <button
                      type="button" aria-label={`Remove line ${n}`}
                      onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                      className="rounded-(--radius-ctl) px-2 py-0.5 text-fg-muted hover:bg-surface-subtle hover:text-fg"
                    >
                      ×
                    </button>
                  </Td>
                </Tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-4 text-center text-xs text-fg-muted">No items.</td></tr>
            )}
          </TBody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" onClick={addLine} disabled={rows.length >= MAX_LINES || categories.length === 0}>
          + Add slot
        </Button>
      </div>
      <p className="text-[11px] text-fg-muted">
        Each line becomes a tile on the person&apos;s profile, named after its category (or its type, for Other). A
        second line of the same kind shows as {'"Monitor 2"'}.
      </p>
      {untypedNames.length > 0 && (
        <p className="text-[11px] text-fg-muted">
          Older lines without a type ({untypedNames.join(", ")}) are not shown and are dropped when you save.
        </p>
      )}
      {error && (
        <p role="alert" className="text-[11.5px] font-medium" style={{ color: "var(--error-text)" }}>{error}</p>
      )}

      <p className="text-xs text-fg-secondary">
        {plural(people, "person gets", "people get")} {plural(rows.length, "slot", "slots")} ({required} required).
        Missing items show as gaps on their profile. Nothing is taken back.
      </p>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border-faint pt-3">
        {actions}
        {onCancel && !policyId && (
          <Button size="sm" variant="ghost" disabled={pending} onClick={onCancel}>Discard</Button>
        )}
        <Button
          size="sm" variant="primary" loading={pending} disabled={created || (!!policyId && !dirty)}
          aria-label={title ? `Save the ${title} rule` : undefined}
          onClick={save}
        >
          Save
        </Button>
      </div>
      {!policyId && (
        <p className="text-[11px] text-fg-muted">
          Not saved yet — Save creates this {title ? "rule" : `${what}'s policy`}.
        </p>
      )}
    </section>
  );
}
