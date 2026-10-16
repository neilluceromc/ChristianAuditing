"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import type { GroupKindValue } from "@/lib/groups";
import { copyPolicy } from "@/server/modules/admin/policy-actions";

export interface CopyTarget { id: string; name: string; policyItems: number | null }

/** The server's limit (policy-actions copySchema). */
const MAX_TARGETS = 60;

/**
 * Phase 37 (spec §3.3): copy one group's base policy onto other active groups of the same kind. Each copy is
 * independent; a target that had a list has it replaced.
 */
export function CopyPolicyDialog({
  open, onClose, fromPolicyId, kind, targets,
}: {
  open: boolean;
  onClose: () => void;
  fromPolicyId: string;
  kind: GroupKindValue;
  /** the other active groups of the same kind */
  targets: CopyTarget[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  const plural = kind === "CLIENT" ? "clients" : "departments";

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? targets.filter((t) => t.name.toLowerCase().includes(needle)) : targets;
  }, [targets, q]);

  function close() {
    setQ("");
    setPicked(new Set());
    setError(null);
    onClose();
  }

  function toggle(id: string, on: boolean) {
    setPicked((p) => {
      const next = new Set(p);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function selectShown(on: boolean) {
    setPicked((p) => {
      const next = new Set(p);
      for (const t of shown) {
        if (on) next.add(t.id);
        else next.delete(t.id);
      }
      return next;
    });
  }

  function copy() {
    const ids = [...picked];
    setError(null);
    startTransition(async () => {
      const res = await copyPolicy({ fromPolicyId, toDepartmentIds: ids });
      if (res.ok) {
        toast(`Copied to ${res.data.copied}`, "settled");
        close();
        router.refresh();
      } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      else if (res.kind === "validation") {
        const errs = res.fieldErrors ?? {};
        setError(errs._form ?? errs.lines ?? Object.values(errs)[0] ?? res.message);
      } else setError(res.message);
    });
  }

  const n = picked.size;
  return (
    <Dialog
      open={open}
      onClose={close}
      title={`Copy to other ${plural}`}
      footer={
        <>
          <Button variant="ghost" onClick={close}>Cancel</Button>
          <Button variant="primary" loading={pending} disabled={n === 0 || n > MAX_TARGETS} onClick={copy}>
            Copy to {n}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2.5">
        <p className="text-xs text-fg-muted">
          Each one gets its own copy of these lines. Their title rules are untouched.
        </p>
        {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
        <div>
          <label htmlFor="copy-policy-find" className="sr-only">Find</label>
          <Input
            id="copy-policy-find" type="search" value={q} placeholder="Find…" className="py-1.5 text-xs"
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2 text-xs">
          <Button size="sm" variant="ghost" onClick={() => selectShown(true)} disabled={shown.length === 0}>Select all</Button>
          <Button size="sm" variant="ghost" onClick={() => selectShown(false)} disabled={shown.length === 0}>Select none</Button>
          {n > MAX_TARGETS && <span className="text-fg-muted">At most {MAX_TARGETS} at a time</span>}
        </div>
        <ul className="max-h-[260px] overflow-auto rounded-(--radius-card) border border-border-faint">
          {shown.map((t) => (
            <li key={t.id} className="border-b border-border-faint last:border-b-0">
              <label className="flex items-center gap-2 px-2.5 py-1.5 text-xs text-fg-secondary">
                <Checkbox checked={picked.has(t.id)} onChange={(e) => toggle(t.id, e.target.checked)} />
                <span className="min-w-0 flex-1 truncate text-fg">{t.name}</span>
                <span className="text-[11px] text-fg-muted">
                  {t.policyItems ? `replaces its ${t.policyItems} ${t.policyItems === 1 ? "item" : "items"}` : "no policy yet"}
                </span>
              </label>
            </li>
          ))}
          {shown.length === 0 && <li className="px-2.5 py-4 text-center text-xs text-fg-muted">No match.</li>}
        </ul>
        {error && (
          <p role="alert" className="text-[11.5px] font-medium" style={{ color: "var(--error-text)" }}>{error}</p>
        )}
      </div>
    </Dialog>
  );
}
