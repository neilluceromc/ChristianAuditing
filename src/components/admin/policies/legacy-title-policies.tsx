"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { RemovePolicyDialog } from "./policy-detail";

export interface LegacyRule { id: string; title: string; lines: string[] }

/** Phase 37 (spec §3.4): older title policies with no group still apply everywhere; they can be read and removed, not made. */
export function LegacyTitlePolicies({ rules, canMutate }: { rules: LegacyRule[]; canMutate: boolean }) {
  const [removing, setRemoving] = useState<LegacyRule | null>(null);
  return (
    <details className="rounded-(--radius-card) border border-border bg-surface shadow-card">
      <summary className="cursor-pointer select-none px-4 py-2.5 text-xs font-medium text-fg-secondary">
        Older rules by job title ({rules.length}) — they apply in every department and client
      </summary>
      <ul className="flex flex-col divide-y divide-border-faint border-t border-border-faint">
        {rules.map((r) => (
          <li key={r.id} className="flex flex-wrap items-start gap-3 px-4 py-2.5">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-[12.5px] font-medium text-fg">{r.title}</span>
              {r.lines.length ? (
                <ol className="flex flex-col gap-0.5 text-[11.5px] text-fg-secondary">
                  {r.lines.map((line, i) => <li key={i}>{i + 1}. {line}</li>)}
                </ol>
              ) : (
                <span className="text-[11.5px] text-fg-muted">No items.</span>
              )}
            </div>
            {canMutate && (
              <Button size="sm" variant="ghost" aria-label={`Remove the ${r.title} rule`} onClick={() => setRemoving(r)}>
                Remove
              </Button>
            )}
          </li>
        ))}
      </ul>
      <RemovePolicyDialog
        policyId={removing?.id ?? null}
        title={removing ? `Remove the rule for ${removing.title}?` : ""}
        body="People with that title go back to their own department's or client's list."
        onClose={() => setRemoving(null)}
      />
    </details>
  );
}
